# Ligapokal Mobile Table Scrolling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every current and archived Ligapokal table horizontally scrollable on small screens without allowing the page itself to overflow.

**Architecture:** Reuse the existing `table-container table-scroll` UI contract through one DOM helper in `bundle_v31.js`. Both the sanitized-HTML and reconstructed-row Ligapokal renderers will pass each table through that helper, while headings and the surrounding page remain outside the horizontal scroll region. GitHub Pages cache keys will advance with the changed bundle.

**Tech Stack:** Static HTML/CSS/JavaScript PWA, Node.js contract tests, pytest, Playwright Chromium, GitHub Pages service worker.

---

### Task 1: Reproduce both Ligapokal overflow paths

**Files:**
- Modify: `tests/test_safe_published_tables.js`
- Modify: `tests/test_safe_published_tables.py`
- Modify: `tests/test_browser_security.py`

- [ ] **Step 1: Write the failing DOM contract**

Change the cup destination expectations in `tests/test_safe_published_tables.js` so each table must be the sole child of an established scroll wrapper:

```js
assert.deepEqual(cupDestination.children.map((node) => node.tagName), ['H3', 'DIV', 'H3', 'DIV']);
const cupScrollRegions = [cupDestination.children[1], cupDestination.children[3]];
assert.deepEqual(
    cupScrollRegions.map((node) => node.className),
    ['table-container table-scroll', 'table-container table-scroll'],
);
assert.deepEqual(
    cupScrollRegions.map((node) => node.children.map((child) => child.tagName)),
    [['TABLE'], ['TABLE']],
);
```

Add a source contract in `tests/test_safe_published_tables.py` proving the reconstructed archive-row branch uses the same helper:

```python
assert "function createScrollableTableRegion" in source
assert "fragment.appendChild(createScrollableTableRegion(table))" in source
assert "resultsContainer.appendChild(createScrollableTableRegion(tableElement))" in source
```

- [ ] **Step 2: Add current and archived browser fixtures**

Extend `TEST_ASSETS` in `tests/test_browser_security.py` with a wide current Ligapokal entry in `league_data.js` and a reconstructed archived entry in `ligapokal_archive.js`. Each fixture table must contain enough non-wrapping columns to exceed a 390-pixel viewport, for example:

```python
"Ligapokal 2026-2027": {
    "url": "https://example.invalid/cup",
    "match_days": {"Finale": "Fr. 28.08.2026 20:00 Malicious Club - Safe Team ---"},
    "table": (
        "<table><tbody><tr><th>Datum</th><th>Heimmannschaft</th>"
        "<th>Ergebnis</th><th>Auswärtsmannschaft</th><th>Spielort</th></tr>"
        "<tr><td>28.08.2026</td><td>Malicious Club Team Eins</td><td>---</td>"
        "<td>Safe Team mit langem Namen</td><td>Testlokal Teststadt</td></tr></tbody></table>"
    ),
}
```

For both `#league/Ligapokal%202026-2027` and `#ligapokalArchive/Ligapokal%202025-2026`, assert at `390x844` that the table wrapper exists, `scrollWidth > clientWidth`, assigning `scrollLeft = 80` produces `scrollLeft > 0`, and `document.documentElement.scrollWidth <= window.innerWidth`.

- [ ] **Step 3: Run the focused tests to verify RED**

Run:

```powershell
node tests/test_safe_published_tables.js
python -m pytest tests/test_safe_published_tables.py -q -p no:cacheprovider
$env:BWEDL_BROWSER_TESTS='1'; python -m pytest tests/test_browser_security.py -q -p no:cacheprovider; Remove-Item Env:BWEDL_BROWSER_TESTS
```

Expected: the DOM contract fails because cup tables are direct children, the Python contract fails because the helper does not exist, and the Chromium test fails because no Ligapokal scroll wrapper exists.

- [ ] **Step 4: Commit the RED regression tests**

```powershell
git add -- tests/test_safe_published_tables.js tests/test_safe_published_tables.py tests/test_browser_security.py
git commit -m "test: reproduce Ligapokal mobile table overflow"
```

### Task 2: Put every Ligapokal table in the established scroll region

**Files:**
- Modify: `bundle_v31.js:381-395`
- Modify: `bundle_v31.js:5699-5721`

- [ ] **Step 1: Add the focused scroll-wrapper helper**

