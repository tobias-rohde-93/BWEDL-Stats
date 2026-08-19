from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_calendar_subscription_ui_contract() -> None:
    result = subprocess.run(
        ["node", "tests/test_calendar_subscription.js"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "team calendar subscription UI: ok" in result.stdout
