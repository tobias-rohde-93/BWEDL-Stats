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
        "${escapeHtmlText(nameA)}",
        "${escapeHtmlText(nameB)}",
        "${escapeHtmlText(m.home)}",
        "${escapeHtmlText(m.away)}",
        "${escapeHtmlText(shortName)}",
    )
    for fragment in required_fragments:
        assert fragment in source, fragment

    assert "escapeHtmlText," in (ROOT / "app_utils.js").read_text(encoding="utf-8")


def test_dynamic_text_contract_in_node() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "test_dynamic_text_security.js")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
