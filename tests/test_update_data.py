from __future__ import annotations

import json
import subprocess
import sys
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

import update_data
from pipeline.archive_players import merge_archive_entries
from pipeline.calendar_feeds import build_calendar_publication, write_calendar_publication
from pipeline.files import write_json_pair
from pipeline.validation import (
    REQUIRED_RANKING_CATEGORIES,
    Decision,
    ValidationResult,
    parse_javascript_assignment,
)


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
        "rankings": {
            category: f"<table><tr><td>{category}</td></tr></table>"
            for category in categories
        },
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
    write_js(
        root / "archive_data.js",
        "ARCHIVE_DATA",
        {"1": [legacy_archive_record("20/22"), legacy_archive_record()]},
    )
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
            write_js(
                output_dir / "archive_data.js",
                "ARCHIVE_DATA",
                {"1": [legacy_archive_record("20/22"), legacy_archive_record()]},
            )
        elif script.name == "archive_tables_scraper.py":
            write_js(output_dir / "archive_tables.js", "ARCHIVE_TABLES", [{"season": "2020/2022", "league": "A-Klasse", "rows": []}, {"season": "2024/25", "league": "A-Klasse", "rows": []}])
        return 0

    return run


def legacy_archive_record(season: str = "24/25") -> dict[str, Any]:
    return {
        "season": season,
        "league": "A-Klasse",
        "rank": 1,
        "name": "Player",
        "points": 12,
    }


def enriched_archive_record() -> dict[str, Any]:
    return {
        **legacy_archive_record(),
        "v_nr": "018",
        "rounds": {"R1": 5, "R2": "x", "R3": 0, "R4": 7},
        "appearances": 3,
        "points_per_appearance": 4.0,
    }


def archive_candidate_runner(candidate_record: dict[str, Any]):
    base_runner = fake_runner(rankings())

    def run(script: Path, output_dir: Path, artifacts_dir: Path) -> int:
        code = base_runner(script, output_dir, artifacts_dir)
        if script.name == "archive_scraper.py":
            write_js(
                output_dir / "archive_data.js",
                "ARCHIVE_DATA",
                {"4711": [candidate_record]},
            )
        return code

    return run


def archive_payload_runner(
    candidate_data: dict[str, Any], candidate_tables: list[dict[str, Any]] | None = None
):
    base_runner = fake_runner(rankings())

    def run(script: Path, output_dir: Path, artifacts_dir: Path) -> int:
        code = base_runner(script, output_dir, artifacts_dir)
        if script.name == "archive_scraper.py":
            write_js(output_dir / "archive_data.js", "ARCHIVE_DATA", candidate_data)
        elif script.name == "archive_tables_scraper.py" and candidate_tables is not None:
            write_js(
                output_dir / "archive_tables.js", "ARCHIVE_TABLES", candidate_tables
            )
        return code

    return run


def segmented_archive_payload(*, include_second: bool = True) -> dict[str, Any]:
    segments = [{
        "id": "4711", "season": "2024/2025", "league": "A-Klasse",
        "rank": 1, "name": "Player", "points": 12, "v_nr": "018",
        "rounds": {"R1": 5, "R2": "Vw", "R3": 0, "R4": 7},
        "appearances": 3, "points_per_appearance": 4.0,
    }]
    if include_second:
        segments.append({
            "id": "4711", "season": "2024/2025", "league": "B-Klasse",
            "rank": 2, "name": "Player", "points": 4,
        })
    return merge_archive_entries(segments)


def segmented_affiliation_payload(marker: str = "Vw") -> dict[str, Any]:
    return merge_archive_entries([{
        "id": "746", "season": "2024/2025", "league": "Bezirksliga",
        "rank": 59, "name": "Tarkan Arik", "points": 3,
        "affiliation_marker": marker, "rounds": {"R1": "x", "R2": 3},
        "appearances": 1, "points_per_appearance": 3.0,
    }])


NOW = datetime(2026, 8, 1, 15, 30, tzinfo=UTC)


def snapshot(root: Path) -> dict[str, bytes]:
    return {path.name: path.read_bytes() for path in root.iterdir() if path.name not in {"update_report.json", "update_status.json"}}


def publication_snapshot(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file()
        and path.name not in {"update_report.json", "update_status.json"}
    }


