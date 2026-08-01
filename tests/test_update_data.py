from __future__ import annotations

import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

import update_data
from pipeline.files import write_json_pair
from pipeline.validation import REQUIRED_RANKING_CATEGORIES, parse_javascript_assignment


REGULAR_LEAGUES = (
    "Bezirksliga",
    "A-Klasse Gruppe 1",
    "A-Klasse Gruppe 2",
    "B-Klasse Gruppe 1",
    "B-Klasse Gruppe 2",
    "B-Klasse Gruppe 3",
    "C-Klasse Gruppe 1",
    "C-Klasse Gruppe 2",
    "C-Klasse Gruppe 3",
    "C-Klasse Gruppe 4",
    "C-Klasse Gruppe 5",
    "Mix B-Klasse",
    "Mix C-Klasse",
)


def league_table(name: str) -> str:
    return (
        "<table><tbody><tr>"
        + "".join(f"<td>{value}</td>" for value in ("Pl.", "Tabelle", "Sp", "g", "u", "v", "Spiele", "±", "Pkt"))
        + f"</tr><tr><td>1</td><td>{name} Team</td>"
        + "<td>0</td>" * 7
        + "</tr></tbody></table>"
    )


def leagues() -> dict[str, Any]:
    return {
        "leagues": {
            f"{name} 2026-2027": {
                "url": "https://example.test",
                "table": league_table(name),
                "match_days": {
                    f"{day}. Spieltag": "Mo. 24. 8.2026 20:00 Team A - Team B 0:0"
                    for day in range(1, 19)
                },
            }
            for name in REGULAR_LEAGUES
        }
    }


def rankings(categories: tuple[str, ...] = REQUIRED_RANKING_CATEGORIES) -> dict[str, Any]:
    return {
        "rankings": {category: f"<table>{category}</table>" for category in categories},
        "players": [
            {"id": str(index), "name": f"Player {index}", "league": category}
            for index, category in enumerate(categories, 1)
        ],
    }


def clubs() -> dict[str, Any]:
    return {
        "clubs": [
            {"name": f"Club {index}", "number": str(index)} for index in range(1, 11)
        ]
    }


def write_js(path: Path, global_name: str, payload: Any) -> None:
    path.write_text(
        f"window.{global_name} = {json.dumps(payload, ensure_ascii=False)};\n",
        encoding="utf-8",
        newline="\n",
    )


def status_payload() -> dict[str, Any]:
    return {
        "generated_at": "2026-08-01T13:17:22Z",
        "domains": {
            "leagues": {"season": "2025/26", "state": "current", "updated_at": "2026-08-01T13:17:22Z"},
            "rankings": {"season": "2025/26", "state": "current", "updated_at": "2026-06-10T03:04:09Z"},
            "clubs": {"season": "current", "state": "current", "updated_at": "2026-08-01T13:17:22Z"},
            "archives": {"season": "historical", "state": "current", "updated_at": "2026-08-01T13:17:22Z"},
        },
    }


def seed_root(root: Path) -> None:
    root.mkdir()
    write_json_pair(root, "league_data", "LEAGUE_DATA", leagues())
    write_json_pair(root, "ranking_data", "RANKING_DATA", rankings())
    write_json_pair(root, "club_data", "CLUB_DATA", clubs())
    write_js(root / "archive_data.js", "ARCHIVE_DATA", {"1": [{"season": "20/22", "league": "A-Klasse"}, {"season": "24/25", "league": "A-Klasse"}]})
    write_js(root / "archive_tables.js", "ARCHIVE_TABLES", [{"season": "2020/2022", "league": "A-Klasse", "rows": []}, {"season": "2024/25", "league": "A-Klasse", "rows": []}])
    write_json_pair(root, "data_status", "DATA_STATUS", status_payload())


def fake_runner(candidate_rankings: dict[str, Any] | None = None, *, fail_script: str | None = None):
    def run(script: Path, output_dir: Path, artifacts_dir: Path) -> int:
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        if script.name == fail_script:
            return 7
        if script.name == "league_scraper.py":
            write_json_pair(output_dir, "league_data", "LEAGUE_DATA", leagues())
        elif script.name == "ranking_scraper.py" and candidate_rankings is not None:
            write_json_pair(output_dir, "ranking_data", "RANKING_DATA", candidate_rankings)
        elif script.name == "club_scraper.py":
            write_json_pair(output_dir, "club_data", "CLUB_DATA", clubs())
        elif script.name == "archive_scraper.py":
            write_js(output_dir / "archive_data.js", "ARCHIVE_DATA", {"1": [{"season": "20/22", "league": "A-Klasse"}, {"season": "24/25", "league": "A-Klasse"}]})
        elif script.name == "archive_tables_scraper.py":
            write_js(output_dir / "archive_tables.js", "ARCHIVE_TABLES", [{"season": "2020/2022", "league": "A-Klasse", "rows": []}, {"season": "2024/25", "league": "A-Klasse", "rows": []}])
        return 0

    return run


