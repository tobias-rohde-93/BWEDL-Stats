from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_club_experience_contracts_in_node() -> None:
    subprocess.run(
        ["node", str(ROOT / "tests" / "test_club_experience.js")],
        cwd=ROOT,
        check=True,
    )