def result(domain: str, decision: Decision, season: str = "2026/27") -> ValidationResult:
    return ValidationResult(domain, decision, season)


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


def test_lossless_legacy_archive_enrichment_is_published(tmp_path: Path) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    write_js(
        root / "archive_data.js",
        "ARCHIVE_DATA",
        {"4711": [legacy_archive_record()]},
    )
    candidate = enriched_archive_record()

    assert update_data.run_update(
        root,
        staging,
        artifacts,
        scraper_runner=archive_candidate_runner(candidate),
        clock=lambda: NOW,
    ) == 0

    published = parse_javascript_assignment(
        (root / "archive_data.js").read_text(encoding="utf-8"), "ARCHIVE_DATA"
    )
    assert published == {"4711": [candidate]}


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        (lambda record: record.update({"appearances": 2}), "appearances"),
        (
            lambda record: record.update({"points_per_appearance": 4.5}),
            "points per appearance",
        ),
        (lambda record: record.update({"points": 13}), "round sum"),
        (lambda record: record.update({"v_nr": ""}), "club number"),
        (lambda record: record.update({"name": "Other Player"}), "lost 1 record"),
    ],
)
def test_invalid_archive_enrichment_blocks_and_preserves_public_bytes(
    tmp_path: Path, mutation: Any, reason: str
) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    write_js(
        root / "archive_data.js",
        "ARCHIVE_DATA",
        {"4711": [legacy_archive_record()]},
    )
    before = snapshot(root)
    candidate = enriched_archive_record()
    mutation(candidate)

    assert update_data.run_update(
        root,
        staging,
        artifacts,
        scraper_runner=archive_candidate_runner(candidate),
        clock=lambda: NOW,
    ) == 1

    assert snapshot(root) == before
    report = json.loads((root / "update_report.json").read_text(encoding="utf-8"))
    archives = next(item for item in report["domains"] if item["domain"] == "archives")
    assert archives["decision"] == "blocked"
    assert reason in " ".join(archives["reasons"]).lower()


def test_new_unknown_legacy_archive_field_blocks_without_public_mutation(
    tmp_path: Path,
) -> None:
    root, staging, artifacts = (
        tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    )
    seed_root(root)
    write_js(
        root / "archive_data.js",
        "ARCHIVE_DATA",
        {"4711": [legacy_archive_record()]},
    )
    before = (root / "archive_data.js").read_bytes()
    candidate = enriched_archive_record()
    candidate["source_metadata"] = {"nested_unsafe": 2**53}

    code = update_data.run_update(
        root,
        staging,
        artifacts,
        scraper_runner=archive_candidate_runner(candidate),
        clock=lambda: NOW,
    )

    assert code == 1
    assert (root / "archive_data.js").read_bytes() == before
    report = json.loads((root / "update_report.json").read_text(encoding="utf-8"))
    archives = next(item for item in report["domains"] if item["domain"] == "archives")
    assert archives["decision"] == "blocked"
    assert "schema drift" in " ".join(archives["reasons"]).lower()


@pytest.mark.parametrize("change", ["remove", "rewrite"])
def test_published_v2_segment_loss_or_rewrite_blocks_and_preserves_archive_bytes(
    tmp_path: Path, change: str
) -> None:
    root, staging, artifacts = (
        tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    )
    seed_root(root)
    previous = segmented_archive_payload()
    write_js(root / "archive_data.js", "ARCHIVE_DATA", previous)
    before = (root / "archive_data.js").read_bytes()
    source_segments = []
    for segment in previous["4711"][0]["segments"]:
        source_segments.append({
            "id": "4711",
            "season": previous["4711"][0]["season"],
            **{
                key: value for key, value in deepcopy(segment).items()
                if key != "segment_id"
            },
        })
    if change == "remove":
        source_segments.pop()
    else:
        source_segments[0]["rounds"] = {"R1": 4, "R2": 1, "R3": 0, "R4": 7}
        source_segments[0]["appearances"] = 4
        source_segments[0]["points_per_appearance"] = 3.0
    candidate = merge_archive_entries(source_segments)

    code = update_data.run_update(
        root,
        staging,
        artifacts,
        scraper_runner=archive_payload_runner(candidate),
        clock=lambda: NOW,
    )

    assert code == 1
    assert (root / "archive_data.js").read_bytes() == before
    report = json.loads((root / "update_report.json").read_text(encoding="utf-8"))
    archives = next(item for item in report["domains"] if item["domain"] == "archives")
    assert archives["decision"] == "blocked"
    assert "segment" in " ".join(archives["reasons"]).lower()


