# GitHub-Pages Security and Profile Identity Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan task by task. Do not use subagents for this repository session. Follow superpowers:test-driven-development for every behavior change and superpowers:verification-before-completion before reporting success.

**Goal:** Remove the obsolete local product runtime, close every confirmed published-data HTML execution path, and replace name-only player profiles with an unambiguous, migratable identity model while preserving GitHub Pages, offline behavior, and the scheduled data workflow.

**Architecture:** GitHub Pages remains the only product runtime. GitHub Actions runs the existing Python pipeline and publishes static artifacts. A shared Python sanitizer reduces source tables before validation and publication; the browser independently rebuilds tables from inert parsed text. Pure identity helpers in `app_utils.js` distinguish category-scoped ranking records from cautiously grouped people, while `bundle_v31.js` owns storage migration and UI integration.

**Tech Stack:** Vanilla JavaScript, HTML5, service worker, Python 3.13, BeautifulSoup 4, pytest 8.4, Playwright Chromium, Node `assert`, GitHub Actions, GitHub Pages.

**Owning design:** `docs/superpowers/specs/2026-08-18-github-pages-security-identity-design.md`

**Protected existing work:** `.agent/rules/git-workflow.md` is a pre-existing user modification. Never stage, edit, restore, or include it in a commit.

---

## Task 1: Make GitHub Pages the only product runtime

**Files:**

- Create: `tests/test_github_pages_runtime.py`
- Create: `tests/test_public_refresh.js`
- Modify: `tests/test_public_status.py`
- Modify: `app_utils.js`
- Modify: `bundle_v31.js`
- Modify: `sw_v31.js`
- Modify: `README.md`
- Modify: `USER_GUIDE.md`
- Delete: `server.py`
- Delete: `start.bat`

### Step 1: Write the failing runtime-contract tests

Add `tests/test_github_pages_runtime.py` with assertions that:

- `server.py` and `start.bat` do not exist;
- product JavaScript contains no `/api/update`, `update_status.json`, `localhost` branch, or process-progress polling;
- `triggerUpdate()` delegates to a public-data probe and never starts a scraper;
- documentation names GitHub Pages as the only product runtime and does not instruct users to run `python server.py`;
- service-worker paths remain relative and no fetch handler depends on `/api/*`.

Add `tests/test_public_refresh.js` for a pure `probePublishedData()` helper exported from `app_utils.js`. Prove that it:

- resolves `data_status.json` against `document.baseURI`, including a `/BWEDL-Stats/` project path;
- appends a cache-busting query without converting the request to an origin-root URL;
- uses `cache: 'no-store'` and rejects non-2xx or malformed responses;
- never calls a GitHub API or sends credentials.

Wrap the Node test in the Python contract test or add a dedicated Python wrapper following the existing `tests/test_public_status.py` pattern.

### Step 2: Run the tests and confirm RED

Run:

```powershell
python -m pytest tests/test_github_pages_runtime.py tests/test_public_status.py -q
node tests/test_public_refresh.js
```

Expected: failures report the existing `server.py`, `start.bat`, local hostname branch, `/api/update`, polling code, and missing `probePublishedData()`.

### Step 3: Implement the public-only refresh path

In `app_utils.js`, add and export:

```javascript
async function probePublishedData(fetchImpl, baseUri, nowValue) { /* ... */ }
```

The helper must resolve `new URL('data_status.json', baseUri)`, add a `t` query value, perform a no-store GET, validate the status payload shape, and return the parsed public status without mutating globals.

In `bundle_v31.js`, reduce `triggerUpdate()` to:

1. disable both refresh controls and expose a polite status;
2. call `BwedlAppUtils.probePublishedData(fetch, document.baseURI, Date.now())`;
3. reload only after the public status request succeeds;
4. on failure, keep the cached app usable, restore the controls, and show `Keine Verbindung – gespeicherter Datenstand bleibt verfügbar.`;
5. never inspect the hostname, POST, poll, or claim that a workflow was started.

Use `textContent`, not `innerHTML`, for button and status feedback. Update the service-worker comment so it describes ignored non-GET requests generically rather than a removed API.

Remove `server.py` and `start.bat`. Replace README/User Guide product-runtime instructions with:

- the GitHub Pages URL/role;
- GitHub Actions as the only automatic data update;
- an explicitly development-only example using `python -m http.server 8000 --bind 127.0.0.1` when a static preview is needed.

