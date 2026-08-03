# Robust Archive Table Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the BWEDL archive-table scraper recognize embedded competition titles and let validation accept harmless title/content corrections while continuing to block missing tables and row-count regressions.

**Architecture:** Keep Playwright as the DOM boundary, but extract its table parser into one named JavaScript expression that can be exercised offline with a minimal DOM adapter. Give archive tables a canonical Python identity based on season and normalized competition title, then compare per-identity table multiplicity and row counts instead of exact whole-record fingerprints.

**Tech Stack:** Python 3.13, Playwright for Python, pytest, Node.js assertions, vanilla JavaScript

---

## Execution preconditions

- Use `docs/superpowers/specs/2026-08-03-archive-table-identity-design.md` as the approved source of truth.
- Work on the current `main` checkout, which contains only the user-owned unstaged modification `.agent/rules/git-workflow.md` in addition to committed project state.
- Never stage, edit, restore, or commit `.agent/rules/git-workflow.md`.
- Do not edit generated public archive files during implementation or verification.

## Planned file map

### New test files

- `tests/fixtures/archive_table_embedded_title.html` — sanitized current-layout table with the title inside its first row.
- `tests/test_archive_table_extractor.js` — executes the production JavaScript expression against a minimal DOM adapter.

### Existing files to modify

- `archive_tables_scraper.py` — expose one raw JavaScript extractor constant, detect embedded titles, and remove the Python invalid-escape warning.
- `tests/test_scraper_outputs.py` — invoke the Node regression contract and assert clean Python compilation.
- `pipeline/validation.py` — canonicalize archive table identities and compare table/row counts per identity.
- `tests/test_validation.py` — cover renamed tables, distinct groups, row loss, and genuine identity loss.

## Task 1: Reproduce embedded-title extraction failure

**Files:**
- Create: `tests/fixtures/archive_table_embedded_title.html`
- Create: `tests/test_archive_table_extractor.js`
- Modify: `tests/test_scraper_outputs.py`
- Modify: `archive_tables_scraper.py:199-288`

- [ ] **Step 1: Add the sanitized current-layout fixture**

Create `tests/fixtures/archive_table_embedded_title.html` with a title row, standings header, and two sanitized teams:

```html
<main>
  <table>
    <tr><th colspan="10">Bwedl e.V. 2025/2026 C-Klasse Meisterschaft</th></tr>
    <tr><th>Pl.</th><th>Tabelle</th><th>Sp.</th><th>G</th><th>U</th><th>V</th><th>Legs</th><th>Diff.</th><th>Punkte</th></tr>
    <tr><td>1</td><td>DC Beispiel</td><td>5</td><td>4</td><td>0</td><td>1</td><td>40:20</td><td>20</td><td>8</td></tr>
    <tr><td>2</td><td>SV Muster</td><td>5</td><td>1</td><td>0</td><td>4</td><td>20:40</td><td>-20</td><td>2</td></tr>
  </table>
</main>
```

- [ ] **Step 2: Add an offline Node contract for the production extractor**

Create `tests/test_archive_table_extractor.js`. It reads JSON from stdin containing `source` and `html`, converts the small fixture into objects implementing only `document.querySelectorAll`, `table.previousElementSibling`, `table.querySelectorAll`, `tr.querySelectorAll`, and `innerText`, evaluates the production expression, and asserts:

```javascript
assert.equal(result.length, 1);
assert.equal(result[0].league, 'Bwedl e.V. 2025/2026 C-Klasse Meisterschaft');
assert.equal(result[0].rows.length, 3);
assert.equal(result[0].rows[0][0], 'Runde/Info');
assert.equal(
    result[0].rows.flat().includes('Bwedl e.V. 2025/2026 C-Klasse Meisterschaft'),
    false,
);
```

The adapter must fail on unsupported selector calls so the contract cannot pass silently against an unused fixture.

- [ ] **Step 3: Add the Python wrapper test**

Append to `tests/test_scraper_outputs.py`:

```python
def test_archive_table_extractor_recognizes_embedded_title() -> None:
    payload = json.dumps(
        {
            "source": archive_tables_scraper.ARCHIVE_TABLE_EXTRACTOR_JS,
            "html": (
                REPOSITORY_ROOT
                / "tests"
                / "fixtures"
                / "archive_table_embedded_title.html"
            ).read_text(encoding="utf-8"),
        }
    )
    result = subprocess.run(
        ["node", str(REPOSITORY_ROOT / "tests" / "test_archive_table_extractor.js")],
        cwd=REPOSITORY_ROOT,
        input=payload,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
```

- [ ] **Step 4: Run the test and verify RED**

Run:

```powershell
python -m pytest tests/test_scraper_outputs.py::test_archive_table_extractor_recognizes_embedded_title -q
```

Expected: FAIL because `archive_tables_scraper` does not expose `ARCHIVE_TABLE_EXTRACTOR_JS` and the current inline extractor leaves the title as `Unbekannt`.

- [ ] **Step 5: Extract and minimally fix the production JavaScript**

