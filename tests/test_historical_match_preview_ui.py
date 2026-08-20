from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_historical_match_preview_ui_contract_in_node() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "test_historical_match_preview_ui.js")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