Do not remove `update_status.json` generation from `update_data.py`; it remains unpublished diagnostic output.

### Step 4: Run the focused tests and confirm GREEN

Run:

```powershell
python -m pytest tests/test_github_pages_runtime.py tests/test_public_status.py -q
node tests/test_public_refresh.js
node --check app_utils.js
node --check bundle_v31.js
node --check sw_v31.js
```

Expected: all commands exit `0`; the Node test prints its success marker.

### Step 5: Commit only Task 1 files

```powershell
git add -- app_utils.js bundle_v31.js sw_v31.js README.md USER_GUIDE.md tests/test_github_pages_runtime.py tests/test_public_refresh.js tests/test_public_status.py server.py start.bat
git diff --cached --check
git commit -m "refactor: make GitHub Pages the only runtime"
```

---

## Task 2: Add a deterministic pipeline table sanitizer

**Files:**

- Create: `pipeline/html_sanitizer.py`
- Create: `tests/test_html_sanitizer.py`
- Modify: `pipeline/__init__.py` only if a public export is necessary

### Step 1: Write malicious and valid fixtures as failing tests

Cover at least:

- `script`, `style`, `iframe`, `object`, `embed`, `svg`, `math`, `img`, forms, comments, and event handlers;
- `href`, `src`, `srcdoc`, `style`, `class`, `id`, `data-*`, and unknown attributes;
- nested active markup inside a cell;
- harmless inline markup such as `b`, `span`, `br`, and `a`, whose visible text must remain but whose elements/attributes must not;
- one table and a multi-table fragment as produced by the current Ligapokal scraper;
- deterministic output for whitespace variants;
- valid `rowspan` and `colspan` values;
- invalid, negative, zero, excessively large, or non-numeric span values;
- missing tables, tables without rows, and tables without cells.

The expected output may contain only `table`, `thead`, `tbody`, `tfoot`, `tr`, `th`, `td`, plain escaped text, and bounded positive spans.

### Step 2: Run the sanitizer test and confirm RED

```powershell
python -m pytest tests/test_html_sanitizer.py -q
```

Expected: import failure for `pipeline.html_sanitizer`.

### Step 3: Implement the sanitizer

Create:

```python
class TableSanitizationError(ValueError): ...

def sanitize_table_fragment(raw_html: str) -> str: ...
def safe_table_fragment_issue(html: object) -> str | None: ...
```

Implementation rules:

- parse with BeautifulSoup's built-in `html.parser`;
- construct a new tree/string from allowed structure rather than mutating and reserializing source nodes;
- use cell `get_text(" ", strip=True)` and HTML escaping for content;
- copy only `rowspan`/`colspan` values in the agreed bounded integer range;
- ignore external headings and wrappers; Ligapokal round labels remain available in structured `match_days`;
- preserve the order of multiple tables;
- raise `TableSanitizationError` when no usable table remains;
- make `safe_table_fragment_issue()` reject any tag or attribute outside the normalized contract.

### Step 4: Run focused tests and confirm GREEN

```powershell
python -m pytest tests/test_html_sanitizer.py -q
```

Expected: all sanitizer cases pass.

### Step 5: Commit Task 2

```powershell
git add -- pipeline/html_sanitizer.py pipeline/__init__.py tests/test_html_sanitizer.py
git diff --cached --check
git commit -m "feat: sanitize published table fragments"
```

---

## Task 3: Enforce sanitizing before publication and validate the boundary

**Files:**

- Modify: `league_scraper.py`
- Modify: `ranking_scraper.py`
- Modify: `pipeline/validation.py`
- Modify: `tests/test_scraper_outputs.py`
- Modify: `tests/test_validation.py`

### Step 1: Add failing integration and validation tests

In `tests/test_scraper_outputs.py`, assert that both scrapers import and apply `sanitize_table_fragment()` to every captured table before `write_json_pair()` receives the candidate. Cover standard league, ranking, and multi-table Ligapokal branches with fake page output containing an `onerror` or `script` payload.

In `tests/test_validation.py`, prove that otherwise structurally valid ranking and current-league candidates are blocked when they contain:

- forbidden tags;
- any event/URL/style attribute;
- multiple tables where rankings or regular standings require exactly one;
- a sanitized fragment that lost required rows or columns.

