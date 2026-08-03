import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_profile_history_navigation_contract_in_node() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "test_profile_history.js")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
