from pathlib import Path
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