Also prove a fully sanitized table still publishes and retained-data decisions remain unchanged.

### Step 2: Run and confirm RED

```powershell
python -m pytest tests/test_scraper_outputs.py tests/test_validation.py -q
```

Expected: malicious candidates currently pass or scraper outputs retain unsafe markup.

### Step 3: Integrate the shared sanitizer

- In `ranking_scraper.py`, sanitize the selected ranking table before assigning `data["rankings"][rank_name]`.
- In `league_scraper.py`, sanitize the standard standings table immediately after extraction.
- For Ligapokal fragments, sanitize the concatenated table fragment; do not rely on source `<h3>` elements for labels because `match_days` already carries round names.
- Let sanitization errors fail the scraper so `update_data.py` retains the previous valid public artifacts.
- In `pipeline/validation.py`, call `safe_table_fragment_issue()` before the existing ranking/standings structural checks. Rankings and regular league standings must contain exactly one normalized table.
- Record a specific malformed/unsafe reason without echoing payload content into logs.

### Step 4: Run focused tests and confirm GREEN

```powershell
python -m pytest tests/test_html_sanitizer.py tests/test_scraper_outputs.py tests/test_validation.py -q
```

Expected: all tests pass and malicious payload text never appears as executable markup.

### Step 5: Commit Task 3

```powershell
git add -- league_scraper.py ranking_scraper.py pipeline/validation.py tests/test_scraper_outputs.py tests/test_validation.py
git diff --cached --check
git commit -m "fix: enforce safe tables before publication"
```

---

## Task 4: Rebuild published tables safely in the browser

**Files:**

- Create: `tests/test_safe_published_tables.py`
- Create: `tests/test_safe_published_tables.js`
- Modify: `bundle_v31.js`

### Step 1: Write failing frontend security contracts

The tests must fail while any published table reaches a live container through `innerHTML`. Assert removal of the current sinks for:

- Ligapokal archive `data.table`;
- regular and Ligapokal `leagueData.leagues[*].table`;
- ranking fallback `rankingData.rankings[*]`;
- helper parsing in league-leader, team-rank, and Match Preview extraction paths.

Test the existing safe-table helper with a fake/inert source model and assert:

- only locally created `table`/section/row/cell nodes are appended;
- cell content is assigned through `textContent`;
- bounded `rowspan` and `colspan` are preserved;
- source classes, styles, event attributes, links, images, SVG and scripts are never adopted;
- multiple source tables produce multiple safe tables;
- row extraction returns only normalized text arrays.

### Step 2: Run and confirm RED

```powershell
python -m pytest tests/test_safe_published_tables.py -q
node tests/test_safe_published_tables.js
```

Expected: unsafe `innerHTML` assignments and temporary live-container parsing are reported.

### Step 3: Consolidate safe table helpers

In `bundle_v31.js`:

- keep `DOMParser` parsing in an inert document;
- replace duplicate table builders with one `createSafeTablesFromHtml()` plus small `safeTableRowsFromHtml()` and `replaceWithSafeTables()` helpers;
- construct every destination node with `document.createElement()` and every cell value with `textContent`;
- revalidate span values in JavaScript before setting them;
- replace all direct published-table `innerHTML` assignments;
- replace temporary `<div>.innerHTML` extraction in `extractLeagueLeader`, dashboard team-rank aggregation, and Match Preview team extraction with `safeTableRowsFromHtml()`;
- delete the unused unsafe `renderRankingLegacy()` implementation;
- render current Ligapokal rounds from `match_days` and their round keys, or render each sanitized table separately, so removing source `<h3>` tags does not lose user-visible round context;
- preserve `cleanTable()` styling and clickable team-name enhancement on the newly built nodes.

Do not convert static trusted skeleton templates in this task.

### Step 4: Run focused tests and confirm GREEN

```powershell
python -m pytest tests/test_safe_published_tables.py tests/test_accessibility_contract.py tests/test_club_experience.py tests/test_personal_match_center.py -q
node tests/test_safe_published_tables.js
node --check bundle_v31.js
```

Expected: all commands exit `0` and no published-data sink remains.

### Step 5: Commit Task 4

```powershell
git add -- bundle_v31.js tests/test_safe_published_tables.py tests/test_safe_published_tables.js
git diff --cached --check
git commit -m "fix: render published tables as inert text"
```

---

## Task 5: Close confirmed dynamic-text injection sinks