def test_published_affiliation_marker_segment_cannot_be_silently_rewritten(
    tmp_path: Path,
) -> None:
    root, staging, artifacts = (
        tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    )
    seed_root(root)
    previous = segmented_affiliation_payload("Vw")
    write_js(root / "archive_data.js", "ARCHIVE_DATA", previous)
    before = (root / "archive_data.js").read_bytes()
    candidate = segmented_affiliation_payload("vw")

    code = update_data.run_update(
        root,
        staging,
        artifacts,
        scraper_runner=archive_payload_runner(candidate),
        clock=lambda: NOW,
    )

    assert code == 1
    assert (root / "archive_data.js").read_bytes() == before
    report = json.loads((root / "update_report.json").read_text(encoding="utf-8"))
    archives = next(item for item in report["domains"] if item["domain"] == "archives")
    assert archives["decision"] == "blocked"
    assert "segment" in " ".join(archives["reasons"]).lower()


def test_additive_v2_segment_and_older_season_publish_exact_candidate_bytes(
    tmp_path: Path,
) -> None:
    root, staging, artifacts = (
        tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    )
    seed_root(root)
    previous = segmented_archive_payload(include_second=False)
    write_js(root / "archive_data.js", "ARCHIVE_DATA", previous)
    candidate = segmented_archive_payload(include_second=True)
    older = merge_archive_entries([{
        "id": "4711", "season": "2018/2019", "league": "C-Klasse",
        "rank": 4, "name": "Player", "points": 3,
    }])["4711"][0]
    candidate["4711"].append(older)
    candidate_tables = [
        {"season": "2020/2022", "league": "A-Klasse", "rows": []},
        {"season": "2024/25", "league": "A-Klasse", "rows": []},
        {"season": "2018/2019", "league": "C-Klasse", "rows": []},
    ]

    code = update_data.run_update(
        root,
        staging,
        artifacts,
        scraper_runner=archive_payload_runner(candidate, candidate_tables),
        clock=lambda: NOW,
    )

    assert code == 0
    published = parse_javascript_assignment(
        (root / "archive_data.js").read_text(encoding="utf-8"), "ARCHIVE_DATA"
    )
    assert published == candidate


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


@pytest.mark.parametrize("invalid_season", [2026, ["2026/27"]])
def test_non_string_explicit_ranking_season_is_not_inferred(
    tmp_path: Path, invalid_season: Any
) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    candidate = rankings()
    candidate["season"] = invalid_season
    before = snapshot(root)

    assert update_data.run_update(
        root, staging, artifacts, scraper_runner=fake_runner(candidate), clock=lambda: NOW
    ) == 1
    assert snapshot(root) == before
    report = json.loads((root / "update_report.json").read_text(encoding="utf-8"))
    assert report["domains"][1]["decision"] == "blocked"


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


def test_noop_run_keeps_all_data_and_calendar_bytes_without_publication_changes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    prior = status_payload()
    prior["generated_at"] = "2026-08-01T15:30:00Z"
    prior["domains"]["leagues"]["season"] = "2026/27"
    prior["domains"]["leagues"]["updated_at"] = "2026-08-01T15:30:00Z"
    prior["domains"]["rankings"]["season"] = "2026/27"
    write_json_pair(root, "data_status", "DATA_STATUS", prior)
    write_calendar_publication(
        build_calendar_publication(leagues(), clubs(), updated_at=NOW), root
    )
    before = publication_snapshot(root)
    calls: list[list[Path]] = []
    real_publish = update_data.publish_domains

    def spy_publish(*args: Any, **kwargs: Any) -> list[Path]:
        changed = real_publish(*args, **kwargs)
        calls.append(changed)
        return changed

    monkeypatch.setattr(update_data, "publish_domains", spy_publish)

    assert update_data.run_update(root, staging, artifacts, scraper_runner=fake_runner(rankings()), clock=lambda: NOW) == 0

    assert publication_snapshot(root) == before
    assert calls == [[]]


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


