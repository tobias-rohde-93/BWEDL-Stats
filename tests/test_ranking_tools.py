from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_ranking_tools_contracts_in_node() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "test_ranking_tools.js")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
