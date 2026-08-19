from __future__ import annotations

import html
import re
from typing import Any

from bs4 import BeautifulSoup, Comment, NavigableString, Tag


ALLOWED_TAGS = {"table", "thead", "tbody", "tfoot", "tr", "th", "td"}
SECTION_TAGS = {"thead", "tbody", "tfoot"}
CELL_TAGS = {"th", "td"}
SPAN_ATTRIBUTES = {"rowspan", "colspan"}
MAX_SPAN = 100
DROP_WITH_CONTENT = {
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "svg",
    "math",
    "form",
    "template",
    "noscript",
    "canvas",
    "audio",
    "video",
    "picture",
    "source",
    "link",
    "meta",
    "base",
    "img",
    "input",
    "button",
    "select",
    "textarea",
}


class TableSanitizationError(ValueError):
    """Raised when source markup cannot produce a usable inert table."""


def _bounded_span(value: Any) -> str | None:
    if not isinstance(value, str) or re.fullmatch(r"[1-9]\d*", value) is None:
        return None
    parsed = int(value)
    return value if parsed <= MAX_SPAN else None


def _normalized_cell_text(cell: Tag) -> str:
    for dropped in list(cell.find_all(DROP_WITH_CONTENT)):
        dropped.decompose()
    for nested_table in list(cell.find_all("table")):
        nested_table.decompose()
    return " ".join(cell.get_text(" ", strip=True).split())


def _render_cell(cell: Tag) -> str:
    attributes = []
    for name in ("rowspan", "colspan"):
        value = _bounded_span(cell.attrs.get(name))
        if value is not None:
            attributes.append(f' {name}="{value}"')
    text = html.escape(_normalized_cell_text(cell), quote=False)
    return f"<{cell.name}{''.join(attributes)}>{text}</{cell.name}>"


def _render_row(row: Tag) -> str | None:
    cells = [
        child
        for child in row.children
        if isinstance(child, Tag) and child.name in CELL_TAGS
    ]
    if not cells:
        return None
    return f"<tr>{''.join(_render_cell(cell) for cell in cells)}</tr>"


def _render_table(table: Tag) -> str | None:
    parts: list[str] = []
    row_count = 0
    for child in table.children:
        if not isinstance(child, Tag):
            continue
        if child.name == "tr":
            rendered_row = _render_row(child)
            if rendered_row is not None:
                parts.append(rendered_row)
                row_count += 1
            continue
        if child.name not in SECTION_TAGS:
            continue
        section_rows = []
        for row in child.children:
            if not isinstance(row, Tag) or row.name != "tr":
                continue
            rendered_row = _render_row(row)
            if rendered_row is not None:
                section_rows.append(rendered_row)
                row_count += 1
        if section_rows:
            parts.append(f"<{child.name}>{''.join(section_rows)}</{child.name}>")
    if row_count == 0:
        return None
    return f"<table>{''.join(parts)}</table>"


def sanitize_table_fragment(raw_html: str) -> str:
    if not isinstance(raw_html, str) or not raw_html.strip():
        raise TableSanitizationError("Table fragment is missing or unusable")
    parsed = BeautifulSoup(raw_html, "html.parser")
    root_tables = [
        table for table in parsed.find_all("table") if table.find_parent("table") is None
    ]
    rendered_tables = [
        rendered
        for table in root_tables
        if (rendered := _render_table(table)) is not None
    ]
    if not rendered_tables:
        raise TableSanitizationError("Table fragment is missing or unusable")
    return "".join(rendered_tables)


def _has_non_whitespace_text_outside_cells(parsed: BeautifulSoup) -> bool:
    for value in parsed.find_all(string=True):
        if isinstance(value, Comment) or not str(value).strip():
            continue
        parent = value.parent
        if not isinstance(parent, Tag) or (
            parent.name not in CELL_TAGS and parent.find_parent(CELL_TAGS) is None
        ):
            return True
    return False


def safe_table_fragment_issue(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return "table fragment is missing"

    parsed = BeautifulSoup(value, "html.parser")
    if parsed.find_all(string=lambda item: isinstance(item, Comment)):
        return "table fragment contains comments"
    if _has_non_whitespace_text_outside_cells(parsed):
        return "table fragment contains text outside cells"

    tags = parsed.find_all(True)
    if any(tag.name not in ALLOWED_TAGS for tag in tags):
        return "table fragment contains forbidden elements"
    tables = parsed.find_all("table")
    if not tables:
        return "table fragment has no table"
    if any(table.find_parent("table") is not None for table in tables):
        return "table fragment contains nested tables"

    for tag in tags:
        if tag.name in CELL_TAGS:
            if any(name not in SPAN_ATTRIBUTES for name in tag.attrs):
                return "table cell contains forbidden attributes"
            if any(_bounded_span(raw) is None for raw in tag.attrs.values()):
                return "table cell contains an invalid span"
        elif tag.attrs:
            return "table fragment contains forbidden attributes"

    for table in tables:
        rows = [
            row
            for row in table.find_all("tr")
            if row.find_parent("table") is table
        ]
        if not rows:
            return "table has no rows"
        if not any(
            any(
                isinstance(child, Tag) and child.name in CELL_TAGS
                for child in row.children
            )
            for row in rows
        ):
            return "table has no cells"
    return None