@pytest.mark.parametrize("failure", ["clock", "report", "concise"])
def test_post_promotion_finalization_failure_rolls_back_public_tree(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    before = publication_snapshot(root)
    calls = 0

    def flaky_clock() -> datetime:
        nonlocal calls
        calls += 1
        if failure == "clock" and calls == 3:
            raise RuntimeError("final clock exploded")
        return NOW

    if failure == "report":
        real_report = update_data.write_report
        report_calls = 0

        def flaky_report(*args: Any, **kwargs: Any) -> Any:
            nonlocal report_calls
            report_calls += 1
            if report_calls == 1:
                raise RuntimeError("report exploded")
            return real_report(*args, **kwargs)

        monkeypatch.setattr(update_data, "write_report", flaky_report)
    elif failure == "concise":
        real_concise = update_data._write_concise
        concise_calls = 0

        def flaky_concise(*args: Any, **kwargs: Any) -> Any:
            nonlocal concise_calls
            concise_calls += 1
            if concise_calls == 1:
                raise RuntimeError("concise exploded")
            return real_concise(*args, **kwargs)

        monkeypatch.setattr(update_data, "_write_concise", flaky_concise)

    assert update_data.run_update(
        root,
        staging,
        artifacts,
        scraper_runner=fake_runner({**rankings(), "new": "payload-change"}),
        clock=flaky_clock,
    ) == 1
    assert publication_snapshot(root) == before
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


@pytest.mark.parametrize(
    ("league_decision", "club_decision", "league_source", "club_source"),
    [
        (Decision.PUBLISH, Decision.PUBLISH, "candidate", "candidate"),
        (Decision.PUBLISH, Decision.RETAIN, "candidate", "prior"),
        (Decision.RETAIN, Decision.PUBLISH, "prior", "candidate"),
        (Decision.RETAIN, Decision.RETAIN, "prior", "prior"),
    ],
)
def test_effective_calendar_payloads_follow_final_domain_decisions(
    league_decision: Decision,
    club_decision: Decision,
    league_source: str,
    club_source: str,
) -> None:
    candidates = {"leagues": {"source": "candidate-leagues"}, "clubs": {"source": "candidate-clubs"}}
    previous = {"leagues": {"source": "prior-leagues"}, "clubs": {"source": "prior-clubs"}}
    indexed = {
        "leagues": result("leagues", league_decision),
        "clubs": result("clubs", club_decision),
    }

    assert update_data._effective_payload("leagues", candidates, previous, indexed) is (
        candidates if league_source == "candidate" else previous
    )["leagues"]
    assert update_data._effective_payload("clubs", candidates, previous, indexed) is (
        candidates if club_source == "candidate" else previous
    )["clubs"]


@pytest.mark.parametrize("decision", [Decision.BLOCKED, Decision.FAILED])
def test_effective_calendar_payload_rejects_non_final_or_missing_domain_state(
    decision: Decision,
) -> None:
    candidates = {"leagues": {"source": "candidate"}}
    previous = {"leagues": {"source": "previous"}}

    with pytest.raises(ValueError, match="leagues.*decision"):
        update_data._effective_payload(
            "leagues", candidates, previous, {"leagues": result("leagues", decision)}
        )
    with pytest.raises(ValueError, match="leagues.*result"):
        update_data._effective_payload("leagues", candidates, previous, {})


def test_ready_pipeline_builds_and_writes_calendar_before_one_exact_publication(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    (root / "calendar_state.json").write_text('{"prior": true}\n', encoding="utf-8")
    candidate_leagues = {**leagues(), "source": "candidate-leagues"}
    candidate_clubs = {**clubs(), "source": "candidate-clubs"}
    prior_leagues = json.loads((root / "league_data.json").read_text(encoding="utf-8"))
    prior_clubs = json.loads((root / "club_data.json").read_text(encoding="utf-8"))
    calls: list[str] = []
    captured: dict[str, Any] = {}

    def runner(script: Path, output_dir: Path, artifacts_dir: Path) -> int:
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        if script.name == "league_scraper.py":
            write_json_pair(output_dir, "league_data", "LEAGUE_DATA", candidate_leagues)
        elif script.name == "ranking_scraper.py":
            write_json_pair(output_dir, "ranking_data", "RANKING_DATA", rankings())
        elif script.name == "club_scraper.py":
            write_json_pair(output_dir, "club_data", "CLUB_DATA", candidate_clubs)
        elif script.name == "archive_scraper.py":
            write_js(output_dir / "archive_data.js", "ARCHIVE_DATA", {"1": []})
        elif script.name == "archive_tables_scraper.py":
            write_js(output_dir / "archive_tables.js", "ARCHIVE_TABLES", [])
        return 0

    monkeypatch.setattr(update_data, "validate_leagues", lambda *_: result("leagues", Decision.PUBLISH))
    monkeypatch.setattr(update_data, "validate_rankings", lambda *_: result("rankings", Decision.RETAIN))
    monkeypatch.setattr(update_data, "validate_clubs", lambda *_: result("clubs", Decision.RETAIN, "current"))
    monkeypatch.setattr(update_data, "_validate_archives", lambda *_: result("archives", Decision.RETAIN, "historical"))

    def build(effective_leagues: dict[str, Any], effective_clubs: dict[str, Any], *, previous_state: dict[str, Any] | None, updated_at: datetime) -> object:
        calls.append("build")
        captured.update(leagues=effective_leagues, clubs=effective_clubs, state=previous_state, updated_at=updated_at)
        return object()

    def write(publication: object, output_dir: Path) -> None:
        assert publication is not None
        assert output_dir == staging
        calls.append("write")
        for name in ("calendar_index.json", "calendar_index.js", "calendar_state.json"):
            (output_dir / name).write_bytes(name.encode("ascii"))
        (output_dir / "calendars").mkdir()
        (output_dir / "calendars" / "club-1-team-1.ics").write_bytes(b"calendar")

    def publish(*args: Any, **kwargs: Any) -> list[Path]:
        calls.append("publish")
        assert kwargs["additional_files"] == (
            "data_status.json", "data_status.js",
            "calendar_index.json", "calendar_index.js", "calendar_state.json",
        )
        assert kwargs["additional_directories"] == ("calendars",)
        assert callable(kwargs["finalize"])
        return []

    monkeypatch.setattr(update_data, "build_calendar_publication", build)
    monkeypatch.setattr(update_data, "write_calendar_publication", write)
    monkeypatch.setattr(update_data, "publish_domains", publish)

    assert update_data.run_update(root, staging, artifacts, scraper_runner=runner, clock=lambda: NOW) == 0
    assert calls == ["build", "write", "publish"]
    assert captured["leagues"] == candidate_leagues
    assert captured["clubs"] == prior_clubs
    assert captured["state"] == {"prior": True}
    assert captured["updated_at"] == NOW
    assert captured["leagues"] != prior_leagues
    assert captured["clubs"] != candidate_clubs


def test_dry_run_generates_calendar_only_in_fresh_staging(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    calls: list[Path] = []

    def build(*args: Any, **kwargs: Any) -> object:
        return object()

    def write(_publication: object, output_dir: Path) -> None:
        calls.append(output_dir)
        for name in ("calendar_index.json", "calendar_index.js", "calendar_state.json"):
            (output_dir / name).write_text(name, encoding="utf-8")
        (output_dir / "calendars").mkdir()

    monkeypatch.setattr(update_data, "build_calendar_publication", build)
    monkeypatch.setattr(update_data, "write_calendar_publication", write)
    monkeypatch.setattr(update_data, "publish_domains", lambda *args, **kwargs: pytest.fail("dry run must not publish"))

    assert update_data.run_update(root, staging, artifacts, scraper_runner=fake_runner(rankings()), dry_run=True, clock=lambda: NOW) == 0
    assert calls == [staging]
    assert (staging / "calendar_state.json").is_file()
    assert (staging / "calendars").is_dir()
    assert not (root / "calendar_state.json").exists()
    assert not (root / "calendars").exists()


def test_calendar_generation_failure_keeps_all_existing_publication_bytes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    (root / "calendar_index.json").write_bytes(b"old-index")
    (root / "calendar_index.js").write_bytes(b"old-index-js")
    (root / "calendar_state.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "season": None,
                "updated_at": "2026-08-01T13:17:22Z",
                "events": [],
                "index_fingerprint": "0" * 64,
            }
        ),
        encoding="utf-8",
    )
    (root / "calendars").mkdir()
    (root / "calendars" / "club-1-team-1.ics").write_bytes(b"old-calendar")
    before = publication_snapshot(root)

    def fail(*args: Any, **kwargs: Any) -> object:
        raise RuntimeError("calendar generator exploded")

    monkeypatch.setattr(update_data, "build_calendar_publication", fail)
    assert update_data.run_update(root, staging, artifacts, scraper_runner=fake_runner(rankings()), clock=lambda: NOW) == 1
    assert publication_snapshot(root) == before
    report = json.loads((root / "update_report.json").read_text(encoding="utf-8"))
    assert report["success"] is False
    assert "calendar generator exploded" in " ".join(report["domains"][0]["reasons"])


def test_corrupt_prior_calendar_state_blocks_without_resetting_public_files(
    tmp_path: Path,
) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    (root / "calendar_state.json").write_text("{not-json", encoding="utf-8")
    (root / "calendars").mkdir()
    (root / "calendars" / "club-1-team-1.ics").write_bytes(b"old-calendar")
    before = publication_snapshot(root)

    assert update_data.run_update(root, staging, artifacts, scraper_runner=fake_runner(rankings()), clock=lambda: NOW) == 1

    assert publication_snapshot(root) == before
    report = json.loads((root / "update_report.json").read_text(encoding="utf-8"))
    assert report["success"] is False
    assert "line 1" in " ".join(report["domains"][0]["reasons"]).lower()


@pytest.mark.parametrize("prior_artifact", ["calendar_index.json", "calendar_index.js", "feed"])
def test_missing_calendar_state_with_prior_publication_evidence_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, prior_artifact: str
) -> None:
    root, staging, artifacts = tmp_path / "root", tmp_path / "staging", tmp_path / "artifacts"
    seed_root(root)
    if prior_artifact == "feed":
        (root / "calendars").mkdir()
        (root / "calendars" / "club-1-team-1.ics").write_bytes(b"previous feed")
    else:
        (root / prior_artifact).write_text("previous calendar metadata", encoding="utf-8")
    before = publication_snapshot(root)
    base_runner = fake_runner(rankings())

    def changed_runner(script: Path, output_dir: Path, artifacts_dir: Path) -> int:
        code = base_runner(script, output_dir, artifacts_dir)
        if script.name == "league_scraper.py":
            changed = leagues()
            changed["fixture_revision"] = "changed"
            write_json_pair(output_dir, "league_data", "LEAGUE_DATA", changed)
        return code

    monkeypatch.setattr(
        update_data,
        "build_calendar_publication",
        lambda *args, **kwargs: pytest.fail("missing state must fail before calendar build"),
    )
    monkeypatch.setattr(
        update_data,
        "publish_domains",
        lambda *args, **kwargs: pytest.fail("missing state must fail before publication"),
    )

    assert update_data.run_update(
        root, staging, artifacts, scraper_runner=changed_runner, clock=lambda: NOW
    ) == 1
    assert publication_snapshot(root) == before
    report = json.loads((root / "update_report.json").read_text(encoding="utf-8"))
    assert report["success"] is False
    assert "calendar state" in " ".join(report["domains"][0]["reasons"]).lower()


def test_calendar_generated_at_is_always_the_effective_league_status_timestamp() -> None:
    status = status_payload()
    status["domains"]["leagues"]["updated_at"] = "2026-07-30T09:10:11Z"
    status["domains"]["clubs"]["updated_at"] = "2026-08-01T15:30:00Z"

    assert update_data._calendar_generated_at(status) == datetime(2026, 7, 30, 9, 10, 11, tzinfo=UTC)


@pytest.mark.parametrize("value", [None, "not-a-timestamp", "2026-08-01T10:00:00"])
def test_calendar_generated_at_rejects_missing_or_invalid_league_status_timestamp(value: Any) -> None:
    status = status_payload()
    if value is None:
        del status["domains"]["leagues"]["updated_at"]
    else:
        status["domains"]["leagues"]["updated_at"] = value

    with pytest.raises(ValueError, match="calendar leagues updated_at|calendar league status timestamp"):
        update_data._calendar_generated_at(status)
