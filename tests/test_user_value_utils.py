import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_user_value_utilities_in_node() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "test_user_value_utils.js")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "user value utilities: ok" in result.stdout