**Files:**

- Create: `tests/test_dynamic_text_security.py`
- Create: `tests/test_dynamic_text_security.js`
- Modify: `app_utils.js`
- Modify: `bundle_v31.js`

### Step 1: Add failing malicious-text tests

Use sentinel strings such as `<img src=x onerror="document.body.dataset.xss='1'">` and `</span><svg onload=...>` for:

- stored profile display name;
- favorites;
- global-search labels/context;
- H2H selectors/results;
- Match Scorer user-entered player names;
- ranking/player/team names interpolated into complex tool results.

Assert the visible text is preserved but no element from the sentinel is created and no handler runs. Add source contracts for the confirmed direct sinks at the old profile link, favorite, global-search, comparison, and Match Scorer sites.

### Step 2: Run and confirm RED

```powershell
python -m pytest tests/test_dynamic_text_security.py -q
node tests/test_dynamic_text_security.js
```

Expected: at least the existing profile, favorite, search, comparison, or scorer sink violates the contract.

### Step 3: Replace or escape dynamic markup deliberately

- Prefer `replaceChildren()`, `createElement()`, and `textContent` for simple content.
- Add an exported `escapeHtmlText()` helper to `app_utils.js` only for complex trusted-layout templates that cannot reasonably be converted in this package.
- Escape every interpolated external/user value before it enters such a template; never escape an entire assembled HTML string after construction.
- Keep static icon/layout markup separate from the text node.
- Do not treat names from generated files as trusted merely because they came through GitHub Actions.

### Step 4: Run and confirm GREEN

```powershell
python -m pytest tests/test_dynamic_text_security.py tests/test_accessibility_contract.py tests/test_ranking_tools.py -q
node tests/test_dynamic_text_security.js
node --check app_utils.js
node --check bundle_v31.js
```

Expected: all malicious strings render as text and existing accessibility/ranking contracts pass.

### Step 5: Commit Task 5

```powershell
git add -- app_utils.js bundle_v31.js tests/test_dynamic_text_security.py tests/test_dynamic_text_security.js
git diff --cached --check
git commit -m "fix: render dynamic labels as text"
```

---

## Task 6: Introduce category-safe player identity helpers

**Files:**

- Create: `tests/test_player_identity.py`
- Create: `tests/test_player_identity.js`
- Modify: `app_utils.js`

### Step 1: Write pure failing identity tests

Specify and test:

- canonical category normalization for the four ranking classes and seasonal labels;
- `recordKey = canonicalCategory + '|' + trimmed id`;
- no key for invalid/missing category or ID;
- identical IDs in different classes create different record keys;
- `personKey` requires normalized `v_nr`, ID, and canonical name;
- the current `v_nr=005`, `id=1017`, different-name case stays in two groups;
- identical `v_nr`, ID, and canonical name across two or three classes group together;
- a group's primary record is selected only by an explicit valid `recordKey`;
- versioned profile serialization/validation rejects corrupt or incomplete objects;
- a unique legacy-name match migrates, while multiple person groups return an explicit `ambiguous` result;
- migration never chooses the first source row merely because it appears first.

### Step 2: Run and confirm RED

```powershell
python -m pytest tests/test_player_identity.py -q
node tests/test_player_identity.js
```

Expected: missing exports from `app_utils.js`.

### Step 3: Implement pure identity and migration functions

Add and export constants/functions equivalent to:

```javascript
const PLAYER_PROFILE_VERSION = 2;
const PLAYER_PROFILE_STORAGE_KEY = 'bwedl_player_profile';
function canonicalRankingCategory(value) { /* ... */ }
function rankingRecordKey(player) { /* ... */ }
function rankingPersonKey(player) { /* ... */ }
function groupRankingPeople(players) { /* ... */ }
function createPlayerProfile(group, primaryRecordKey, teamName) { /* ... */ }
function validatePlayerProfile(value) { /* ... */ }
function resolvePlayerProfile(players, storedProfile) { /* ... */ }
function migrateLegacyPlayerProfile(players, legacyName, legacyTeam) { /* ... */ }
```

Return result objects such as `resolved`, `missing`, `ambiguous`, or `invalid`; do not throw for user storage corruption. Keep source player arrays immutable.

### Step 4: Run and confirm GREEN

