import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_player_identity_contract_in_node() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "test_player_identity.js")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_identity_api_is_exported() -> None:
    source = (ROOT / "app_utils.js").read_text(encoding="utf-8")
    for name in (
        "PLAYER_PROFILE_VERSION",
        "PLAYER_PROFILE_STORAGE_KEY",
        "canonicalRankingCategory",
        "rankingRecordKey",
        "rankingPersonKey",
        "groupRankingPeople",
        "createPlayerProfile",
        "validatePlayerProfile",
        "resolvePlayerProfile",
        "migrateLegacyPlayerProfile",
    ):
        assert f"{name}," in source
