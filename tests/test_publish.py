from __future__ import annotations

import json
import subprocess
import sys
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path

import pytest

import pipeline.publish as publication
from pipeline.publish import PublicationError, publish_domains
from pipeline.report import render_step_summary, validate_report_schema, write_report
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


def valid_report_dict() -> dict[str, object]:
    return {
        "started_at": "2026-08-01T08:30:00Z",
        "finished_at": "2026-08-01T08:31:00Z",
        "duration_seconds": 60.0,
        "success": True,
        "domains": [
            result("leagues", Decision.PUBLISH).to_dict(),
            result("rankings", Decision.RETAIN).to_dict(),
            result("clubs", Decision.PUBLISH).to_dict(),
            result("archives", Decision.RETAIN).to_dict(),
        ],
        "published_files": ["ranking_data.json"],
    }


def complete_results(
    override_domain: str | None = None,
    override_decision: Decision | None = None,
) -> list[ValidationResult]:
    return [
        result(
            domain,
            override_decision
            if domain == override_domain and override_decision is not None
            else Decision.RETAIN,
        )
        for domain in ("leagues", "rankings", "clubs", "archives")
    ]


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


def test_publish_preserves_predictable_temp_sentinels(tmp_path: Path) -> None:
    staging = tmp_path / "staging"
    published = tmp_path / "published"
    write_files(
        staging,
        {"ranking_data.json": b"new-json", "ranking_data.js": b"new-js"},
    )
    next_sentinel = published / "ranking_data.json.next"
    rollback_sentinel = published / "ranking_data.js.rollback"
    write_files(
        published,
        {
            "ranking_data.json": b"old-json",
            "ranking_data.js": b"old-js",
            next_sentinel.name: b"next-sentinel",
            rollback_sentinel.name: b"rollback-sentinel",
        },
    )

    publish_domains(staging, published, [result("rankings", Decision.PUBLISH)])

    assert next_sentinel.read_bytes() == b"next-sentinel"
    assert rollback_sentinel.read_bytes() == b"rollback-sentinel"


def test_publish_uses_canonical_domain_order_for_every_result_permutation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    staging = tmp_path / "staging"
    candidate = {
        "league_data.json": b"league-json",
        "league_data.js": b"league-js",
        "club_data.json": b"club-json",
        "club_data.js": b"club-js",
    }
    write_files(staging, candidate)
    real_promote = publication.promote_file
    observed_orders: list[list[str]] = []

    for index, results in enumerate(
        (
            [result("clubs", Decision.PUBLISH), result("leagues", Decision.PUBLISH)],
            [result("leagues", Decision.PUBLISH), result("clubs", Decision.PUBLISH)],
        )
    ):
        promoted: list[str] = []

        def record(source: Path, destination: Path) -> None:
            promoted.append(destination.name)
            real_promote(source, destination)

        monkeypatch.setattr(publication, "promote_file", record)
        published = tmp_path / f"published-{index}"
        changed = publish_domains(staging, published, results)
        observed_orders.append(promoted)
        assert [path.name for path in changed] == promoted

    assert observed_orders == [
        ["league_data.json", "league_data.js", "club_data.json", "club_data.js"],
        ["league_data.json", "league_data.js", "club_data.json", "club_data.js"],
    ]


def test_non_regular_candidate_is_rejected_before_any_destination_changes(
    tmp_path: Path,
) -> None:
    staging = tmp_path / "staging"
    published = tmp_path / "published"
    write_files(
        staging,
        {"league_data.json": b"new-json", "league_data.js": b"new-js"},
    )
    (staging / "club_data.json").mkdir()
    write_files(staging, {"club_data.js": b"new-club-js"})
    write_files(
        published,
        {"league_data.json": b"old-json", "league_data.js": b"old-js"},
    )

    with pytest.raises(ValueError, match="source"):
        publish_domains(
            staging,
            published,
            [result("leagues", Decision.PUBLISH), result("clubs", Decision.PUBLISH)],
        )

    assert (published / "league_data.json").read_bytes() == b"old-json"
    assert (published / "league_data.js").read_bytes() == b"old-js"


def test_non_regular_destination_is_rejected_before_any_destination_changes(
    tmp_path: Path,
) -> None:
    staging = tmp_path / "staging"
    published = tmp_path / "published"
    write_files(
        staging,
        {
            "league_data.json": b"new-json",
            "league_data.js": b"new-js",
            "club_data.json": b"new-club-json",
            "club_data.js": b"new-club-js",
        },
    )
    write_files(
        published,
        {"league_data.json": b"old-json", "league_data.js": b"old-js"},
    )
    (published / "club_data.json").mkdir()

    with pytest.raises(ValueError, match="destination"):
        publish_domains(
            staging,
            published,
            [result("leagues", Decision.PUBLISH), result("clubs", Decision.PUBLISH)],
        )

    assert (published / "league_data.json").read_bytes() == b"old-json"
    assert (published / "league_data.js").read_bytes() == b"old-js"
    assert (published / "club_data.json").is_dir()


