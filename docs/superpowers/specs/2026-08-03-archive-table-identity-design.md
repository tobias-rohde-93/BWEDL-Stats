# BWEDL Stats: Robust Archive Table Identity Design

## Status

Approved in principle on 2026-08-03; written review pending.

## Objective

Restore reliable scheduled data updates after the BWEDL archive changed how table titles are rendered. The fix must recognize the new markup without weakening the rule that previously published archive tables and rows may not silently disappear.

## Incident Evidence

GitHub Actions run `30801852333` completed offline tests and all live scrapers, then blocked publication during archive validation. The candidate contained 104 table records versus 67 previous records, but the previous table `2025/26 MM_C-Klasse 2025-26` was no longer identifiable.

The current BWEDL page renders competition titles inside the first table row. The scraper only searches preceding sibling elements for a league title. In a live reproduction, 19 of 22 candidate tables for 2025/26 were therefore labeled `Unbekannt`.

## Considered Approaches

### Weaken the archive validator

Accept any candidate whose total record count is at least as large as the previous count. This would make the current run pass but could publish data with a missing historical league hidden by unrelated new tables. Rejected because it defeats the transactional safety design.

### Fix title extraction only

Read titles from the table body when no usable preceding heading exists. This fixes `Unbekannt`, but a harmless wording change such as `MM_C-Klasse 2025-26` to `Bwedl e.V. 2025/2026 C-Klasse Meisterschaft` would still look like a deleted table. Insufficient on its own.

### Extract and compare canonical table identities

Recommended. Extract the embedded title, normalize legacy and current wording into a stable identity, and compare archive completeness by that identity and row counts. Preserve the existing block for missing identities, duplicate records, missing seasons, malformed data, and decreased table rows.

## Selected Design

### Table-title extraction

Move the browser-side table parsing expression into a named JavaScript constant that can be executed by Playwright and tested directly with a small HTML fixture.

For each table:

- inspect nearby preceding headings as today;
- inspect single-cell title rows within the table;
- recognize league and competition terms such as `Klasse`, `Liga`, `Pokal`, and `Meisterschaft`;
- prefer the nearest specific embedded table title over a generic page heading;
- keep title rows as section context only, not standings data;
- retain `Unbekannt` only when no plausible title exists.

The JavaScript score pattern will use a Python-safe escaped backslash so Python 3.13 emits no `invalid escape sequence` warning.

### Canonical archive identity

Add a private normalization helper in `pipeline/validation.py`. It will derive a stable key from canonical season and league title by:

- Unicode-aware lowercasing and whitespace normalization;
- converting underscores and repeated punctuation to spaces;
- removing duplicated season text and publisher prefixes;
- treating `MM` and `Mannschaftsmeisterschaft` as equivalent;
- retaining the competition class, group number, cup round, or other distinguishing words.

The known legacy title `MM_C-Klasse 2025-26` and current title `Bwedl e.V. 2025/2026 C-Klasse Meisterschaft` must resolve to the same identity. Different C-Klasse groups must remain distinct.

### Conservative completeness validation

Archive table validation will continue to reject malformed or duplicate records. For completeness, it will group tables by canonical identity and require:

- every previous identity exists in the candidate;
- the candidate has at least as many tables for each identity;
- each matched candidate table has at least as many structured rows as its previous counterpart;
- all previously published seasons remain present.

Cell corrections and presentation-title changes are allowed when identity and row-count safeguards pass. Unrelated new tables cannot compensate for a missing previous identity.

### Scope

Only these production areas may change:

- `archive_tables_scraper.py` for extraction and the escape warning;
- `pipeline/validation.py` for canonical archive-table comparison.

Tests and one sanitized archive-table fixture will be added. Frontend behavior, other scrapers, publication mechanics, ranking readiness, and notification policy remain unchanged.

## Testing

Test-driven implementation will cover:

- an embedded BWEDL table title is extracted instead of `Unbekannt`;
- title rows are excluded from standings rows;
- legacy and current C-Klasse championship titles share one identity;
- C-Klasse groups remain distinct;
- a renamed table with equal or greater row count publishes;
- a renamed table with fewer rows remains blocked;
- a genuinely missing identity remains blocked;
- the scraper source compiles without the Python invalid-escape warning.

After focused tests pass, run the complete offline suite. Then run the archive-table scraper into an isolated staging directory and validate its candidate against the published archive. No public data file is replaced during this live verification.

## Acceptance Criteria

- The current BWEDL archive produces meaningful names for the affected 2025/26 tables.
- The live archive candidate no longer fails solely because of the legacy/current C-Klasse title change.
- Missing tables and row-count regressions are still blocked.
- All offline tests pass without new warnings.
- The scheduled workflow can publish only after all domain validators return `publish` or `retain`.

## Out of Scope

- rewriting the archive scraper;
- weakening archive completeness to a global total-count check;
- manually editing generated public archive data;
- changing the four-category ranking activation rule;
- redesigning the frontend.
