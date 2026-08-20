import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_confirmed_simple_text_sinks_do_not_use_inner_html() -> None:
    source = (ROOT / "bundle_v31.js").read_text(encoding="utf-8")
    forbidden_patterns = (
        r"link\.innerHTML\s*=\s*myPlayerName",
        r"profileLink\.innerHTML\s*=\s*myPlayerName",
        r"el\.innerHTML\s*=\s*`[^`]*\$\{fav\.name\}",
        r"button\.innerHTML\s*=\s*`[^`]*\$\{m\.(?:type|label)",
        r"div\.innerHTML\s*=\s*`[^`]*\$\{m\.label\}",
        r"selEl\.innerHTML\s*=\s*`[^`]*\$\{player\.label\}",
        r"div\.innerHTML\s*=\s*`[^`]*\$\{p\.name\}",
        r"statusEl\.innerHTML\s*=",
    )
    for pattern in forbidden_patterns:
        assert re.search(pattern, source) is None, pattern

    assert "function replaceWithIconLabel" in source
    assert "function replaceWithSearchResultLabel" in source


def test_complex_templates_escape_external_text_values() -> None:
    source = (ROOT / "bundle_v31.js").read_text(encoding="utf-8")
    required_fragments = (
        "${escapeHtmlText(p.name)}",
        "${escapeHtmlText(clubName)}",
        "${escapeHtmlText(d1.name)}",
        "${escapeHtmlText(d2.name)}",
        "${escapeHtmlText(d1.searchItem.context || '-')}" ,
        "${escapeHtmlText(d2.searchItem.context || '-')}" ,
        "${escapeHtmlText(myStats.rank)}",
        "${escapeHtmlText(p.bestSeasonYearRank)}",
        "${escapeHtmlText(p.maxPointsYear)}",
        "${escapeHtmlText(s.rank || '-')}",
        "${escapeHtmlText(s.points || 0)}",
    )
    for fragment in required_fragments:
        assert fragment in source, fragment

    assert "escapeHtmlText," in (ROOT / "app_utils.js").read_text(encoding="utf-8")


def test_match_preview_external_values_use_safe_dom_nodes() -> None:
    source = (ROOT / "bundle_v31.js").read_text(encoding="utf-8")
    start = source.index("function renderMatchPreview(")
    end = source.index("window.triggerUpdate", start)
    renderer = source[start:end]

    assert "Security-audit compatibility markers" not in source
    assert "element.textContent = text" in renderer
    assert "document.createElement('option')" in renderer
    assert "document.createElement('article')" in renderer
    assert "document.createElement('input')" in renderer
    assert "innerHTML" not in renderer
    assert "/api/" not in renderer


def test_dynamic_text_contract_in_node() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "test_dynamic_text_security.js")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
