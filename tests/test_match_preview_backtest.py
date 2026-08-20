from pathlib import Path
import json
import os
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
MARKER = "archive_data.js has no round-derived historical evidence"


def test_match_preview_backtest_in_node() -> None:
    completed = subprocess.run(
        ["node", str(ROOT / "tests" / "test_match_preview_backtest.js")],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    if completed.stdout.strip() == MARKER:
        pytest.skip(MARKER)
    assert "historical match preview backtest:" in completed.stdout
    metrics = json.loads(completed.stdout.split("historical match preview backtest: ", 1)[1])
    assert {
        "samples", "classChangers", "hybridMae", "previousMae", "unadjustedMae",
        "enrichedSegments", "eligibleTargets", "samplesByTargetSeason",
        "samplesByTargetClass", "ambiguityExclusions",
        "multiClassSeasons", "transferSeasons", "administrativeMarkers",
    } == set(metrics)
    assert metrics["samples"] > 0
    assert metrics["classChangers"] > 0
    assert sum(metrics["samplesByTargetSeason"].values()) == metrics["samples"]
    assert sum(metrics["samplesByTargetClass"].values()) == metrics["samples"]
    assert list(metrics["samplesByTargetSeason"]) == sorted(metrics["samplesByTargetSeason"])
    assert list(metrics["samplesByTargetClass"]) == sorted(metrics["samplesByTargetClass"])
    assert set(metrics["ambiguityExclusions"]) == {"target", "window", "sample"}


def run_backtest_with_archive(tmp_path: Path, archive: object) -> subprocess.CompletedProcess[str]:
    archive_path = tmp_path / "archive_data.js"
    archive_path.write_text(
        "window.ARCHIVE_DATA = " + json.dumps(archive) + ";\n",
        encoding="utf-8",
    )
    environment = os.environ.copy()
    environment["BWEDL_BACKTEST_ARCHIVE"] = str(archive_path)
    return subprocess.run(
        ["node", str(ROOT / "tests" / "test_match_preview_backtest.js")],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        env=environment,
    )


@pytest.mark.parametrize(
    "archive",
    [
        {"1": [{"rounds": {"R1": 1}}]},
        {"1": [{
            "season": "2024/2025", "league": "A-Klasse", "v_nr": "001",
            "points": 1, "rounds": {"R1": 1}, "appearances": 2,
            "points_per_appearance": 1,
        }]},
    ],
    ids=["partial", "inconsistent"],
)
def test_enriched_but_invalid_archive_is_a_hard_failure(
    tmp_path: Path, archive: object,
) -> None:
    completed = run_backtest_with_archive(tmp_path, archive)
    combined = completed.stdout + completed.stderr
    assert completed.returncode != 0
    assert MARKER not in combined


def test_enriched_archive_with_zero_appearances_is_not_skipped(tmp_path: Path) -> None:
    completed = run_backtest_with_archive(tmp_path, {
        "1": [{
            "season": "2024/2025", "league": "A-Klasse", "v_nr": "001",
            "points": 0, "rounds": {}, "appearances": 0,
            "points_per_appearance": 0,
        }],
    })
    combined = completed.stdout + completed.stderr
    assert completed.returncode != 0
    assert MARKER not in combined


@pytest.mark.parametrize(
    "record",
    [
        {
            "season": "2024/2025", "league": "A-Klasse", "rank": 1,
            "name": "Empty Segments", "points": 0,
            "primary_segment_id": "sha256:" + "0" * 64, "segments": [],
        },
        {
            "season": "2024/2025", "league": "A-Klasse", "rank": 1,
            "name": "Malformed Segment", "points": 0,
            "primary_segment_id": "sha256:" + "1" * 64, "segments": [{}],
        },
        {
            "season": "2024/2025", "league": "A-Klasse", "rank": 1,
            "name": "Missing Segments", "points": 0,
            "primary_segment_id": "sha256:" + "2" * 64,
        },
        {
            "season": "2024/2025", "league": "A-Klasse", "rank": 1,
            "name": "Flat Poison", "points": 4, "v_nr": "001",
            "rounds": {"R1": 4}, "appearances": 1,
            "points_per_appearance": 4,
            "primary_segment_id": "sha256:" + "3" * 64, "segments": [],
        },
        {
            "season": "2024/2025", "league": "A-Klasse", "rank": 1,
            "name": "Non-array Segments", "points": 0,
            "primary_segment_id": "sha256:" + "4" * 64, "segments": {},
        },
        {
            "season": "2024/2025", "league": "A-Klasse", "rank": 1,
            "name": "Totals Only", "points": 4, "v_nr": "001",
            "primary_segment_id": "sha256:" + "5" * 64,
            "segments": [{
                "segment_id": "sha256:" + "5" * 64,
                "league": "A-Klasse", "rank": 1, "name": "Totals Only",
                "v_nr": "001", "points": 4,
            }],
        },
        {
            "season": "2024/2025", "league": "A-Klasse", "rank": 1,
            "name": "Poisoned Projection", "points": 4, "v_nr": "001",
            "rounds": {"R1": 4}, "appearances": 2,
            "points_per_appearance": 4,
            "primary_segment_id": "sha256:" + "6" * 64,
            "segments": [{
                "segment_id": "sha256:" + "6" * 64,
                "league": "A-Klasse", "rank": 1,
                "name": "Poisoned Projection", "v_nr": "001", "points": 4,
                "rounds": {"R1": 4}, "appearances": 1,
                "points_per_appearance": 4,
            }],
        },
    ],
    ids=[
        "empty", "malformed", "missing", "flat-poison", "non-array",
        "valid-totals-only", "poisoned-flat-projection",
    ],
)
def test_v2_schema_signals_are_never_hidden_by_no_evidence_skip(
    tmp_path: Path, record: dict[str, object],
) -> None:
    completed = run_backtest_with_archive(tmp_path, {"1": [record]})
    combined = completed.stdout + completed.stderr
    assert completed.returncode != 0
    assert MARKER not in combined