@pytest.mark.parametrize("link_kind", ["source", "destination"])
def test_symlink_candidate_is_rejected_before_any_destination_changes(
    tmp_path: Path, link_kind: str
) -> None:
    staging = tmp_path / "staging"
    published = tmp_path / "published"
    write_files(
        staging,
        {
            "league_data.json": b"new-json",
            "league_data.js": b"new-js",
            "club_data.js": b"new-club-js",
        },
    )
    write_files(
        published,
        {"league_data.json": b"old-json", "league_data.js": b"old-js"},
    )
    link = (
        staging / "club_data.json"
        if link_kind == "source"
        else published / "club_data.json"
    )
    target = tmp_path / "symlink-target.json"
    target.write_bytes(b"target-sentinel")
    if link_kind == "destination":
        write_files(staging, {"club_data.json": b"new-club-json"})
    try:
        link.symlink_to(target)
    except OSError as error:
        pytest.skip(f"symlinks unavailable: {error}")

    with pytest.raises(ValueError, match=link_kind):
        publish_domains(
            staging,
            published,
            [result("leagues", Decision.PUBLISH), result("clubs", Decision.PUBLISH)],
        )

    assert (published / "league_data.json").read_bytes() == b"old-json"
    assert (published / "league_data.js").read_bytes() == b"old-js"
    assert target.read_bytes() == b"target-sentinel"


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