```powershell
python -m pytest tests/test_player_identity.py tests/test_ranking_tools.py tests/test_user_value_utils.py -q
node tests/test_player_identity.js
node --check app_utils.js
```

Expected: identity tests and existing utility contracts pass.

### Step 5: Commit Task 6

```powershell
git add -- app_utils.js tests/test_player_identity.py tests/test_player_identity.js
git diff --cached --check
git commit -m "feat: add category-safe player identities"
```

---

## Task 7: Migrate and use exact profiles throughout the UI

**Files:**

- Create: `tests/test_profile_identity_ui.py`
- Create: `tests/test_profile_identity_ui.js`
- Modify: `tests/test_profile_history.js`
- Modify: `tests/test_profile_history.py` if its wrapper or assertions change
- Modify: `tests/test_season_context.js`
- Modify: `tests/test_ranking_tools.js`
- Modify: `bundle_v31.js`
- Modify: `style.css`
- Modify: `WIKI.md`

### Step 1: Add failing UI and migration tests

Cover these journeys with a controlled fake DOM/storage harness:

- free text cannot be saved without selecting a suggestion;
- changing text after selection clears the selected identity;
- suggestions group only safe same-person records and show club plus classes;
- a multi-class person requires or retains an explicit primary class;
- saved storage contains the versioned profile and exact `recordKey`;
- a unique old `myPlayerName` migrates and removes legacy keys only after a successful new write;
- an ambiguous old name stays as search input and displays a one-time confirmation request;
- storage write failure preserves legacy keys;
- reset removes new and legacy profile keys and preserves the existing history-navigation contract;
- dashboard snapshot, ranking highlight, `Meine Position`, Match Preview auto-detection, and personal statistics resolve through the exact profile record/group rather than `.find(name === myPlayerName)`;
- same-name players and cross-class duplicate IDs cannot hijack the profile.

### Step 2: Run and confirm RED

```powershell
python -m pytest tests/test_profile_identity_ui.py tests/test_profile_history.py tests/test_season_context.py tests/test_ranking_tools.py -q
node tests/test_profile_identity_ui.js
```

Expected: name-only storage and lookups violate the new contract.

### Step 3: Integrate the versioned profile state

In `bundle_v31.js`:

- initialize a single `myPlayerProfile` from the new storage object;
- run safe one-time legacy migration after ranking data is available;
- derive `myPlayerName`, primary player, person-group records, and team label only for display/backward-compatible presentation;
- provide small helpers such as `getMyPrimaryPlayer()`, `getMyPlayerRecords()`, and `isMyPlayerRecord(player)`;
- replace identity-critical `find(p => p.name === myPlayerName)` and name-only highlighting with these helpers;
- rebuild player search/grouping from the identity utilities instead of deduplicating on global `p.id`;
- keep the selected suggestion object separate from input text;
- show a primary-class control only for a true multi-class group;
- write the new profile before deleting `myPlayerName`/`myTeamName`;
- retain the existing `history.replaceState()` profile-exit behavior;
- update sidebar/profile labels with text nodes;
- use a non-blocking validation message and accessible labels/status;
- avoid adding another persistent document-level click listener on each render.

Update styles only for the class choice, identity context, and validation state. Update WIKI text to explain local profile storage, exact selection, multi-class behavior, and one-time legacy confirmation.

### Step 4: Run focused regression tests and confirm GREEN

```powershell
python -m pytest tests/test_profile_identity_ui.py tests/test_profile_history.py tests/test_season_context.py tests/test_ranking_tools.py tests/test_personal_match_center.py tests/test_visit_changes.py tests/test_deep_link_routing.py -q
node tests/test_profile_identity_ui.js
node --check bundle_v31.js
```

Expected: all profile journeys and dependent dashboard/match/ranking contracts pass.

### Step 5: Commit Task 7

```powershell
git add -- bundle_v31.js style.css WIKI.md tests/test_profile_identity_ui.py tests/test_profile_identity_ui.js tests/test_profile_history.py tests/test_profile_history.js tests/test_season_context.js tests/test_ranking_tools.js
git diff --cached --check
git commit -m "fix: bind profiles to exact ranking records"
```

---

## Task 8: Add the real GitHub-Pages browser security gate and verify the package

**Files:**

