from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_match_preview_model_in_node() -> None:
    subprocess.run(
        ["node", str(ROOT / "tests" / "test_match_preview_model.js")],
        cwd=ROOT,
        check=True,
    )
