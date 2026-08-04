# BWEDL Stats User-Value Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved trust, personalization, navigation, ranking, change-awareness, and accessibility improvements without changing the scraper publication contract.

**Architecture:** Add a browser-compatible CommonJS utility module containing deterministic business rules, then integrate those rules into the existing static UI. Keep `bundle_v31.js` as renderer/orchestrator, add reusable CSS components, and extend the current executable Node contract tests plus pytest wrappers.

**Tech Stack:** Vanilla JavaScript, HTML5, CSS, Node `assert`, Python pytest, static GitHub Pages PWA and service worker.

---

### Task 1: User-value utility module and trustworthy next-game selection

**Files:**
- Create: `app_utils.js`
- Create: `tests/test_user_value_utils.js`
- Create: `tests/test_user_value_utils.py`
- Modify: `index.html`
- Modify: `sw_v31.js`

- [ ] **Step 1: Write the failing utility tests**

Create a Node test that imports `app_utils.js` and asserts that `selectUpcomingGames()` excludes `Spielfrei` and `Freilos`, sorts fully dated games chronologically, keeps date-only games on their day, and places `Termin offen` last. Add initial assertions for `buildSeasonNotice()`, `buildIcsContent()`, `parseAppHash()`, and `diffVisitSnapshots()` so every exported contract begins red.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node tests/test_user_value_utils.js`

Expected: FAIL because `app_utils.js` or its exports do not exist.

- [ ] **Step 3: Implement the minimal utility API**

Expose the same object in browser and Node environments:

```js
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.BwedlAppUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
    function isByeOpponent(value) { /* normalized placeholder check */ }
    function selectUpcomingGames(schedule, now) { /* stable bucketed ordering */ }
    function buildSeasonNotice(status) { /* retain/publish view model */ }
    function buildIcsContent(game) { /* RFC5545 text with escaping */ }
    function parseAppHash(hash, routeExists) { /* validated route */ }
    function diffVisitSnapshots(previous, current) { /* deterministic changes */ }
    return { isByeOpponent, selectUpcomingGames, buildSeasonNotice, buildIcsContent, parseAppHash, diffVisitSnapshots };
});
```

Load `app_utils.js` before `bundle_v31.js` and add it to the service-worker cache with an incremented cache version.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node tests/test_user_value_utils.js`

Expected: PASS with `user value utilities: ok`.

- [ ] **Step 5: Add the pytest wrapper and run it**

The wrapper invokes Node exactly like the existing JavaScript contract wrappers.

Run: `python -m pytest tests/test_user_value_utils.py -q`

Expected: `1 passed`.

### Task 2: Startup deep links and non-blocking share feedback

**Files:**
- Create: `tests/test_deep_link_routing.js`
- Create: `tests/test_deep_link_routing.py`
- Modify: `bundle_v31.js`
- Modify: `index.html`
- Modify: `style.css`

- [ ] **Step 1: Write a failing startup-routing contract**

Extract the startup route function and prove that valid hashes render their route without rewriting to dashboard, encoded IDs decode safely, invalid hashes fall back to dashboard, and `history.replaceState` agrees with rendered state.

- [ ] **Step 2: Verify RED**

Run: `node tests/test_deep_link_routing.js`

Expected: FAIL because startup currently always replaces state with `#dashboard`.

- [ ] **Step 3: Implement startup route resolution**

Add `routeExists(type, id)` and `initializeRouteFromLocation()` using `BwedlAppUtils.parseAppHash()`. Replace unconditional startup dashboard rendering with the resolved route. Add a global `aria-live="polite"` status region and `shareCurrentView(summary)` that uses `navigator.share` or clipboard fallback without `alert()`.

- [ ] **Step 4: Verify GREEN and existing navigation contracts**

Run:

```powershell
node tests/test_deep_link_routing.js
node tests/test_profile_history.js
node tests/test_mobile_navigation.js
```

Expected: all three scripts print their `ok` marker.

### Task 3: Season context and first-visit onboarding

**Files:**
- Create: `tests/test_season_context.js`
- Create: `tests/test_season_context.py`
- Modify: `bundle_v31.js`
- Modify: `style.css`

- [ ] **Step 1: Write failing rendering contracts**

Assert that retained ranking status produces one reusable notice, and that renderers for dashboard profile, Top 20, ranking, H2H, and Match Preview call it. Assert that the dashboard creates a local-only profile onboarding card only when `myPlayerName` is absent.

- [ ] **Step 2: Verify RED**

Run: `node tests/test_season_context.js`

Expected: FAIL because inline season notices and dashboard onboarding do not exist.

- [ ] **Step 3: Implement reusable UI components**

Add `createSeasonNotice(context)` and `createProfileOnboardingCard()`. Use semantic headings, `button` actions, the exact retain copy from the design, and CSS classes rather than new inline style blocks. Insert notices immediately beside the statistics they qualify.

- [ ] **Step 4: Verify GREEN**

Run: `node tests/test_season_context.js`

Expected: PASS.

### Task 4: Personal match center actions

**Files:**
- Create: `tests/test_personal_match_center.js`
- Create: `tests/test_personal_match_center.py`
- Modify: `bundle_v31.js`
- Modify: `style.css`

- [ ] **Step 1: Write failing integration contracts**

Assert that dashboard and club pages call `selectUpcomingGames()`, the primary dashboard card cannot render a bye opponent, and action builders expose Match Preview, ICS, share, and conditional route actions.

- [ ] **Step 2: Verify RED**

Run: `node tests/test_personal_match_center.js`

Expected: FAIL because current dashboard filtering sorts missing dates first and has no action group.

- [ ] **Step 3: Implement match view models and actions**

