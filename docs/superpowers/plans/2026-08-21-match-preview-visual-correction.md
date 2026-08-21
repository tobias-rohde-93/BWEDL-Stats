# Match Preview Visual Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the published Match Preview back in line with the approved A+B mockup while preserving the existing data and forecast contracts.

**Architecture:** Keep the static GitHub Pages runtime and existing guarded fixture selection. Correct only the Match Preview DOM/CSS contracts: a bounded carousel with compact status navigation, a selected-match hero, a readable percentage matrix, and historical-rating-aware optimal-lineup output.

**Tech Stack:** Vanilla JavaScript, CSS, Node contract tests, Python Playwright integration tests, GitHub Pages service worker.

---

### Task 1: Lock the live visual regressions into failing tests

**Files:**
- Modify: `tests/test_historical_match_preview_ui.js`
- Modify: `tests/test_browser_security.py`

- [ ] **Step 1: Add failing DOM contracts**

Require one compact carousel position label, at most five non-interactive visual dots, a selected-match hero, the short matrix corner label `Heim ↓ · Gast →`, visible complementary guest percentages, and non-empty historical optimal-lineup names.

```js
assert.match(source, /match-preview-carousel__position/);
assert.match(source, /Math\.min\(5,/);
assert.match(source, /match-preview-hero/);
assert.match(source, /Heim ↓ · Gast →/);
assert.match(source, /match-preview-matrix__complement/);
```

- [ ] **Step 2: Add failing browser geometry checks**

At 390 and 320 CSS pixels assert that the first carousel card is narrower than 90% of the track, the next card intersects the track, controls stay one row, and the matrix corner does not overlap the first away header.

```python
assert first_card_box["width"] < track_box["width"] * 0.9
assert second_card_box["x"] < track_box["x"] + track_box["width"]
assert controls_box["height"] <= 52
assert corner_box["x"] + corner_box["width"] <= first_away_box["x"] + 1
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
node tests/test_historical_match_preview_ui.js
$env:BWEDL_BROWSER_TESTS='1'; python -m pytest tests/test_browser_security.py -q -p no:cacheprovider
```

Expected: failures for the missing compact controls/hero/complement and current mobile geometry.

### Task 2: Correct the carousel and selected-match presentation

**Files:**
- Modify: `bundle_v31.js`
- Modify: `style.css`
- Test: `tests/test_historical_match_preview_ui.js`
- Test: `tests/test_browser_security.py`

- [ ] **Step 1: Replace one-button-per-fixture dots with compact status navigation**

Keep previous/next buttons as 44px controls. Render `Partie X / N` plus a centered window of no more than five decorative dots with `aria-hidden="true"`; retain native swipe and keyboard browsing.

- [ ] **Step 2: Add the selected-match hero**

Render the chosen home team, `Heim`, a central `VS`, the away team, and `Gast` between carousel and lineup editor using text-only DOM APIs.

- [ ] **Step 3: Match approved card geometry**

Use 80-86% of the carousel track on narrow screens, reduce card height, keep a visible neighboring-card cue, and visually de-emphasize unselected cards without hiding their text.

- [ ] **Step 4: Run focused tests and verify GREEN**

```powershell
node tests/test_historical_match_preview_ui.js
$env:BWEDL_BROWSER_TESTS='1'; python -m pytest tests/test_browser_security.py -q -p no:cacheprovider
```

Expected: focused carousel and geometry contracts pass.

- [ ] **Step 5: Commit**

```powershell
git add -- bundle_v31.js style.css tests/test_historical_match_preview_ui.js tests/test_browser_security.py
git commit -m "fix: restore compact match preview carousel"
```

### Task 3: Correct the percentage matrix and historical optimal lineup

**Files:**
- Modify: `bundle_v31.js`
- Modify: `style.css`
- Test: `tests/test_historical_match_preview_ui.js`
- Test: `tests/test_reported_ui_regressions.js`

- [ ] **Step 1: Render the approved matrix vocabulary**

Use `Heim ↓ · Gast →` in the corner. Keep full semantic names, place player headers in bounded cells, and show `${awayPercent} % Gast` as a secondary visible value on wider layouts while retaining the home percentage as primary.

- [ ] **Step 2: Prevent header collisions**

Give the table a fixed readable layout inside its own scroll region, a bounded sticky first column, wrapping header text, and compact card-like cells matching the approved matrix.

- [ ] **Step 3: Make optimal lineup historical-rating aware**

Change eligibility from `p._cnt >= 1` to a finite positive adjusted `_avg`, so current and historical fallback players can populate the existing optimal-lineup panel.

```js
const eligible = allPlayers.filter((player) => Number.isFinite(player._avg) && player._avg > 0);
```

- [ ] **Step 4: Run focused tests and verify GREEN**

```powershell
node tests/test_historical_match_preview_ui.js
node tests/test_reported_ui_regressions.js
```

Expected: matrix, safe-text, historical fallback, and non-empty optimal-lineup contracts pass.

- [ ] **Step 5: Commit**

```powershell
git add -- bundle_v31.js style.css tests/test_historical_match_preview_ui.js tests/test_reported_ui_regressions.js
git commit -m "fix: align match preview analysis matrix"
```

### Task 4: Publish and verify the corrected static application

**Files:**
- Modify: `index.html`
- Modify: `sw_v31.js`
- Modify: exact asset-key tests under `tests/`

- [ ] **Step 1: Bump changed asset URLs and service-worker cache**

Publish the next exact `style.css`, `bundle_v31.js`, and cache keys without changing fetch strategy; keep `match_preview_model.js?v=2` unless its source changes.

- [ ] **Step 2: Run complete verification**

```powershell
node --check bundle_v31.js
node --check sw_v31.js
node tests/test_historical_match_preview_ui.js
node tests/test_reported_ui_regressions.js
node tests/test_accessibility_contract.js
node tests/test_dynamic_text_security.js
node tests/test_service_worker_status.js
python -m pytest tests -q --tb=no -p no:cacheprovider
$env:BWEDL_BROWSER_TESTS='1'; python -m pytest tests/test_browser_security.py -q -p no:cacheprovider
git diff --check
```

Expected: all commands exit 0; live-equivalent browser checks pass at desktop, 390px, and 320px.

- [ ] **Step 3: Commit**

```powershell
git add -- index.html sw_v31.js tests
git commit -m "chore: publish corrected match preview ui"
```

- [ ] **Step 4: Merge, push, and verify GitHub Pages**

Fast-forward `main`, push `origin/main`, wait for the Pages workflow, then verify HTTP 200 plus the exact new asset and cache keys on the public URL.
