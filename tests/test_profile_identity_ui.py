import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_profile_identity_ui_contract_in_node() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "test_profile_identity_ui.js")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_identity_critical_ui_paths_do_not_find_by_saved_name() -> None:
    source = (ROOT / "bundle_v31.js").read_text(encoding="utf-8")
    forbidden = (
        r"\.find\([^\n]*\.name\s*===\s*myPlayerName",
        r"\.find\([^\n]*myPlayerName\s*===\s*[^\n]*\.name",
        r"localStorage\.setItem\(['\"]myPlayerName['\"]",
        r"localStorage\.setItem\(['\"]myTeamName['\"]",
        r"matchRankingPlayer\(viewModels,\s*myPlayerName\)",
    )
    for pattern in forbidden:
        assert re.search(pattern, source) is None, pattern

    for fragment in (
        "function getMyPrimaryPlayer()",
        "function getMyPlayerRecords()",
        "function isMyPlayerRecord(player)",
        "getMyPrimaryPlayer()",
        "isMyPlayerRecord(p)",
        "PLAYER_PROFILE_STORAGE_KEY",
    ):
        assert fragment in source


def test_profile_copy_documents_exact_local_selection() -> None:
    wiki = (ROOT / "WIKI.md").read_text(encoding="utf-8")
    assert "exakten Spielervorschlag" in wiki
    assert "primäre Klasse" in wiki
    assert "lokal" in wiki.lower()
