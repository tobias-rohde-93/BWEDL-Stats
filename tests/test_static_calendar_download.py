from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_static_calendar_download_contract() -> None:
    result = subprocess.run(
        ["node", "tests/test_static_calendar_download.js"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "static team calendar download: ok" in result.stdout
