from __future__ import annotations

import re

import pytest
from bs4 import BeautifulSoup, Comment

from pipeline.html_sanitizer import (
    TableSanitizationError,
    safe_table_fragment_issue,
    sanitize_table_fragment,
)


ALLOWED_TAGS = {"table", "thead", "tbody", "tfoot", "tr", "th", "td"}


def parsed_tags(value: str):
    return BeautifulSoup(value, "html.parser").find_all(True)


def test_active_markup_attributes_and_comments_are_removed() -> None:
    raw = """
        <!-- source comment -->
        <div class="wrapper">
          <table class="source" onclick="run()" data-source="x">
            <thead><tr><th id="name">Name</th></tr></thead>
            <tbody><tr onmouseover="run()"><td style="color:red">
              <img src=x onerror="run()">Team
              <script>alert('script')</script>
              <style>body{display:none}</style>
              <iframe srcdoc="<script>run()</script>"></iframe>
              <object data="javascript:run()"></object>
              <embed src="x">
              <svg onload="run()"><text>svg payload</text></svg>
              <math><mtext>math payload</mtext></math>
              <form action="/steal"><input name="secret"></form>
            </td></tr></tbody>
          </table>
        </div>
    """

    sanitized = sanitize_table_fragment(raw)
    soup = BeautifulSoup(sanitized, "html.parser")

    assert {tag.name for tag in soup.find_all(True)} <= ALLOWED_TAGS
    assert all(not tag.attrs for tag in soup.find_all(True))
    assert soup.get_text(" ", strip=True) == "Name Team"
    assert not soup.find_all(string=lambda value: isinstance(value, Comment))
    for forbidden in ("script", "alert", "onerror", "javascript:", "svg payload", "math payload"):
        assert forbidden not in sanitized.casefold()


def test_visible_inline_text_is_retained_without_inline_elements() -> None:
    sanitized = sanitize_table_fragment(
        "<table><tr><td> DC <b>Ölbronn</b><br><a href='/club'> Team </a> </td></tr></table>"
    )

    assert sanitized == "<table><tr><td>DC Ölbronn Team</td></tr></table>"


def test_multiple_tables_keep_order_and_drop_external_round_headings() -> None:
    sanitized = sanitize_table_fragment(
        "<h3>Runde 1</h3><table><tr><td>Eins</td></tr></table>"
        "<br><h3>Finale</h3><table><tr><td>Zwei</td></tr></table>"
    )
    soup = BeautifulSoup(sanitized, "html.parser")

    assert [table.get_text(" ", strip=True) for table in soup.find_all("table")] == [
        "Eins",
        "Zwei",
    ]
    assert "Runde" not in sanitized
    assert "Finale" not in sanitized


def test_allowed_sections_and_bounded_spans_are_preserved() -> None:
    sanitized = sanitize_table_fragment(
        "<table><thead><tr><th colspan='2'>Kopf</th></tr></thead>"
        "<tbody><tr><td rowspan='3'>A</td><td>B</td></tr></tbody>"
        "<tfoot><tr><td colspan='2'>Ende</td></tr></tfoot></table>"
    )
    soup = BeautifulSoup(sanitized, "html.parser")

    assert [tag.name for tag in soup.table.find_all(recursive=False)] == [
        "thead",
        "tbody",
        "tfoot",
    ]
    assert soup.find("th")["colspan"] == "2"
    assert soup.find("td", string="A")["rowspan"] == "3"
    assert soup.find("td", string="Ende")["colspan"] == "2"
    assert safe_table_fragment_issue(sanitized) is None


@pytest.mark.parametrize("value", ["0", "-1", "101", "999999", "1.5", "many", ""])
def test_invalid_span_values_are_discarded(value: str) -> None:
    sanitized = sanitize_table_fragment(
        f"<table><tr><td rowspan='{value}' colspan='{value}'>A</td></tr></table>"
    )

    assert BeautifulSoup(sanitized, "html.parser").td.attrs == {}


def test_whitespace_variants_have_deterministic_output() -> None:
    compact = sanitize_table_fragment(
        "<table><tr><td>Team   Eins</td><td>  10 </td></tr></table>"
    )
    expanded = sanitize_table_fragment(
        "\n<table>\n<tr>\n<td> Team\nEins </td>\n<td>10</td>\n</tr>\n</table>\n"
    )

    assert compact == expanded == "<table><tr><td>Team Eins</td><td>10</td></tr></table>"


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "plain text",
        "<div><span>no table</span></div>",
        "<table></table>",
        "<table><tbody><tr></tr></tbody></table>",
        "<table><script>only active content</script></table>",
    ],
)
def test_unusable_fragments_raise_without_echoing_source(raw: str) -> None:
    with pytest.raises(TableSanitizationError) as caught:
        sanitize_table_fragment(raw)

    if raw:
        assert raw not in str(caught.value)


@pytest.mark.parametrize("raw", [None, 17, {}, []])
def test_non_string_fragments_raise(raw: object) -> None:
    with pytest.raises(TableSanitizationError):
        sanitize_table_fragment(raw)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "unsafe",
    [
        "<table class='x'><tr><td>A</td></tr></table>",
        "<table><tr onclick='x()'><td>A</td></tr></table>",
        "<table><tr><td><img src=x></td></tr></table>",
        "<table><tr><td colspan='101'>A</td></tr></table>",
        "<h3>Title</h3><table><tr><td>A</td></tr></table>",
    ],
)
def test_safety_inspection_rejects_noncanonical_fragments(unsafe: str) -> None:
    assert safe_table_fragment_issue(unsafe)


def test_safety_inspection_rejects_malformed_types_and_structure() -> None:
    assert safe_table_fragment_issue(None)
    assert safe_table_fragment_issue(17)
    assert safe_table_fragment_issue("<table></table>")
    assert safe_table_fragment_issue("<table><tr></tr></table>")


def test_sanitized_output_contains_no_unescaped_cell_markup() -> None:
    sanitized = sanitize_table_fragment(
        "<table><tr><td>&lt;img src=x onerror=run()&gt; &amp; Team</td></tr></table>"
    )

    assert "&lt;img src=x onerror=run()&gt; &amp; Team" in sanitized
    assert re.fullmatch(r"<table><tr><td>.*</td></tr></table>", sanitized)
    assert BeautifulSoup(sanitized, "html.parser").find("img") is None