NOW = datetime(2026, 8, 1, 15, 30, tzinfo=UTC)


def snapshot(root: Path) -> dict[str, bytes]:
    return {path.name: path.read_bytes() for path in root.iterdir() if path.name not in {"update_report.json", "update_status.json"}}


def test_empty_rankings_retain_prior_bytes_and_publish_other_domains(tmp_path: Path) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    prior_ranking = (root / "ranking_data.json").read_bytes(), (root / "ranking_data.js").read_bytes()

    code = update_data.run_update(root, staging, artifacts, scraper_runner=fake_runner({"rankings": {}, "players": []}), clock=lambda: NOW)

    assert code == 0
    assert ((root / "ranking_data.json").read_bytes(), (root / "ranking_data.js").read_bytes()) == prior_ranking
    report = json.loads((root / "update_report.json").read_text(encoding="utf-8"))
    assert [item["domain"] for item in report["domains"]] == ["leagues", "rankings", "clubs", "archives"]
    assert [item["decision"] for item in report["domains"]] == ["publish", "retain", "publish", "publish"]
    status = json.loads((root / "data_status.json").read_text(encoding="utf-8"))
    assert status["domains"]["rankings"] == {"season": "2025/26", "state": "retained", "updated_at": "2026-06-10T03:04:09Z"}
    assert status == parse_javascript_assignment((root / "data_status.js").read_text(encoding="utf-8"), "DATA_STATUS")


def test_complete_rankings_publish_with_league_season(tmp_path: Path) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)

    assert update_data.run_update(root, staging, artifacts, scraper_runner=fake_runner(rankings()), clock=lambda: NOW) == 0

    status = json.loads((root / "data_status.json").read_text(encoding="utf-8"))
    assert status["domains"]["rankings"] == {"season": "2026/27", "state": "current", "updated_at": "2026-08-01T15:30:00Z"}
    published = json.loads((root / "ranking_data.json").read_text(encoding="utf-8"))
    assert "season" not in published


def test_stale_explicit_ranking_season_blocks_whole_publication(tmp_path: Path) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    candidate = rankings()
    candidate["season"] = "2025/26"
    before = snapshot(root)

    assert update_data.run_update(
        root, staging, artifacts, scraper_runner=fake_runner(candidate), clock=lambda: NOW
    ) == 1

    assert snapshot(root) == before
    report = json.loads((root / "update_report.json").read_text(encoding="utf-8"))
    assert report["domains"][1]["decision"] == "blocked"
    assert "season" in " ".join(report["domains"][1]["reasons"]).lower()


@pytest.mark.parametrize("candidate", [rankings(REQUIRED_RANKING_CATEGORIES[:3]), None])
def test_partial_or_missing_ranking_candidate_never_replaces_prior(tmp_path: Path, candidate: dict[str, Any] | None) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    before = (root / "ranking_data.json").read_bytes()
    code = update_data.run_update(root, staging, artifacts, scraper_runner=fake_runner(candidate), clock=lambda: NOW)
    report = json.loads((root / "update_report.json").read_text(encoding="utf-8"))
    ranking = report["domains"][1]
    if candidate is None:
        assert code == 1 and ranking["decision"] in {"failed", "blocked"}
    else:
        assert code == 0 and ranking["decision"] == "retain"
    assert (root / "ranking_data.json").read_bytes() == before


def test_scraper_failure_prevents_every_public_mutation(tmp_path: Path) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    before = snapshot(root)

    code = update_data.run_update(root, staging, artifacts, scraper_runner=fake_runner(rankings(), fail_script="club_scraper.py"), clock=lambda: NOW)

    assert code == 1
    assert snapshot(root) == before
    report = json.loads((root / "update_report.json").read_text(encoding="utf-8"))
    assert len(report["domains"]) == 4
    assert report["domains"][2]["decision"] == "failed"
    concise = json.loads((root / "update_status.json").read_text(encoding="utf-8"))
    assert concise["success"] is False