In `archive_tables_scraper.py`, define `ARCHIVE_TABLE_EXTRACTOR_JS` before `scrape_archive_tables` as a raw triple-quoted string containing the existing expression. Change only these behaviors:

```javascript
const embeddedTitle = cells.length === 1
    ? cells.find(cell => /(klasse|liga|pokal|meisterschaft)/i.test(cell))
    : null;

if (embeddedTitle) {
    leagueName = embeddedTitle;
    return;
}
```

Use the embedded-title branch before generic section-header handling. When searching preceding siblings, assign only while `leagueName === "Unbekannt"` so a nearby specific heading is not overwritten by a farther one. Keep the score expression as `/\d+:\d+/` inside the raw Python string.

Replace the inline `page.evaluate('''...''')` call with:

```python
extracted_tables = await page.evaluate(ARCHIVE_TABLE_EXTRACTOR_JS)
```

- [ ] **Step 6: Run the focused extractor tests and verify GREEN**

Run:

```powershell
python -m pytest tests/test_scraper_outputs.py::test_archive_table_extractor_recognizes_embedded_title -q
python -W error::SyntaxWarning -m py_compile archive_tables_scraper.py
```

Expected: both commands exit 0 with no warnings.

- [ ] **Step 7: Commit the extractor fix**

Stage only:

```powershell
git add archive_tables_scraper.py tests/fixtures/archive_table_embedded_title.html tests/test_archive_table_extractor.js tests/test_scraper_outputs.py
git commit -m "fix: extract embedded archive table titles"
```

## Task 2: Compare stable archive table identities

**Files:**
- Modify: `tests/test_validation.py:871-930`
- Modify: `pipeline/validation.py:684-795`

- [ ] **Step 1: Add failing rename and group-identity tests**

Append these behavioral cases to `tests/test_validation.py`:

```python
def test_archive_payload_accepts_current_title_for_legacy_championship() -> None:
    previous_data = {"p1": [archive_record("25/26")]}
    candidate_data = deepcopy(previous_data)
    previous_tables = [
        {"season": "2025/2026", "league": "MM_C-Klasse 2025-26", "rows": [{"rank": 1}, {"rank": 2}]}
    ]
    candidate_tables = [
        {
            "season": "2025/2026",
            "league": "Bwedl e.V. 2025/2026 C-Klasse Meisterschaft",
            "rows": [{"rank": 1}, {"rank": 2}],
        }
    ]

    result = validation.validate_archive_payloads(
        candidate_data, previous_data, candidate_tables, previous_tables
    )

    assert result.decision is Decision.PUBLISH


def test_archive_payload_keeps_c_class_groups_distinct() -> None:
    data = {"p1": [archive_record("25/26")]}
    previous_tables = [archive_table("25/26", league="C-Klasse Gruppe 1")]
    candidate_tables = [archive_table("25/26", league="C-Klasse Gruppe 2")]

    result = validation.validate_archive_payloads(
        data, data, candidate_tables, previous_tables
    )

    assert result.decision is Decision.BLOCKED
    assert "table" in " ".join(result.reasons).lower()


def test_archive_payload_blocks_row_loss_after_title_normalization() -> None:
    data = {"p1": [archive_record("25/26")]}
    previous_tables = [
        {
            "season": "2025/2026",
            "league": "MM_C-Klasse 2025-26",
            "rows": [{"rank": 1}, {"rank": 2}],
        }
    ]
    candidate_tables = [
        {
            "season": "2025/2026",
            "league": "Bwedl e.V. 2025/2026 C-Klasse Meisterschaft",
            "rows": [{"rank": 1}],
        }
    ]

    result = validation.validate_archive_payloads(
        data, data, candidate_tables, previous_tables
    )

    assert result.decision is Decision.BLOCKED
    assert "row count loss" in " ".join(result.reasons).lower()
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```powershell
python -m pytest tests/test_validation.py -k "current_title or c_class_groups or row_loss_after" -q
```

Expected: the rename case fails because exact whole-record fingerprints differ; the row-loss reason is not yet available.

- [ ] **Step 3: Add canonical identity normalization**

In `pipeline/validation.py`, import `re` and `unicodedata` if not already present, then add:

```python
def _archive_table_identity(season: Any, league: Any) -> tuple[str, str] | None:
    canonical_season = _parse_archive_season(season)
    if canonical_season is None or not isinstance(league, str) or not league.strip():
        return None
    title = unicodedata.normalize("NFKC", league).casefold()
    title = re.sub(r"\bbwedl\s*e\.?\s*v\.?", " ", title)
    title = re.sub(r"\b(?:19|20)?\d{2}\s*[/_.-]\s*(?:19|20)?\d{2}\b", " ", title)
    title = re.sub(r"\bam\s+\d{1,2}\.\d{1,2}\.\d{4}\b", " ", title)
    title = re.sub(r"[_\W]+", " ", title, flags=re.UNICODE)
    title = re.sub(
        r"\b(?:mm|mannschafts?meisterschaft(?:en)?|meisterschaft(?:en)?)\b",
        " ",
        title,
    )
    title = re.sub(r"\s+", " ", title).strip()
    return canonical_season, title
