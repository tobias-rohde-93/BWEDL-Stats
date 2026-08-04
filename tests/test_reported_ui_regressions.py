from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_reported_ui_regressions_in_node() -> None:
    subprocess.run(
        ["node", str(ROOT / "tests" / "test_reported_ui_regressions.js")],
        cwd=ROOT,
        check=True,
    )