- Create: `tests/test_browser_security.py`
- Modify: `.github/workflows/update.yml`
- Modify: `index.html`
- Modify: `sw_v31.js`
- Modify: version-sensitive tests including `tests/test_accessibility_contract.js`, `tests/test_service_worker_status.js`, `tests/test_user_value_utils.js`, and `tests/test_reported_ui_regressions.js`
- Modify: `README.md` if the verification command needs documenting

### Step 1: Write the opt-in browser test and workflow contract first

Create `tests/test_browser_security.py` with an environment gate:

- normal offline `python -m pytest` skips the browser test when `BWEDL_BROWSER_TESTS` is absent;
- `BWEDL_BROWSER_TESTS=1` starts a short-lived test-only `ThreadingHTTPServer` on `127.0.0.1` that maps a `/BWEDL-Stats/` prefix to static repository files;
- the test owns and shuts down only its own server/thread;
- Playwright injects or fulfills malicious league/ranking/player data before app startup;
- it visits the relevant league, ranking, search, profile, and Match Scorer paths;
- it asserts sentinel text is visible where expected, no injected element/handler executes, no application error is logged, and no request targets `/api/*`;
- it reloads once with the service worker controlling the page, switches the context offline, reloads again, and confirms the shell/profile remain usable under the project subpath.

Extend `tests/test_workflow_contract.py` first so it requires the browser security command after the Chromium installation step and before the live update.

### Step 2: Run and confirm RED

```powershell
python -m pytest tests/test_workflow_contract.py -q
$env:BWEDL_BROWSER_TESTS='1'
python -m pytest tests/test_browser_security.py -q
Remove-Item Env:BWEDL_BROWSER_TESTS
```

Expected: workflow contract fails until the new step is added; browser assertions may expose any remaining unsafe sink or subpath/cache defect.

### Step 3: Wire the CI gate and bump public cache keys

In `.github/workflows/update.yml`, after Chromium installation and before `Run live data update`, add:

```yaml
- name: Run browser security smoke
  env:
    BWEDL_BROWSER_TESTS: "1"
  run: python -m pytest tests/test_browser_security.py -q
```

Bump changed asset query versions in `index.html` and `sw_v31.js`, increment the service-worker cache name, and update all exact-version contract tests together. Keep URLs relative.

### Step 4: Run the complete verification matrix

Run:

```powershell
python -m pytest
$env:BWEDL_BROWSER_TESTS='1'
python -m pytest tests/test_browser_security.py -q
Remove-Item Env:BWEDL_BROWSER_TESTS
node --check app_utils.js
node --check bundle_v31.js
node --check sw_v31.js
git diff --check -- . ':(exclude).agent/rules/git-workflow.md'
git status --short
```

Expected:

- the full offline suite passes with only intentional existing/opt-in skips;
- the real browser security smoke passes under `/BWEDL-Stats/` online and offline;
- all syntax checks exit `0`;
- changed task files have no whitespace errors;
- `.agent/rules/git-workflow.md` remains the only unrelated dirty file and is unstaged.

If Chromium is not installed locally, install it only with explicit user approval or run the already configured CI-equivalent environment. Do not weaken or silently skip the final browser assertion when claiming completion.

### Step 5: Commit Task 8

```powershell
git add -- .github/workflows/update.yml index.html sw_v31.js README.md tests/test_browser_security.py tests/test_workflow_contract.py tests/test_accessibility_contract.js tests/test_service_worker_status.js tests/test_user_value_utils.js tests/test_reported_ui_regressions.js
git diff --cached --check
git commit -m "test: gate published-data security in Chromium"
```

### Step 6: Review commit scope without pushing or deploying

```powershell
git log --oneline --decorate main..HEAD
git diff --stat main...HEAD
git diff --name-status main...HEAD
git status --short
```

Expected: only the design, plan, package implementation, tests, and documentation are on the feature branch. Do not push, open a PR, merge, trigger `workflow_dispatch`, or deploy without separate user authorization.

---

## Completion handoff

Report separately:

1. implemented code and automated evidence;
2. real browser evidence under the GitHub Pages subpath and offline mode;
3. remaining manual/external GitHub Pages verification;
4. the untouched foreign `.agent/rules/git-workflow.md` change;
5. the next package: valid PWA icons, public data-freshness UX, view lifecycle cleanup, and Ligapokal-pipeline disposition.

Do not call this package deployed or production-verified until the branch is intentionally integrated, GitHub checks complete, and the actual GitHub Pages site is smoke-tested after publication.
