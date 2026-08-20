import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_published_table_data_never_reaches_inner_html() -> None:
    source = (ROOT / "bundle_v31.js").read_text(encoding="utf-8")

    forbidden_patterns = (
        r"\.innerHTML\s*=\s*data\.table",
        r"\.innerHTML\s*=\s*rankingData\.rankings",
        r"temp\.innerHTML\s*=\s*tableHtml",
        r"temp\.innerHTML\s*=\s*lData\.table",
        r"temp\.innerHTML\s*=\s*leagueData\.leagues\[[^\]]+\]\.table",
    )
    for pattern in forbidden_patterns:
        assert re.search(pattern, source) is None, pattern

    assert "function createSafeTablesFromHtml" in source
    assert "function safeTableRowsFromHtml" in source
    assert "function replaceWithSafeTables" in source
    assert "function replaceWithSafeCupTables" in source
    assert "function createScrollableTableRegion" in source
    assert "fragment.appendChild(createScrollableTableRegion(table))" in source
    assert "resultsContainer.appendChild(createScrollableTableRegion(tableElement))" in source
    assert "function renderRankingLegacy" not in source


def test_cup_round_labels_are_rebuilt_from_structured_text() -> None:
    source = (ROOT / "bundle_v31.js").read_text(encoding="utf-8")

    assert "replaceWithSafeCupTables(resultsContainer, data.table, data.match_days)" in source
    assert "heading.textContent = roundNames[index]" in source
    assert "container.querySelectorAll('table').forEach" in source


def test_safe_published_table_contract_in_node() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "test_safe_published_tables.js")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
