# Ligapokal tables: horizontal scrolling on small screens

**Status:** Approved on 2026-08-20

## Problem

Normal league tables are rendered inside the existing `.table-scroll` region. Current and archived Ligapokal tables are instead appended directly to `#league-results-container`. Because the page content deliberately hides horizontal overflow, wide Ligapokal tables are clipped on small screens and cannot be moved horizontally.

## User-visible behavior

- On narrow screens, each Ligapokal table scrolls horizontally in its own region.
- The page, round headings, navigation, and surrounding content remain fixed to the viewport width.
- Current and archived Ligapokal views behave consistently with the other tables.
- Desktop presentation and table contents remain unchanged.

## Design

Reuse the existing `.table-scroll` contract instead of introducing page-level overflow or a second scrolling system. Every safe Ligapokal table is placed in a `table-container table-scroll` wrapper before it is inserted into the results view. If a season contains multiple round tables, each table receives its own wrapper so its heading does not move horizontally.

The same wrapper is used for both archive input forms already supported by the renderer: sanitized source-table HTML and reconstructed archive row data. No scraper, published data, routing, favorites, or non-Ligapokal table behavior changes.

## Verification

- Add a regression contract proving both Ligapokal rendering paths create the established scroll wrapper.
- At a smartphone viewport, verify the rendered table has `scrollWidth > clientWidth`, changing `scrollLeft` works, and the document itself does not overflow horizontally.
- Run the focused JavaScript/browser checks, syntax validation, patch validation, and the complete Python test suite.
