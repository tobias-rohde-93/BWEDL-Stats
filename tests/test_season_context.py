from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_season_context_and_onboarding_contract_in_node() -> None:
    subprocess.run(
        ["node", str(ROOT / "tests" / "test_season_context.js")],
        cwd=ROOT,
        check=True,
    )
