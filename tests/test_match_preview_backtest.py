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
