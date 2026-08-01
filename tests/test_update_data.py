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
    write_js(root / "archive_data.js", "ARCHIVE_DATA", {"1": [{"season": "20/22"}, {"season": "24/25"}]})
    write_js(root / "archive_tables.js", "ARCHIVE_TABLES", [{"season": "2020/2022"}, {"season": "2024/25"}])
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
            write_js(output_dir / "archive_data.js", "ARCHIVE_DATA", {"1": [{"season": "20/22"}, {"season": "24/25"}]})
        elif script.name == "archive_tables_scraper.py":
            write_js(output_dir / "archive_tables.js", "ARCHIVE_TABLES", [{"season": "2020/2022"}, {"season": "2024/25"}])
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
