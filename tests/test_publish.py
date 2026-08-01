from __future__ import annotations

import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest

import pipeline.publish as publication
from pipeline.publish import PublicationError, publish_domains
from pipeline.report import render_step_summary, write_report
from pipeline.validation import Decision, ValidationResult


def result(
    domain: str,
    decision: Decision,
    *,
    reasons: tuple[str, ...] = (),
) -> ValidationResult:
    return ValidationResult(
        domain=domain,
        decision=decision,
        effective_season="2026/27",
        reasons=reasons,
        metrics={"records": 3},
    )


def write_files(directory: Path, files: dict[str, bytes]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for name, contents in files.items():
        (directory / name).write_bytes(contents)


def test_retain_leaves_existing_files_byte_identical(tmp_path: Path) -> None:
    staging = tmp_path / "staging"
    published = tmp_path / "published"
    write_files(
        staging,
        {"ranking_data.json": b"new-json", "ranking_data.js": b"new-js"},
    )
    original = {"ranking_data.json": b"old-json", "ranking_data.js": b"old-js"}
    write_files(published, original)

    changed = publish_domains(
        staging, published, [result("rankings", Decision.RETAIN)]
    )

    assert changed == []
    assert {name: (published / name).read_bytes() for name in original} == original


def test_publish_promotes_ranking_pair_together(tmp_path: Path) -> None:
    staging = tmp_path / "staging"
    published = tmp_path / "published"
    candidate = {"ranking_data.json": b"new-json", "ranking_data.js": b"new-js"}
    write_files(staging, candidate)
    write_files(
        published,
        {"ranking_data.json": b"old-json", "ranking_data.js": b"old-js"},
    )

    changed = publish_domains(
        staging, published, [result("rankings", Decision.PUBLISH)]
    )

    assert changed == [
        published / "ranking_data.json",
        published / "ranking_data.js",
    ]
    assert {name: (published / name).read_bytes() for name in candidate} == candidate


@pytest.mark.parametrize("decision", [Decision.BLOCKED, Decision.FAILED])
def test_blocked_and_failed_domains_are_skipped(
    tmp_path: Path, decision: Decision
) -> None:
    staging = tmp_path / "staging"
    published = tmp_path / "published"
    write_files(
        staging, {"club_data.json": b"new-json", "club_data.js": b"new-js"}
    )
    write_files(
        published, {"club_data.json": b"old-json", "club_data.js": b"old-js"}
    )

    assert publish_domains(staging, published, [result("clubs", decision)]) == []
    assert (published / "club_data.json").read_bytes() == b"old-json"
    assert (published / "club_data.js").read_bytes() == b"old-js"


def test_preflight_missing_source_happens_before_any_mutation(tmp_path: Path) -> None:
    staging = tmp_path / "staging"
    published = tmp_path / "published"
    write_files(staging, {"league_data.json": b"new-json"})
    original = {"league_data.json": b"old-json", "league_data.js": b"old-js"}
    write_files(published, original)

    with pytest.raises(FileNotFoundError, match="league_data.js"):
        publish_domains(staging, published, [result("leagues", Decision.PUBLISH)])

    assert {name: (published / name).read_bytes() for name in original} == original


def test_second_promotion_failure_restores_pair_and_removes_debris(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    staging = tmp_path / "staging"
    published = tmp_path / "published"
    write_files(
        staging,
        {"ranking_data.json": b"new-json", "ranking_data.js": b"new-js"},
    )
    original = {"ranking_data.json": b"old-json", "ranking_data.js": b"old-js"}
    write_files(published, original)
    real_promote = publication.promote_file
    failure = RuntimeError("deterministic promotion failure")
    calls = 0

    def fail_second(source: Path, destination: Path) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            destination.with_suffix(destination.suffix + ".next").write_bytes(b"debris")
            raise failure
        real_promote(source, destination)

    monkeypatch.setattr(publication, "promote_file", fail_second)

    with pytest.raises(RuntimeError) as caught:
        publish_domains(staging, published, [result("rankings", Decision.PUBLISH)])

    assert caught.value is failure
    assert {name: (published / name).read_bytes() for name in original} == original
    assert not list(tmp_path.rglob("*.next"))
    assert not list(tmp_path.rglob("*.rollback"))


def test_rollback_restores_destination_absence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    staging = tmp_path / "staging"
    published = tmp_path / "published"
    write_files(
        staging, {"club_data.json": b"new-json", "club_data.js": b"new-js"}
    )
    real_promote = publication.promote_file
    calls = 0

    def fail_second(source: Path, destination: Path) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("stop")
        real_promote(source, destination)

    monkeypatch.setattr(publication, "promote_file", fail_second)

    with pytest.raises(OSError, match="stop"):
        publish_domains(staging, published, [result("clubs", Decision.PUBLISH)])

    assert not (published / "club_data.json").exists()
    assert not (published / "club_data.js").exists()


def test_cross_domain_failure_rolls_back_every_destination(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    staging = tmp_path / "staging"
    published = tmp_path / "published"
    write_files(
        staging,
        {
            "league_data.json": b"new-league-json",
            "league_data.js": b"new-league-js",
            "club_data.json": b"new-club-json",
            "club_data.js": b"new-club-js",
        },
    )
    original = {"league_data.json": b"old-league-json", "club_data.js": b"old-club-js"}
    write_files(published, original)
    real_promote = publication.promote_file

    def fail_club_json(source: Path, destination: Path) -> None:
        if destination.name == "club_data.json":
            raise RuntimeError("club promotion failed")
        real_promote(source, destination)

    monkeypatch.setattr(publication, "promote_file", fail_club_json)

    with pytest.raises(RuntimeError, match="club promotion failed"):
        publish_domains(
            staging,
            published,
            [
                result("leagues", Decision.PUBLISH),
                result("clubs", Decision.PUBLISH),
            ],
        )

    assert (published / "league_data.json").read_bytes() == b"old-league-json"
    assert not (published / "league_data.js").exists()
    assert not (published / "club_data.json").exists()
    assert (published / "club_data.js").read_bytes() == b"old-club-js"


def test_identical_files_are_not_promoted_or_returned(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    staging = tmp_path / "staging"
    published = tmp_path / "published"
    write_files(
        staging, {"archive_data.js": b"same", "archive_tables.js": b"new"}
    )
    write_files(
        published, {"archive_data.js": b"same", "archive_tables.js": b"old"}
    )
    real_promote = publication.promote_file
    promoted: list[str] = []

    def record(source: Path, destination: Path) -> None:
        promoted.append(destination.name)
        real_promote(source, destination)

    monkeypatch.setattr(publication, "promote_file", record)

    changed = publish_domains(
        staging, published, [result("archives", Decision.PUBLISH)]
    )

    assert promoted == ["archive_tables.js"]
    assert changed == [published / "archive_tables.js"]


@pytest.mark.parametrize(
    "results, message",
    [
        (
            [result("rankings", Decision.RETAIN), result("rankings", Decision.PUBLISH)],
            "duplicate",
        ),
        ([result("unknown", Decision.PUBLISH)], "unknown"),
    ],
)
def test_invalid_result_domains_are_rejected_before_mutation(
    tmp_path: Path, results: list[ValidationResult], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        publish_domains(tmp_path / "staging", tmp_path / "published", results)


def test_rollback_failure_is_reported_with_original_as_cause(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    staging = tmp_path / "staging"
    published = tmp_path / "published"
    write_files(
        staging, {"club_data.json": b"new-json", "club_data.js": b"new-js"}
    )
    write_files(
        published, {"club_data.json": b"old-json", "club_data.js": b"old-js"}
    )
    original = RuntimeError("promotion failed")
    calls = 0
    real_promote = publication.promote_file

    def fail_second(source: Path, destination: Path) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise original
        real_promote(source, destination)

    def fail_restore(destination: Path, previous: bytes | None) -> None:
        if destination.name == "club_data.json":
            raise OSError("restore denied")
        publication._restore_destination_original(destination, previous)

    monkeypatch.setattr(publication, "promote_file", fail_second)
    monkeypatch.setattr(publication, "_restore_destination", fail_restore)

    with pytest.raises(PublicationError, match="club_data.json.*restore denied") as caught:
        publish_domains(staging, published, [result("clubs", Decision.PUBLISH)])

    assert caught.value.__cause__ is original


def test_write_report_contains_stable_publication_data(tmp_path: Path) -> None:
    report_path = tmp_path / "nested" / "report.json"
    results = [
        result("leagues", Decision.PUBLISH),
        result("rankings", Decision.RETAIN, reasons=("Noch nicht vollständig",)),
    ]
    started = datetime(2026, 8, 1, 8, 30, tzinfo=UTC)
    finished = datetime(2026, 8, 1, 8, 31, tzinfo=UTC)

    report = write_report(
        report_path,
        results,
        [Path("elsewhere/league_data.json"), Path("league_data.js")],
        started,
        finished,
    )

    assert report == {
        "started_at": "2026-08-01T08:30:00+00:00",
        "finished_at": "2026-08-01T08:31:00+00:00",
        "success": True,
        "domains": [item.to_dict() for item in results],
        "published_files": ["league_data.json", "league_data.js"],
    }
    assert json.loads(report_path.read_text(encoding="utf-8")) == report
    raw = report_path.read_bytes()
    assert raw.endswith(b"\n")
    assert b"\r\n" not in raw
    assert "vollständig" in report_path.read_text(encoding="utf-8")


@pytest.mark.parametrize("decision", [Decision.BLOCKED, Decision.FAILED])
def test_blocked_or_failed_report_is_unsuccessful(
    tmp_path: Path, decision: Decision
) -> None:
    report = write_report(
        tmp_path / "report.json",
        [result("clubs", decision)],
        [],
        datetime.now(UTC),
        datetime.now(UTC),
    )
    assert report["success"] is False


def test_render_step_summary_escapes_table_breaking_reasons() -> None:
    report = {
        "success": False,
        "domains": [
            result(
                "rankings",
                Decision.BLOCKED,
                reasons=("missing | category\ntry later",),
            ).to_dict(),
            result("clubs", Decision.PUBLISH).to_dict(),
        ],
        "published_files": ["club_data.json", "club_data.js"],
    }

    summary = render_step_summary(report)

    assert summary.startswith("## Data publication summary\n")
    assert "| Domain | Decision | Season | Reasons |" in summary
    assert summary.count("\n| rankings |") == 1
    assert summary.count("\n| clubs |") == 1
    assert "missing \\| category try later" in summary
    assert "club_data.json, club_data.js" in summary


def test_report_cli_prints_summary(tmp_path: Path) -> None:
    report_path = tmp_path / "report.json"
    write_report(
        report_path,
        [result("rankings", Decision.PUBLISH)],
        [Path("ranking_data.json")],
        datetime.now(UTC),
        datetime.now(UTC),
    )

    completed = subprocess.run(
        [sys.executable, "-m", "pipeline.report", "--summary", str(report_path)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0
    assert "## Data publication summary" in completed.stdout
    assert "| rankings | publish |" in completed.stdout
    assert completed.stderr == ""


@pytest.mark.parametrize(
    "contents",
    [
        None,
        "not-json",
        '{"success": NaN, "domains": [], "published_files": []}',
    ],
)
def test_report_cli_rejects_missing_or_malformed_report(
    tmp_path: Path, contents: str | None
) -> None:
    report_path = tmp_path / "report.json"
    if contents is not None:
        report_path.write_text(contents, encoding="utf-8")

    completed = subprocess.run(
        [sys.executable, "-m", "pipeline.report", "--summary", str(report_path)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode != 0
    assert "could not read report" in completed.stderr.lower()
    assert contents not in completed.stderr if contents is not None else True