```

The normalization intentionally preserves `gruppe 1`, `gruppe 2`, league classes, and cup-round wording.

- [ ] **Step 4: Replace exact record-loss comparison with per-identity safeguards**

Change `inspect_tables` to return full-record fingerprints plus a mapping from canonical identity to row counts and one display label:

```python
table_counts: dict[tuple[str, str], list[int]] = {}
table_labels: dict[tuple[str, str], str] = {}
identity = _archive_table_identity(season, league)
if identity is not None and isinstance(rows, list):
    table_counts.setdefault(identity, []).append(len(rows))
    table_labels.setdefault(identity, f"{identity[0]} {league.strip()}")
```

Keep strict-JSON, invalid season, blank league, non-list rows, and duplicate full-record checks. Replace `previous_table_records - candidate_table_records` with:

```python
for identity, previous_row_counts in previous_counts.items():
    candidate_row_counts = candidate_counts.get(identity, [])
    label = previous_labels[identity]
    if len(candidate_row_counts) < len(previous_row_counts):
        reasons.append(f"Candidate archive table count loss for {label}")
        continue
    candidate_sorted = sorted(candidate_row_counts, reverse=True)
    previous_sorted = sorted(previous_row_counts, reverse=True)
    if any(candidate < previous for candidate, previous in zip(candidate_sorted, previous_sorted)):
        reasons.append(f"Candidate archive table row count loss for {label}")
```

Continue reporting `candidate_tables` and `previous_tables` from full-record fingerprint counts so operational metrics remain comparable with earlier reports.

- [ ] **Step 5: Run validator tests and verify GREEN**

Run:

```powershell
python -m pytest tests/test_validation.py -q
```

Expected: all validation tests pass, including existing missing-table and duplicate-record cases.

- [ ] **Step 6: Commit the validator fix**

Stage only:

```powershell
git add pipeline/validation.py tests/test_validation.py
git commit -m "fix: compare canonical archive table identities"
```

## Task 3: Verify the live incident without publishing data

**Files:**
- No tracked files should change.

- [ ] **Step 1: Run focused offline regression checks**

Run:

```powershell
python -m pytest tests/test_scraper_outputs.py tests/test_validation.py tests/test_update_data.py -q -p no:cacheprovider
```

Expected: all selected tests pass.

- [ ] **Step 2: Scrape only archive tables into an isolated directory**

Create a unique directory under `.staging/` and run:

```powershell
python archive_tables_scraper.py --output-dir .staging/archive-identity-live --artifacts-dir artifacts/archive-identity-live
```

Expected: exit 0, no invalid-escape warning, and `archive_tables.js` exists only in the staging directory.

- [ ] **Step 3: Inspect and validate the candidate**

Use `pipeline.validation.parse_javascript_assignment` to confirm:

- no 2025/26 table uses `Unbekannt` when an embedded competition title is available;
- the current C-Klasse championship has a meaningful league name;
- `validate_archive_payloads` returns `Decision.PUBLISH` against the published `archive_data.js` and `archive_tables.js`, using the unchanged player archive as both candidate and previous inputs for this isolated table check.

If validation remains blocked, stop and inspect the reported identity or row-count loss. Do not weaken the validator or publish data.

- [ ] **Step 4: Remove only the verified staging and artifact directories**

Resolve both absolute paths, verify they remain under the repository's `.staging` and `artifacts` directories respectively, then remove only those exact generated directories. Confirm `git status --short` contains no new files.

## Task 4: Complete regression verification and publish the fix

**Files:**
- No additional production files expected.

- [ ] **Step 1: Run the complete test suite**

Run outside the restricted filesystem sandbox so pytest can create temporary fixtures:

```powershell
python -m pytest tests -q -p no:cacheprovider
```

Expected: all tests pass; only intentionally skipped environment tests may be reported.

- [ ] **Step 2: Run static and Git checks**

Run:

```powershell
python -W error::SyntaxWarning -m py_compile archive_tables_scraper.py pipeline/validation.py
git diff --check HEAD~2 HEAD
git status --short --branch
```

Expected: no warnings or diff errors. The only unstaged user file remains `.agent/rules/git-workflow.md`.

- [ ] **Step 3: Push the committed fix**

Fetch `origin/main`, integrate only if required without force-pushing, re-run affected tests after any integration, then:

```powershell
git push origin main
```

- [ ] **Step 4: Re-run and inspect GitHub Actions**

Start the `Update Data` workflow manually with GitHub CLI, wait for completion, and inspect the run report. Success requires:

- offline tests pass;
- live data update exits 0;
- rankings remain `retain` until all four categories are populated;
- archives return `publish`;
- generated files are committed only by the workflow allowlist.

If the run fails for a different verified data regression, preserve the failure and report it rather than bypassing the safety rule.