def test_second_promotion_failure_restores_pair_and_preserves_unowned_sentinel(
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
    assert (published / "ranking_data.js.next").read_bytes() == b"debris"
    assert not list(published.glob(".ranking_data.*.next-*"))
    assert not list(published.glob(".ranking_data.*.rollback-*"))


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


def test_unhashable_result_domain_is_rejected_intentionally_before_mutation(
    tmp_path: Path,
) -> None:
    invalid = ValidationResult(
        domain=[],  # type: ignore[arg-type]
        decision=Decision.PUBLISH,
        effective_season="2026/27",
    )

    with pytest.raises(ValueError, match="domain"):
        publish_domains(tmp_path / "staging", tmp_path / "published", [invalid])

    assert not (tmp_path / "published").exists()


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


def test_promotion_cleanup_failure_rolls_back_and_is_reraised(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    staging = tmp_path / "staging"
    published = tmp_path / "published"
    write_files(
        staging,
        {"ranking_data.json": b"new-json", "ranking_data.js": b"new-js"},
    )
    write_files(published, {"ranking_data.json": b"old-json"})
    cleanup_error = OSError("cleanup denied")
    real_promote = publication.promote_file
    calls = 0

    def fail_after_second_promotion(source: Path, destination: Path) -> None:
        nonlocal calls
        calls += 1
        real_promote(source, destination)
        if calls == 2:
            raise cleanup_error

    monkeypatch.setattr(publication, "promote_file", fail_after_second_promotion)

    with pytest.raises(OSError) as caught:
        publish_domains(staging, published, [result("rankings", Decision.PUBLISH)])

    assert caught.value is cleanup_error
    assert (published / "ranking_data.json").read_bytes() == b"old-json"
    assert not (published / "ranking_data.js").exists()
    assert calls == 2


def test_cleanup_failure_during_rollback_is_chained_with_context(
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
    promotion_error = RuntimeError("promotion failed")
    real_promote = publication.promote_file
    calls = 0

    def fail_second(source: Path, destination: Path) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise promotion_error
        real_promote(source, destination)

    real_restore = publication._restore_destination_original

    def fail_cleanup(destination: Path, previous: bytes | None) -> None:
        real_restore(destination, previous)
        if destination.name == "club_data.json":
            raise OSError("cleanup denied")

    monkeypatch.setattr(publication, "promote_file", fail_second)
    monkeypatch.setattr(publication, "_restore_destination", fail_cleanup)

    with pytest.raises(
        PublicationError, match="rollback.*club_data.json.*cleanup denied"
    ) as caught:
        publish_domains(staging, published, [result("clubs", Decision.PUBLISH)])

    assert caught.value.__cause__ is promotion_error
    assert (published / "club_data.json").read_bytes() == b"old-json"
    assert (published / "club_data.js").read_bytes() == b"old-js"


def test_write_report_contains_stable_publication_data(tmp_path: Path) -> None:
    report_path = tmp_path / "nested" / "report.json"
    results = [
        result("leagues", Decision.PUBLISH),
        result("rankings", Decision.RETAIN, reasons=("Noch nicht vollständig",)),
        result("clubs", Decision.RETAIN),
        result("archives", Decision.PUBLISH),
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
        "started_at": "2026-08-01T08:30:00Z",
        "finished_at": "2026-08-01T08:31:00Z",
        "duration_seconds": 60.0,
        "success": True,
        "domains": [item.to_dict() for item in results],
        "published_files": ["league_data.json", "league_data.js"],
    }
    assert json.loads(report_path.read_text(encoding="utf-8")) == report
    raw = report_path.read_bytes()
    assert raw.endswith(b"\n")
    assert b"\r\n" not in raw
    assert "vollständig" in report_path.read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "started, finished",
    [
        (datetime(2026, 8, 1, 8, 30), datetime(2026, 8, 1, 8, 31, tzinfo=UTC)),
        (datetime(2026, 8, 1, 8, 30, tzinfo=UTC), datetime(2026, 8, 1, 8, 31)),
        (
            datetime(2026, 8, 1, 8, 31, tzinfo=UTC),
            datetime(2026, 8, 1, 8, 30, tzinfo=UTC),
        ),
    ],
)
def test_write_report_rejects_naive_or_reversed_times(
    tmp_path: Path, started: datetime, finished: datetime
) -> None:
    with pytest.raises(ValueError, match="time|chronology"):
        write_report(
            tmp_path / "report.json",
            [result("rankings", Decision.PUBLISH)],
            [],
            started,
            finished,
        )
    assert not (tmp_path / "report.json").exists()


def test_write_report_orders_domains_canonically(tmp_path: Path) -> None:
    started = datetime(2026, 8, 1, 8, 30, tzinfo=UTC)
    finished = datetime(2026, 8, 1, 8, 30, 1, 250000, tzinfo=UTC)
    reports = []
    for index, results in enumerate(
        (
            [
                result("clubs", Decision.RETAIN),
                result("archives", Decision.RETAIN),
                result("leagues", Decision.PUBLISH),
                result("rankings", Decision.RETAIN),
            ],
            [
                result("rankings", Decision.RETAIN),
                result("leagues", Decision.PUBLISH),
                result("archives", Decision.RETAIN),
                result("clubs", Decision.RETAIN),
            ],
        )
    ):
        reports.append(
            write_report(
                tmp_path / f"report-{index}.json",
                results,
                [Path("league_data.json")],
                started,
                finished,
            )
        )

    assert reports[0] == reports[1]
    assert [domain["domain"] for domain in reports[0]["domains"]] == [
        "leagues",
        "rankings",
        "clubs",
        "archives",
    ]
    assert reports[0]["duration_seconds"] == 1.25


@pytest.mark.parametrize("decision", [Decision.BLOCKED, Decision.FAILED])
def test_blocked_or_failed_report_is_unsuccessful(
    tmp_path: Path, decision: Decision
) -> None:
    report = write_report(
        tmp_path / "report.json",
        complete_results("clubs", decision),
        [],
        datetime.now(UTC),
        datetime.now(UTC),
    )
    assert report["success"] is False


def test_write_report_rejects_omitted_domain(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="domain"):
        write_report(
            tmp_path / "report.json",
            complete_results()[:-1],
            [],
            datetime.now(UTC),
            datetime.now(UTC),
        )
    assert not (tmp_path / "report.json").exists()


def test_render_step_summary_escapes_table_breaking_reasons() -> None:
    report = valid_report_dict()
    report["success"] = False
    report["domains"] = [
        result("leagues", Decision.RETAIN).to_dict(),
        result(
            "rankings",
            Decision.BLOCKED,
            reasons=("missing | category\ntry later",),
        ).to_dict(),
        result("clubs", Decision.PUBLISH).to_dict(),
        result("archives", Decision.RETAIN).to_dict(),
    ]
    report["published_files"] = ["club_data.json", "club_data.js"]

    summary = render_step_summary(report)

    assert summary.startswith("## Data publication summary\n")
    assert "| Domain | Decision | Season | Reasons |" in summary
    assert summary.count("\n| rankings |") == 1
    assert summary.count("\n| clubs |") == 1
    assert "missing \\| category try later" in summary
    assert "club_data.json, club_data.js" in summary


REPORT_SCHEMA_FAILURE_CASES = (
    "missing_timestamps",
    "empty_domains",
    "missing_domain",
    "extra_domain",
    "unknown_domain",
    "duplicate_domain",
    "wrong_domain_order",
    "incomplete_domain",
    "wrong_success_type",
    "success_true_with_blocked",
    "success_true_with_failed",
    "success_false_with_ready",
    "wrong_domains_type",
    "wrong_reasons_type",
    "wrong_metric_type",
    "wrong_domain_type",
    "wrong_decision_type",
    "bad_decision",
    "bad_timestamp",
    "reversed_timestamps",
    "bad_duration",
    "duration_mismatch",
    "bad_filename",
    "wrong_filename_type",
    "wrong_published_files_type",
    "duplicate_filename",
)


def malformed_report(case: str) -> dict[str, object]:
    report = deepcopy(valid_report_dict())
    domains = report["domains"]
    assert isinstance(domains, list)
    domain = domains[0]
    assert isinstance(domain, dict)

    if case == "missing_timestamps":
        del report["started_at"]
    elif case == "empty_domains":
        report["domains"] = []
    elif case == "missing_domain":
        domains.pop()
    elif case == "extra_domain":
        extra = deepcopy(domain)
        extra["domain"] = "extra"
        domains.append(extra)
    elif case == "unknown_domain":
        domain["domain"] = "unknown"
    elif case == "duplicate_domain":
        domains.append(deepcopy(domain))
    elif case == "wrong_domain_order":
        domains[0], domains[1] = domains[1], domains[0]
    elif case == "incomplete_domain":
        del domain["metrics"]
    elif case == "wrong_success_type":
        report["success"] = 1
    elif case == "success_true_with_blocked":
        domain["decision"] = Decision.BLOCKED.value
    elif case == "success_true_with_failed":
        domain["decision"] = Decision.FAILED.value
    elif case == "success_false_with_ready":
        report["success"] = False
    elif case == "wrong_domains_type":
        report["domains"] = {}
    elif case == "wrong_reasons_type":
        domain["reasons"] = "secret-reason"
    elif case == "wrong_metric_type":
        domain["metrics"] = {"records": True}
    elif case == "wrong_domain_type":
        domain["domain"] = []
    elif case == "wrong_decision_type":
        domain["decision"] = []
    elif case == "bad_decision":
        domain["decision"] = "maybe"
    elif case == "bad_timestamp":
        report["started_at"] = "yesterday"
    elif case == "reversed_timestamps":
        report["finished_at"] = "2026-08-01T08:29:00Z"
    elif case == "bad_duration":
        report["duration_seconds"] = True
    elif case == "duration_mismatch":
        report["duration_seconds"] = 59.0
    elif case == "bad_filename":
        report["published_files"] = ["../secret.json"]
    elif case == "wrong_filename_type":
        report["published_files"] = [3]
    elif case == "wrong_published_files_type":
        report["published_files"] = "ranking_data.json"
    elif case == "duplicate_filename":
        report["published_files"] = ["ranking_data.json", "ranking_data.json"]
    return report


@pytest.mark.parametrize("case", REPORT_SCHEMA_FAILURE_CASES)
def test_validate_report_schema_rejects_malformed_reports(case: str) -> None:
    report = malformed_report(case)

    with pytest.raises(ValueError):
        validate_report_schema(report)


def test_render_step_summary_uses_strict_report_validation() -> None:
    report = valid_report_dict()
    report["published_files"] = ["nested/secret.json"]

    with pytest.raises(ValueError):
        render_step_summary(report)


def test_report_cli_prints_summary(tmp_path: Path) -> None:
    report_path = tmp_path / "report.json"
    write_report(
        report_path,
        complete_results("rankings", Decision.PUBLISH),
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
    "case",
    [
        "missing_timestamps",
        "empty_domains",
        "missing_domain",
        "extra_domain",
        "unknown_domain",
        "duplicate_domain",
        "wrong_domain_order",
        "incomplete_domain",
        "wrong_success_type",
        "success_true_with_blocked",
        "success_true_with_failed",
        "wrong_domains_type",
        "wrong_reasons_type",
        "bad_decision",
        "bad_timestamp",
        "bad_filename",
    ],
)
def test_report_cli_rejects_invalid_schema_without_echoing_contents(
    tmp_path: Path, case: str
) -> None:
    report_path = tmp_path / "report.json"
    report = malformed_report(case)
    report_path.write_text(json.dumps(report), encoding="utf-8")

    completed = subprocess.run(
        [sys.executable, "-m", "pipeline.report", "--summary", str(report_path)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode != 0
    assert "could not read report" in completed.stderr.lower()
    assert "secret-reason" not in completed.stderr


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