def test_publisher_failure_rolls_back_and_is_reported(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    before = snapshot(root)

    def fail(*args: Any, **kwargs: Any) -> list[Path]:
        raise OSError("publisher exploded")

    monkeypatch.setattr(update_data, "publish_domains", fail)
    assert update_data.run_update(root, staging, artifacts, scraper_runner=fake_runner(rankings()), clock=lambda: NOW) == 1
    assert snapshot(root) == before
    report = json.loads((root / "update_report.json").read_text(encoding="utf-8"))
    assert report["success"] is False
    assert "publisher exploded" in " ".join(report["domains"][0]["reasons"])


def test_dry_run_reports_without_public_writes(tmp_path: Path) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    before = snapshot(root)

    assert update_data.run_update(root, staging, artifacts, scraper_runner=fake_runner(rankings()), dry_run=True, clock=lambda: NOW) == 0
    assert snapshot(root) == before
    report = json.loads((root / "update_report.json").read_text(encoding="utf-8"))
    assert report["published_files"] == []


def test_noop_run_keeps_status_pair_byte_identical(tmp_path: Path) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    prior = status_payload()
    prior["domains"]["leagues"]["season"] = "2026/27"
    prior["domains"]["rankings"]["season"] = "2026/27"
    write_json_pair(root, "data_status", "DATA_STATUS", prior)
    before = (root / "data_status.json").read_bytes(), (root / "data_status.js").read_bytes()

    assert update_data.run_update(root, staging, artifacts, scraper_runner=fake_runner(rankings()), clock=lambda: NOW) == 0

    assert ((root / "data_status.json").read_bytes(), (root / "data_status.js").read_bytes()) == before


def test_malformed_candidate_pair_fails_without_public_mutation(tmp_path: Path) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    before = snapshot(root)
    base_runner = fake_runner(rankings())

    def malformed(script: Path, output_dir: Path, artifacts_dir: Path) -> int:
        code = base_runner(script, output_dir, artifacts_dir)
        if script.name == "club_scraper.py":
            (output_dir / "club_data.js").write_text("window.CLUB_DATA = {};\n", encoding="utf-8")
        return code

    assert update_data.run_update(root, staging, artifacts, scraper_runner=malformed, clock=lambda: NOW) == 1
    assert snapshot(root) == before
    report = json.loads((root / "update_report.json").read_text(encoding="utf-8"))
    assert report["domains"][2]["decision"] == "failed"
    assert "differ" in " ".join(report["domains"][2]["reasons"])


def test_nonempty_staging_is_refused_without_deletion(tmp_path: Path) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    staging.mkdir()
    sentinel = staging / "keep.txt"
    sentinel.write_text("keep", encoding="utf-8")

    assert update_data.run_update(root, staging, artifacts, scraper_runner=fake_runner(rankings()), clock=lambda: NOW) == 1
    assert sentinel.read_text(encoding="utf-8") == "keep"


def test_run_scraper_uses_exact_unbuffered_command(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    observed: list[Any] = []

    def fake_run(command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        observed.append((command, kwargs))
        return subprocess.CompletedProcess(command, 9)

    monkeypatch.setattr(update_data.subprocess, "run", fake_run)
    script, output, artifacts = tmp_path / "scraper.py", tmp_path / "output", tmp_path / "artifacts"

    assert update_data.run_scraper(script, output, artifacts) == 9
    assert observed[0][0] == [sys.executable, "-u", str(script), "--output-dir", str(output), "--artifacts-dir", str(artifacts)]


def test_each_scraper_receives_its_own_artifact_subdirectory(tmp_path: Path) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    base_runner = fake_runner(rankings())
    observed: dict[str, Path] = {}

    def recording_runner(script: Path, output_dir: Path, artifacts_dir: Path) -> int:
        observed[script.name] = artifacts_dir
        return base_runner(script, output_dir, artifacts_dir)

    assert update_data.run_update(
        root,
        staging,
        artifacts,
        scraper_runner=recording_runner,
        dry_run=True,
        clock=lambda: NOW,
    ) == 0
    assert observed == {
        script_name: artifacts / Path(script_name).stem
        for script_name in update_data.SCRAPERS
    }
    assert len(set(observed.values())) == 5


@pytest.mark.parametrize(
    ("validator_name", "domain"),
    [
        ("validate_leagues", "leagues"),
        ("validate_rankings", "rankings"),
        ("validate_clubs", "clubs"),
        ("_validate_archives", "archives"),
    ],
)
def test_validator_exception_becomes_canonical_failed_report(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    validator_name: str,
    domain: str,
) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    before = snapshot(root)

    def explode(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("validator exploded")

    monkeypatch.setattr(update_data, validator_name, explode)
    assert update_data.run_update(
        root, staging, artifacts, scraper_runner=fake_runner(rankings()), clock=lambda: NOW
    ) == 1
    assert snapshot(root) == before
    report = json.loads((root / "update_report.json").read_text(encoding="utf-8"))
    assert [item["domain"] for item in report["domains"]] == list(update_data.DOMAIN_ORDER)
    failed = next(item for item in report["domains"] if item["domain"] == domain)
    assert failed["decision"] == "failed"
    assert "validator exploded" in " ".join(failed["reasons"])


@pytest.mark.parametrize("stage", ["changed", "status", "status_write", "publisher"])
def test_prepublication_exception_is_reported_without_public_mutation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, stage: str
) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    before = snapshot(root)

    def explode(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError(f"{stage} exploded")

    if stage == "changed":
        monkeypatch.setattr(update_data, "_changed_domains", explode)
    elif stage == "status":
        monkeypatch.setattr(update_data, "_build_status", explode)
    elif stage == "status_write":
        real_write = update_data.write_json_pair

        def fail_status(output_dir: Path, stem: str, global_name: str, payload: dict[str, Any]):
            if stem == "data_status":
                raise RuntimeError("status_write exploded")
            return real_write(output_dir, stem, global_name, payload)

        monkeypatch.setattr(update_data, "write_json_pair", fail_status)
    else:
        monkeypatch.setattr(update_data, "publish_domains", explode)

    assert update_data.run_update(
        root, staging, artifacts, scraper_runner=fake_runner(rankings()), clock=lambda: NOW
    ) == 1
    assert snapshot(root) == before
    report = json.loads((root / "update_report.json").read_text(encoding="utf-8"))
    assert report["success"] is False
    assert len(report["domains"]) == 4


@pytest.mark.parametrize(
    "mutate",
    [
        lambda status: status.update({"generated_at": "not-a-time"}),
        lambda status: status["domains"]["clubs"].update({"state": "maybe"}),
        lambda status: status["domains"]["clubs"].update({"season": " "}),
        lambda status: status["domains"]["clubs"].update({"updated_at": "2026-08-01"}),
        lambda status: status["domains"].update({"extra": dict(status["domains"]["clubs"])}),
    ],
)
def test_malformed_prior_status_becomes_controlled_failed_report(
    tmp_path: Path, mutate: Any
) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    malformed = status_payload()
    mutate(malformed)
    write_json_pair(root, "data_status", "DATA_STATUS", malformed)

    assert update_data.run_update(
        root, staging, artifacts, scraper_runner=fake_runner(rankings()), clock=lambda: NOW
    ) == 1
    report = json.loads((root / "update_report.json").read_text(encoding="utf-8"))
    assert len(report["domains"]) == 4
    assert all(item["decision"] == "failed" for item in report["domains"])


def test_main_removes_only_its_generated_staging_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "root"
    root.mkdir()
    generated = root / ".staging" / "run-fixed"

    def fake_update(root_arg: Path, staging: Path, artifacts: Path, **kwargs: Any) -> int:
        assert root_arg == root
        staging.mkdir(parents=True)
        (staging / "diagnostic.txt").write_text("temporary", encoding="utf-8")
        return 0

    monkeypatch.setattr(update_data.uuid, "uuid4", lambda: "fixed")
    monkeypatch.setattr(update_data, "run_update", fake_update)

    assert update_data.main([], root=root) == 0
    assert not generated.exists()


def test_main_preserves_explicit_and_nonmatching_staging_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "root"
    root.mkdir()
    explicit = tmp_path / "caller-staging"
    nonmatching = root / ".staging" / "keep-me"
    nonmatching.mkdir(parents=True)
    (nonmatching / "sentinel.txt").write_text("keep", encoding="utf-8")

    def fake_update(root_arg: Path, staging: Path, artifacts: Path, **kwargs: Any) -> int:
        staging.mkdir(parents=True)
        (staging / "sentinel.txt").write_text("keep", encoding="utf-8")
        return 0

    monkeypatch.setattr(update_data, "run_update", fake_update)

    assert update_data.main(["--staging-dir", str(explicit)], root=root) == 0
    assert (explicit / "sentinel.txt").read_text(encoding="utf-8") == "keep"
    update_data._cleanup_generated_staging(root, nonmatching)
    assert (nonmatching / "sentinel.txt").read_text(encoding="utf-8") == "keep"
