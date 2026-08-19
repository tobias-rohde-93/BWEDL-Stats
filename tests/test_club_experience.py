from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_club_experience_contracts_in_node() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "test_club_experience.js")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    assert "club experience production DOM contracts passed" in result.stdout