Use a `buildGameActions(game)` helper. Store the selected matchup in session state before opening Match Preview, generate and download an ICS Blob, build an external maps URL from club address fields, and share canonical route text. Missing information omits only its dependent action.

- [ ] **Step 4: Verify GREEN**

Run: `node tests/test_personal_match_center.js`

Expected: PASS.

### Task 5: Compact club discovery and progressive details

**Files:**
- Create: `tests/test_club_experience.js`
- Create: `tests/test_club_experience.py`
- Modify: `bundle_v31.js`
- Modify: `style.css`

- [ ] **Step 1: Write failing club UX contracts**

Assert that the sidebar does not render the entire club catalog, club overview includes name and city filtering, upcoming games default to five real matches, and archive/ligapokal sections use collapsed disclosure controls. Assert incomplete cup rows receive an explicit incomplete-data state.

- [ ] **Step 2: Verify RED**

Run: `node tests/test_club_experience.js`

Expected: FAIL against the full sidebar list and fully expanded club detail.

- [ ] **Step 3: Implement compact discovery**

Replace the sidebar catalog with overview, search, favorites, and recent clubs. Add reusable filtering to the overview. Render club sections with semantic disclosure buttons carrying `aria-expanded` and stable `aria-controls`; keep the current-season summary open and historical sections closed.

- [ ] **Step 4: Verify GREEN**

Run: `node tests/test_club_experience.js`

Expected: PASS.

### Task 6: Ranking analysis toolbar and own-position navigation

**Files:**
- Create: `tests/test_ranking_tools.js`
- Create: `tests/test_ranking_tools.py`
- Modify: `app_utils.js`
- Modify: `bundle_v31.js`
- Modify: `style.css`

- [ ] **Step 1: Write failing pure and rendering tests**

Add `filterAndSortRanking()` tests for official order, points, average, games, text filtering, and minimum games. Add DOM-source contracts for labeled controls, preserved official rank values, own-row highlighting, and `Meine Position`.

- [ ] **Step 2: Verify RED**

Run: `node tests/test_ranking_tools.js`

Expected: FAIL because the helper and toolbar are absent.

- [ ] **Step 3: Implement ranking tools**

Render controls above the ranking table, keep official rank as immutable data, rebuild visible rows from filtered view models, label alternative sorting as `Analyseansicht`, and scroll the saved player's row with reduced-motion awareness.

- [ ] **Step 4: Verify GREEN**

Run: `node tests/test_ranking_tools.js`

Expected: PASS.

### Task 7: Changes since last visit

**Files:**
- Create: `tests/test_visit_changes.js`
- Create: `tests/test_visit_changes.py`
- Modify: `app_utils.js`
- Modify: `bundle_v31.js`
- Modify: `style.css`

- [ ] **Step 1: Write failing snapshot tests**

Test first visit, corrupt storage, newer data timestamp, own-rank change, own-points change, team-result count change, and next-game reschedule. Assert that identical snapshots yield no message.

- [ ] **Step 2: Verify RED**

Run: `node tests/test_visit_changes.js`

Expected: FAIL until all diff cases and UI integration exist.

- [ ] **Step 3: Implement local snapshot lifecycle**

Build the current snapshot only after data initialization, compare it with safely parsed prior state, render a dismissible dashboard change card, then persist the current snapshot. Store only public derived values and the already locally selected profile/team.

- [ ] **Step 4: Verify GREEN**

Run: `node tests/test_visit_changes.js`

Expected: PASS.

### Task 8: Accessibility, mobile overflow, PWA verification, and documentation

**Files:**
- Create: `tests/test_accessibility_contract.js`
- Create: `tests/test_accessibility_contract.py`
- Modify: `bundle_v31.js`
- Modify: `index.html`
- Modify: `style.css`
- Modify: `sw_v31.js`
- Modify: `USER_GUIDE.md`
- Modify: `WIKI.md`

- [ ] **Step 1: Write failing accessibility contracts**

Assert semantic sidebar controls, `aria-expanded` on disclosures, keyboard handling for search results, global live region, visible `:focus-visible`, reduced-motion rules, and an overflow-safe mobile content contract.

- [ ] **Step 2: Verify RED**

Run: `node tests/test_accessibility_contract.js`

Expected: FAIL on current generic clickable navigation and missing global live region.

- [ ] **Step 3: Implement accessibility and responsive refinements**

Create semantic elements at construction time, add keyboard selection and Escape behavior, use reusable focus styles, constrain table overflow to `.table-scroll`, and eliminate the outer content-area width mismatch at `390px`.

- [ ] **Step 4: Update user documentation**

Document direct links, profile privacy, season notices, calendar/share actions, ranking analysis, visit changes, and compact club navigation. Keep the automatic six-hour update description unchanged.

- [ ] **Step 5: Run all automated verification**

Run:

```powershell
node --check app_utils.js
node --check bundle_v31.js
python -m pytest -q
git diff --check
```

Expected: syntax checks exit 0, pytest reports no failures, and `git diff --check` reports no new whitespace errors. The known user-owned trailing blank line in `.agent/rules/git-workflow.md` must remain untouched and may be excluded from the scoped check.

- [ ] **Step 6: Run browser QA**

Serve the app locally, then verify desktop and `390 x 844`: first visit, profile setup, correct next game, season notices, direct-link reload, share fallback, ICS download, ranking filters, compact club page, keyboard focus, offline reload, no outer horizontal scroll, and no application console error.

- [ ] **Step 7: Review scope and prepare publication**

Confirm `git status --short` contains only intended implementation files plus the pre-existing user-owned `.agent/rules/git-workflow.md`. Do not stage that user file. Commit the implementation in intentional slices; push only after explicit publication approval.