Place this helper immediately before `replaceWithSafeCupTables`:

```js
function createScrollableTableRegion(table) {
    const region = document.createElement('div');
    region.className = 'table-container table-scroll';
    region.appendChild(table);
    return region;
}
```

- [ ] **Step 2: Use the helper for sanitized cup tables**

In `replaceWithSafeCupTables`, replace the direct append with:

```js
fragment.appendChild(createScrollableTableRegion(table));
```

Keep each existing round heading directly in the outer fragment so it does not scroll horizontally.

- [ ] **Step 3: Use the helper for reconstructed archive tables**

In the `data.tables` branch of `renderLigapokalArchive`, replace:

```js
resultsContainer.appendChild(tableElement);
```

with:

```js
resultsContainer.appendChild(createScrollableTableRegion(tableElement));
```

- [ ] **Step 4: Run the focused DOM and source contracts to verify GREEN**

Run:

```powershell
node tests/test_safe_published_tables.js
python -m pytest tests/test_safe_published_tables.py -q -p no:cacheprovider
node --check bundle_v31.js
```

Expected: the Node contract prints `safe published table rendering contract: ok`, pytest passes, and syntax validation exits zero.

### Task 3: Refresh the GitHub Pages bundle cache contract

**Files:**
- Modify: `index.html:124`
- Modify: `sw_v31.js:1-25`
- Modify: `tests/test_accessibility_contract.js:317-321`
- Modify: `tests/test_reported_ui_regressions.js:254-258`

- [ ] **Step 1: Advance the bundle query key and service-worker cache**

Change the bundle asset from `bundle_v31.js?v=3.7` to `bundle_v31.js?v=3.8` in `index.html` and the service-worker precache list. Advance the service-worker cache name from `bwedl-dashboard-v40` to `bwedl-dashboard-v41` so an existing GitHub Pages installation receives the corrected bundle.

- [ ] **Step 2: Update the cache regression contract**

Change the corresponding expectations in `tests/test_reported_ui_regressions.js`:

```js
for (const asset of ['style.css?v=7', 'app_utils.js?v=4', 'bundle_v31.js?v=3.8']) {
    assert.ok(index.includes(asset), `index must load ${asset}`);
    assert.ok(worker.includes(`'./${asset}'`), `service worker must cache ${asset}`);
}
assert.match(worker, /bwedl-dashboard-v41/);
```

Change the requested bundle expectation in `tests/test_accessibility_contract.js` from `./bundle_v31.js?v=3.7` to `./bundle_v31.js?v=3.8` so both cache-contract suites describe the same application shell.

- [ ] **Step 3: Run the cache and real-browser contracts**

Run:

```powershell
node tests/test_reported_ui_regressions.js
$env:BWEDL_BROWSER_TESTS='1'; python -m pytest tests/test_browser_security.py -q -p no:cacheprovider; Remove-Item Env:BWEDL_BROWSER_TESTS
```

Expected: every Node subtest passes and the real Chromium test passes for both Ligapokal routes at 390x844.

- [ ] **Step 4: Commit the implementation and cache refresh**

```powershell
git add -- bundle_v31.js index.html sw_v31.js tests/test_reported_ui_regressions.js
git commit -m "fix: scroll Ligapokal tables on small screens"
```

### Task 4: Verify the complete isolated branch

**Files:**
- Verify only; no planned modifications.

- [ ] **Step 1: Run all focused JavaScript and Python checks**

Run:

```powershell
node tests/test_safe_published_tables.js
node tests/test_reported_ui_regressions.js
node tests/test_accessibility_contract.js
node --check bundle_v31.js
node --check sw_v31.js
python -m pytest tests/test_safe_published_tables.py tests/test_accessibility_contract.py -q -p no:cacheprovider
```

Expected: all commands exit zero.

- [ ] **Step 2: Run the full regression suite**

Run:

```powershell
python -m pytest tests -q -p no:cacheprovider
```

Expected: the baseline remains at 662 passed and 16 skipped because this plan strengthens existing test functions instead of adding another collected pytest case.

- [ ] **Step 3: Run final repository checks**

Run:

```powershell
git diff main...HEAD --check
git status --short --branch
git log --oneline main..HEAD
```

Expected: patch validation exits zero; only the isolated branch is active; the history contains the design, RED test, and implementation commits; no production push or deployment has occurred.
