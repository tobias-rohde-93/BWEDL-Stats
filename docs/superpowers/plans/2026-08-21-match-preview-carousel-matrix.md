# Match Preview Carousel and Percentage Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vertical upcoming-game list with an accessible horizontal carousel and replace the 16 plain one-on-one rows with a responsive percentage strength matrix.

**Architecture:** Keep fixture discovery, guarded selector auto-fill, roster assembly, historical ratings, and team forecast unchanged. Add one pure defensive pair-strength helper to `match_preview_model.js`, then consume it from the existing Match Preview renderer. Use native DOM, semantic buttons and tables, CSS overflow/scroll snap, and the existing static GitHub Pages asset pipeline.

**Tech Stack:** Static HTML, vanilla JavaScript, CSS, Node assertion contracts, pytest wrappers, Playwright browser checks, GitHub Pages service worker.

---

## File structure

- Modify `match_preview_model.js`: own the pure two-player relative-strength calculation and uncertainty contract.
- Modify `bundle_v31.js`: render and control the fixture carousel, render the semantic percentage matrix, and keep guarded auto-fill feedback synchronized.
- Modify `style.css`: own carousel, matrix, responsive, focus, and reduced-motion presentation.
- Modify `tests/test_match_preview_model.js`: verify the pair-strength model before implementation.
- Modify `tests/test_historical_match_preview_ui.js`: verify carousel structure/interaction, matrix semantics, safe text, thresholds, and uncertainty.
- Modify `tests/test_browser_security.py`: verify real-browser containment and local scrolling at smartphone widths.
- Modify `tests/test_accessibility_contract.js`, `tests/test_reported_ui_regressions.js`, `tests/test_service_worker_status.js`, `tests/test_public_status.py`, and `tests/test_github_pages_runtime.py`: update exact static asset and cache contracts.
- Modify `index.html` and `sw_v31.js`: publish one compatible cache generation with new asset query keys.
- Modify `USER_GUIDE.md`: explain carousel selection and distinguish percentage strength from win probability.

## Execution preflight

- [ ] **Step 1: Read the isolation skill and create an isolated feature worktree**

Invoke `superpowers:using-git-worktrees`. Create branch `codex/match-preview-carousel-matrix` from the current plan commit. Do not copy or stage the unrelated `.agent/rules/git-workflow.md` modification from the main worktree.

- [ ] **Step 2: Confirm the isolated baseline**

Run:

```powershell
git status --short --branch
node tests/test_match_preview_model.js
node tests/test_historical_match_preview_ui.js
python -m pytest tests/test_match_preview_model.py tests/test_historical_match_preview_ui.py -q
```

Expected: clean feature worktree; both Node contracts print their `ok` message; pytest reports `2 passed`.

---

### Task 1: Pure pair-strength percentage model

**Files:**
- Modify: `tests/test_match_preview_model.js` after the four-player lineup assertions
- Modify: `match_preview_model.js` immediately before `lineupSummary`

- [ ] **Step 1: Write the failing pair-strength tests**

Add:

```javascript
const supportedHome = {
    adjustedRating: 9,
    rating: 2,
    evidence: 'current+history',
    confidence: 'medium',
};
const supportedAway = {
    adjustedRating: 6,
    rating: 40,
    evidence: 'historical',
    confidence: 'provisional',
};
assert.deepEqual(Model.comparePairStrength(supportedHome, supportedAway), {
    homeShare: 0.6,
    awayShare: 0.4,
    homePercent: 60,
    awayPercent: 40,
    uncertain: false,
});
assert.deepEqual(Model.comparePairStrength(
    { ...supportedHome, adjustedRating: 5 },
    { ...supportedAway, adjustedRating: 5 },
), {
    homeShare: 0.5,
    awayShare: 0.5,
    homePercent: 50,
    awayPercent: 50,
    uncertain: false,
});
for (const uncertainSlot of [
    { ...supportedHome, confidence: 'very-low' },
    { ...supportedHome, evidence: 'neutral' },
    { ...supportedHome, evidence: 'historical-fallback' },
    { ...supportedHome, rosterUnconfirmed: true },
]) {
    const comparison = Model.comparePairStrength(uncertainSlot, supportedAway);
    assert.equal(comparison.uncertain, true);
    assert.equal(comparison.homePercent + comparison.awayPercent, 100);
}
for (const invalidSlot of [
    null,
    {},
    { adjustedRating: 0, rating: 0 },
    { adjustedRating: Infinity, rating: Infinity },
    { adjustedRating: Number.MAX_SAFE_INTEGER, rating: Number.MAX_SAFE_INTEGER },
]) {
    assert.deepEqual(Model.comparePairStrength(invalidSlot, supportedAway), {
        homeShare: 0.5,
        awayShare: 0.5,
        homePercent: 50,
        awayPercent: 50,
        uncertain: true,
    });
}
const frozenComparison = Model.comparePairStrength(supportedHome, supportedAway);
assert.equal(Object.isFrozen(frozenComparison), true);
frozenComparison.homePercent = 1;
assert.equal(frozenComparison.homePercent, 60);
```

- [ ] **Step 2: Run the model test and verify RED**

Run:

```powershell
node tests/test_match_preview_model.js
```

Expected: FAIL with `TypeError: Model.comparePairStrength is not a function`.

- [ ] **Step 3: Implement the minimal pure helper**

Add before `lineupSummary`:

```javascript
function pairSlotSummary(slot) {
    const adjusted = safePositiveModelRating(ownValue(slot, 'adjustedRating'));
    const raw = safePositiveModelRating(ownValue(slot, 'rating'));
    const rating = adjusted === null ? raw : adjusted;
    if (rating === null) return null;
    const confidenceValue = ownValue(slot, 'confidence');
    const confidence = CONFIDENCE_ORDER.includes(confidenceValue)
        ? confidenceValue
        : 'very-low';
    const evidenceValue = ownValue(slot, 'evidence');
    const evidence = Object.prototype.hasOwnProperty.call(EVIDENCE_ORDER, evidenceValue)
        ? evidenceValue
        : 'neutral';
    return {
        rating,
        uncertain: confidence === 'very-low'
            || evidence === 'neutral'
            || evidence === 'historical-fallback'
            || ownValue(slot, 'rosterUnconfirmed') === true,
    };
}

function comparePairStrength(homeSlot, awaySlot) {
    const home = pairSlotSummary(homeSlot);
    const away = pairSlotSummary(awaySlot);
    if (!home || !away) {
        return deepFreeze({
            homeShare: 0.5,
            awayShare: 0.5,
            homePercent: 50,
            awayPercent: 50,
            uncertain: true,
        });
    }
    const total = home.rating + away.rating;
    if (!Number.isFinite(total) || total <= 0) {
        return deepFreeze({
            homeShare: 0.5,
            awayShare: 0.5,
            homePercent: 50,
            awayPercent: 50,
            uncertain: true,
        });
    }
    const homeShare = home.rating / total;
    const awayShare = 1 - homeShare;
    const homePercent = Math.round(homeShare * 100);
    return deepFreeze({
        homeShare,
        awayShare,
        homePercent,
        awayPercent: 100 - homePercent,
        uncertain: home.uncertain || away.uncertain,
    });
}
```

Add `comparePairStrength` to the returned public API immediately before `forecastMatch`.

- [ ] **Step 4: Run focused model verification and verify GREEN**

Run:

```powershell
node tests/test_match_preview_model.js
python -m pytest tests/test_match_preview_model.py -q
```

Expected: Node prints `historical match preview model: ok`; pytest reports `1 passed`.

- [ ] **Step 5: Commit the pure model change**

```powershell
git add match_preview_model.js tests/test_match_preview_model.js
git commit -m "feat: add pair strength comparison model"
```

---

### Task 2: Accessible upcoming-game carousel

**Files:**
- Modify: `tests/test_historical_match_preview_ui.js` DOM harness and detected-match scenarios
- Modify: `bundle_v31.js:7421-7478` guarded status feedback
- Modify: `bundle_v31.js:7506-7535` required model API
- Modify: `bundle_v31.js:7697-7757` upcoming-game renderer

- [ ] **Step 1: Extend the DOM harness without changing production code**

In the test `Element` constructor and methods, add:

```javascript
this.scrollIntoViewCalls = [];
this.focusCalls = 0;
this.tabIndex = -1;
```

Replace the existing `scrollIntoView` method and add `focus`:

```javascript
scrollIntoView(options) {
    const safeOptions = options || {};
    this.scrollIntoViewCalls.push(safeOptions);
    this.ownerDocument.scrollCalls.push(safeOptions);
}
focus() { this.focusCalls += 1; }
```

Add the model stub method:

```javascript
comparePairStrength(home, away) {
    const homeRating = Number(home.adjustedRating || home.rating);
    const awayRating = Number(away.adjustedRating || away.rating);
    const homeShare = homeRating / (homeRating + awayRating);
    const homePercent = Math.round(homeShare * 100);
    return {
        homeShare,
        awayShare: 1 - homeShare,
        homePercent,
        awayPercent: 100 - homePercent,
        uncertain: home.confidence === 'very-low'
            || away.confidence === 'very-low'
            || home.evidence === 'neutral'
            || away.evidence === 'neutral'
            || home.evidence === 'historical-fallback'
            || away.evidence === 'historical-fallback'
            || home.rosterUnconfirmed === true
            || away.rosterUnconfirmed === true,
    };
},
```

Update both validated-method lists in the test to include `comparePairStrength`.

- [ ] **Step 2: Replace the old vertical-card assertions with failing carousel assertions**

For the two-game scenario, assert:

```javascript
const carousel = scenario.contentArea.querySelector('.match-preview-carousel');
const track = scenario.contentArea.querySelector('.match-preview-carousel__track');
const cards = scenario.contentArea.querySelectorAll('.match-preview-card');
const cardButtons = scenario.contentArea.querySelectorAll('.match-preview-card__select');
assert.ok(carousel);
assert.ok(track);
assert.equal(cards.length, 2);
assert.equal(cardButtons.length, 2);
assert.equal(cardButtons.every((button) => button.tagName === 'BUTTON'), true);
assert.equal(cardButtons.every((button) => button.type === 'button'), true);
assert.equal(cardButtons.every((button) => button.attributes['aria-pressed'] === 'false'), true);
assert.equal(scenario.contentArea.querySelectorAll('.match-preview-carousel__arrow').length, 2);
assert.equal(scenario.contentArea.querySelectorAll('.match-preview-carousel__dot').length, 2);
assert.equal(cardButtons[0].textContent.includes('<svg onload='), false);
assert.equal(scenario.contentArea.querySelectorAll('SVG').length, 0);

cardButtons[1].dispatchEvent({ type: 'click' });
assert.equal(cardButtons[0].attributes['aria-pressed'], 'false');
assert.equal(cardButtons[1].attributes['aria-pressed'], 'true');
assert.match(cards[1].querySelector('.match-preview-card__status').textContent, /Ausgewählt/);
```

Add separate scenarios:

```javascript
const empty = renderScenario(true, extractFunction('renderMatchPreview'), {
    detectedMatches: [],
    skipManualSelection: true,
});
assert.equal(empty.contentArea.querySelector('.match-preview-carousel'), null);
assert.ok(empty.contentArea.querySelector('#match-preview-league'));

const single = renderScenario(true, extractFunction('renderMatchPreview'), {
    detectedMatch: { league: 'B-Klasse 2026-2027', home: 'Alpha', away: 'Bravo' },
    skipManualSelection: true,
});
assert.equal(single.contentArea.querySelectorAll('.match-preview-card').length, 1);
assert.equal(single.contentArea.querySelectorAll('.match-preview-carousel__arrow').length, 0);
assert.equal(single.contentArea.querySelectorAll('.match-preview-carousel__dot').length, 0);
```

- [ ] **Step 3: Run the UI contract and verify RED**

Run:

```powershell
node tests/test_historical_match_preview_ui.js
```

Expected: FAIL because `.match-preview-carousel` and semantic card buttons do not exist.

- [ ] **Step 4: Implement reusable card state inside `renderMatchPreview`**

Add after `markManualInteraction`:

```javascript
const setMatchCardState = (card, state) => {
    if (!card) return;
    const button = card.querySelector('.match-preview-card__select');
    const status = card.querySelector('.match-preview-card__status');
    card.dataset.state = state;
    if (button) button.setAttribute('aria-pressed', String(state === 'selected'));
    if (status) {
        status.textContent = state === 'selected'
            ? 'Ausgewählt'
            : (state === 'incomplete' ? 'Auswahl unvollständig' : 'Partie auswählen');
    }
};
```

Change `resetMatchCardStatus` to call `setMatchCardState(card, 'idle')` and clear only legacy inline border/shadow values.

Pass this callback to both `applyMatchSelectorAutoFill` calls:

```javascript
setBannerState: (state) => setMatchCardState(matchCard, state),
```

and for the initial selection:

```javascript
setBannerState: (state) => setMatchCardState(initialMatchAutoFill.banner, state),
```

In `applyMatchSelectorAutoFill`, define:

```javascript
const setBannerState = typeof elements.setBannerState === 'function'
    ? elements.setBannerState
    : null;
```

Call `setBannerState('incomplete')` in the incomplete branch and `setBannerState('selected')` in the success branch. Retain the existing `.load-btn` fallback feedback when the callback is absent so standalone regression harnesses remain compatible.

- [ ] **Step 5: Implement the semantic carousel renderer**

Replace the detected-match list construction with a `section.match-preview-next-games.match-preview-carousel`, a `div.match-preview-carousel__track`, semantic card buttons, bounded arrows, and dots. Use this exact card structure for each match:

```javascript
const matchCard = document.createElement('article');
matchCard.className = 'match-preview-card';
matchCard.dataset.state = 'idle';

const cardButton = document.createElement('button');
cardButton.type = 'button';
cardButton.className = 'match-preview-card__select load-btn';
cardButton.setAttribute('aria-pressed', 'false');
cardButton.setAttribute('aria-label', `${match.home || 'Heim'} gegen ${match.away || 'Gast'} auswählen`);
appendText(cardButton, 'span', match.league || '', 'match-preview-card__league');
const teams = document.createElement('span');
teams.className = 'match-preview-card__teams';
appendText(teams, 'strong', match.home || 'Heim');
appendText(teams, 'span', 'VS', 'match-preview-card__versus');
appendText(teams, 'strong', match.away || 'Gast');
cardButton.appendChild(teams);
appendText(cardButton, 'span', match.dateStr || 'Termin offen', 'match-preview-card__date');
appendText(cardButton, 'span', 'Partie auswählen', 'match-preview-card__status');
matchCard.appendChild(cardButton);
track.appendChild(matchCard);
```

Keep the current generation-guarded click body on `cardButton`. After a successful selection, center the card:

```javascript
matchCard.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'nearest',
    inline: 'center',
});
```

Create previous/next buttons only when `matches.length > 1`. Their click handlers clamp the browse index between `0` and `matches.length - 1`, focus/center that card, update disabled states, and set `aria-current="true"` on the corresponding dot. Handle `ArrowLeft` and `ArrowRight` on the carousel section through the same bounded browse function and call `preventDefault()` only for those two keys.

- [ ] **Step 6: Update old auto-fill assertions and verify GREEN**

Replace `.querySelector('.load-btn')` status assertions in `tests/test_historical_match_preview_ui.js` with `.querySelector('.match-preview-card__status')`, while continuing to dispatch clicks on `.match-preview-card__select`. Preserve every delayed-timer, rerender, manual-interaction, unresolved-team, and same-team assertion.

Run:

```powershell
node tests/test_historical_match_preview_ui.js
node tests/test_reported_ui_regressions.js
python -m pytest tests/test_historical_match_preview_ui.py tests/test_reported_ui_regressions.py -q
```

Expected: both Node contracts pass; pytest focused wrappers pass.

- [ ] **Step 7: Commit the carousel behavior**

```powershell
git add bundle_v31.js tests/test_historical_match_preview_ui.js
git commit -m "feat: add match preview fixture carousel"
```

---

### Task 3: Semantic 4x4 percentage matrix

**Files:**
- Modify: `tests/test_historical_match_preview_ui.js` forecast assertions
- Modify: `bundle_v31.js:7506-7535` required model API
- Modify: `bundle_v31.js:7978-8046` form and pairings rendering

- [ ] **Step 1: Write failing matrix DOM tests**

After clicking `.match-preview-calculate`, replace the old `16` paragraph assertion with:

```javascript
const matrix = scenario.contentArea.querySelector('.match-preview-matrix');
assert.ok(matrix);
assert.equal(matrix.tagName, 'TABLE');
assert.equal(matrix.querySelectorAll('THEAD').length, 1);
assert.equal(matrix.querySelectorAll('TBODY').length, 1);
assert.equal(matrix.querySelectorAll('TH[scope="col"]').length, 4);
assert.equal(matrix.querySelectorAll('TH[scope="row"]').length, 4);
const cells = matrix.querySelectorAll('.match-preview-matrix__cell');
assert.equal(cells.length, 16);
assert.equal(cells.every((cell) => /^\d{1,3} %$/.test(cell.textContent.trim())), true);
assert.equal(cells.every((cell) => {
    const match = cell.attributes['aria-label'].match(/(\d+)%.*?(\d+)%/);
    return match && Number(match[1]) + Number(match[2]) === 100;
}), true);
assert.equal(matrix.querySelectorAll('.match-preview-matrix__cell--home').length > 0, true);
assert.equal(matrix.querySelectorAll('.match-preview-matrix__cell--balanced').length > 0, true);
assert.equal(matrix.querySelectorAll('.match-preview-matrix__uncertain').length > 0, true);
assert.match(matrix.textContent, /Stärkevergleich/);
assert.doesNotMatch(matrix.textContent, /Siegchance|Gewinnwahrscheinlichkeit/);
assert.equal(scenario.contentArea.querySelectorAll('.match-preview-pairing').length, 0);
```

Add direct band-boundary assertions by configuring the model stub to return `55`, `54`, `46`, and `45` for the first four calls, then verify the corresponding class names are home, balanced, balanced, and away.

- [ ] **Step 2: Run the UI contract and verify RED**

Run:

```powershell
node tests/test_historical_match_preview_ui.js
```

Expected: FAIL because `.match-preview-matrix` does not exist and plain pairing paragraphs still render.

- [ ] **Step 3: Require the validated pair-strength API**

Add `'comparePairStrength'` to `requiredModelMethods` in `renderMatchPreview`. Update the test model wrapper list to expose the same method so the validated model remains getter-safe and bound to its original receiver.

- [ ] **Step 4: Implement the semantic matrix renderer**

Inside `renderFormAndPairings`, replace the plain pairing section with a panel containing a scroll region and table. Build the elements with DOM methods:

```javascript
const pairings = document.createElement('section');
pairings.className = 'match-preview-panel match-preview-pairings';
appendText(pairings, 'h2', '1v1-Analyse');
appendText(
    pairings,
    'p',
    'Stärkevergleich zugunsten des Heimspielers – keine Einzelspiel-Siegwahrscheinlichkeit.',
    'match-preview-matrix__explanation',
);

const legend = document.createElement('div');
legend.className = 'match-preview-matrix__legend';
for (const [className, label] of [
    ['home', '55–100 % Vorteil Heim'],
    ['balanced', '46–54 % ausgeglichen'],
    ['away', '0–45 % Vorteil Gast'],
]) {
    const item = appendText(legend, 'span', label);
    item.dataset.band = className;
}
pairings.appendChild(legend);

const scroller = document.createElement('div');
scroller.className = 'match-preview-matrix-scroll';
scroller.tabIndex = 0;
scroller.setAttribute('aria-label', '1v1-Stärkevergleich, seitlich scrollbar');
const table = document.createElement('table');
table.className = 'match-preview-matrix';
const caption = appendText(table, 'caption', `${nameA} gegen ${nameB}: 1v1-Stärkevergleich`);
caption.className = 'visually-hidden';

const head = document.createElement('thead');
const headRow = document.createElement('tr');
appendText(headRow, 'th', 'Heim ↓ · Gast →', 'match-preview-matrix__corner');
lineupB.forEach((awayPlayer) => {
    const columnHeader = appendText(headRow, 'th', awayPlayer.name);
    columnHeader.setAttribute('scope', 'col');
});
head.appendChild(headRow);
table.appendChild(head);

const body = document.createElement('tbody');
lineupA.forEach((homePlayer) => {
    const row = document.createElement('tr');
    const rowHeader = appendText(row, 'th', homePlayer.name);
    rowHeader.setAttribute('scope', 'row');
    lineupB.forEach((awayPlayer) => {
        const comparison = previewModelApi.comparePairStrength(homePlayer, awayPlayer);
        const percent = Number(comparison.homePercent);
        const band = percent >= 55 ? 'home' : (percent <= 45 ? 'away' : 'balanced');
        const cell = appendText(row, 'td', `${percent} %`, `match-preview-matrix__cell match-preview-matrix__cell--${band}`);
        const state = band === 'home' ? 'Vorteil Heim' : (band === 'away' ? 'Vorteil Gast' : 'ausgeglichen');
        cell.setAttribute(
            'aria-label',
            `${homePlayer.name} gegen ${awayPlayer.name}: ${percent}% Heim, ${comparison.awayPercent}% Gast, ${state}${comparison.uncertain ? ', unsichere Datenbasis' : ''}`,
        );
        if (comparison.uncertain) {
            const marker = appendText(cell, 'span', '?', 'match-preview-matrix__uncertain');
            marker.setAttribute('aria-hidden', 'true');
        }
    });
    body.appendChild(row);
});
table.appendChild(body);
scroller.appendChild(table);
pairings.appendChild(scroller);
parent.appendChild(pairings);
```

Keep form curves before the matrix and optimal-lineup rendering after it.

- [ ] **Step 5: Run focused UI, security, and model verification**

Run:

```powershell
node tests/test_match_preview_model.js
node tests/test_historical_match_preview_ui.js
node tests/test_dynamic_text_security.js
python -m pytest tests/test_match_preview_model.py tests/test_historical_match_preview_ui.py tests/test_dynamic_text_security.py -q
```

Expected: all Node contracts pass; focused pytest reports all selected tests passed.

- [ ] **Step 6: Commit the matrix behavior**

```powershell
git add bundle_v31.js tests/test_historical_match_preview_ui.js
git commit -m "feat: add match preview percentage matrix"
```

---

### Task 4: Responsive visual system and real-browser containment

**Files:**
- Modify: `tests/test_historical_match_preview_ui.js` CSS contracts
- Modify: `tests/test_browser_security.py` Match Preview browser scenario
- Modify: `style.css:1429-1825` Match Preview styles

- [ ] **Step 1: Add failing CSS contract assertions**

Add:

```javascript
for (const selector of [
    '.match-preview-carousel',
    '.match-preview-carousel__track',
    '.match-preview-card__select',
    '.match-preview-carousel__arrow',
    '.match-preview-matrix-scroll',
    '.match-preview-matrix',
    '.match-preview-matrix__cell',
]) {
    assert.match(styles, new RegExp(selector.replace('.', '\\.') + '\\s*\\{'));
}
assert.match(styles, /\.match-preview-carousel__track\s*\{[^}]*overflow-x:\s*auto[^}]*scroll-snap-type:\s*x\s+mandatory/s);
assert.match(styles, /\.match-preview-card\s*\{[^}]*scroll-snap-align:\s*center/s);
assert.match(styles, /\.match-preview-matrix-scroll\s*\{[^}]*overflow-x:\s*auto/s);
assert.match(styles, /\.match-preview-matrix\s*\{[^}]*min-width:\s*22\.5rem/s);
assert.match(styles, /\.match-preview-card__select:focus-visible/);
assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.match-preview-carousel__track/);
```

- [ ] **Step 2: Add failing real-browser assertions**

After calculating the preview in `tests/test_browser_security.py`, assert:

```python
expect(page.locator(".match-preview-matrix")).to_be_visible()
expect(page.locator(".match-preview-matrix__cell")).to_have_count(16)
assert page.locator(".match-preview-matrix__cell").evaluate_all(
    "cells => cells.every(cell => /^\\d{1,3} %$/.test(cell.childNodes[0].textContent.trim()))"
)
```

At 320 pixels:

```python
matrix_scroller = page.locator(".match-preview-matrix-scroll")
assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
assert matrix_scroller.evaluate("element => element.scrollWidth >= element.clientWidth")
matrix_scroller.evaluate("element => { element.scrollLeft = 80; }")
assert matrix_scroller.evaluate("element => element.scrollLeft > 0")
assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
```

When a remembered fixture is injected for the scenario, assert the carousel track has local horizontal overflow and its next button changes the target card's `scrollIntoView` position without changing document width.

- [ ] **Step 3: Run the focused contracts and verify RED**

Run:

```powershell
node tests/test_historical_match_preview_ui.js
python -m pytest tests/test_browser_security.py -q
```

Expected: Node fails on missing carousel/matrix CSS. Browser test is skipped unless `BWEDL_BROWSER_TESTS=1`; with the browser gate enabled it fails on missing responsive behavior.

- [ ] **Step 4: Implement the approved carousel styles**

Replace the vertical `.match-preview-next-games` and old card/load-button rules with native carousel styles that include:

```css
.match-preview-carousel {
    min-width: 0;
    margin-bottom: 1rem;
}

.match-preview-carousel__track {
    display: flex;
    gap: 0.75rem;
    min-width: 0;
    padding: 0.35rem max(0.75rem, 8%) 0.8rem;
    margin-inline: -0.75rem;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    scroll-behavior: smooth;
    scroll-snap-type: x mandatory;
    scrollbar-width: thin;
}

.match-preview-card {
    min-width: 0;
    flex: 0 0 clamp(16rem, 42%, 23rem);
    scroll-snap-align: center;
    border: 1px solid #334155;
    border-radius: var(--radius-md);
    background: linear-gradient(145deg, rgba(30, 41, 59, 0.98), rgba(15, 23, 42, 0.98));
    box-shadow: var(--shadow-sm);
}

.match-preview-card[data-state="selected"] {
    border-color: #38bdf8;
    box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.35), 0 0.8rem 2rem rgba(14, 165, 233, 0.14);
}

.match-preview-card__select {
    display: grid;
    width: 100%;
    min-height: 8.5rem;
    gap: 0.45rem;
    padding: 1rem;
    border: 0;
    border-radius: inherit;
    color: #e2e8f0;
    background: transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.match-preview-card__select:focus-visible,
.match-preview-carousel__arrow:focus-visible,
.match-preview-matrix-scroll:focus-visible {
    outline: 3px solid rgba(56, 189, 248, 0.72);
    outline-offset: 3px;
}
```

Add bounded team, date, status, arrow, dots, selected badge, hover, and disabled styles consistent with the approved mockup. At `max-width: 640px`, set cards to `flex-basis: min(86%, 19rem)` so one selected card and a neighboring cue remain visible.

- [ ] **Step 5: Implement the approved matrix styles**

Add:

```css
.match-preview-matrix-scroll {
    width: 100%;
    min-width: 0;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    scrollbar-width: thin;
}

.match-preview-matrix {
    width: 100%;
    min-width: 22.5rem;
    border-collapse: separate;
    border-spacing: 0.3rem;
    table-layout: fixed;
}

.match-preview-matrix th,
.match-preview-matrix__cell {
    min-width: 0;
    padding: 0.65rem 0.4rem;
    border-radius: 0.5rem;
    overflow-wrap: anywhere;
    text-align: center;
}

.match-preview-matrix tbody th {
    position: sticky;
    left: 0;
    z-index: 1;
    color: #bfdbfe;
    background: #111c2d;
    text-align: left;
}

.match-preview-matrix__cell {
    position: relative;
    color: #f8fafc;
    font-variant-numeric: tabular-nums;
    font-weight: 800;
}

.match-preview-matrix__cell--home { background: #14532d; }
.match-preview-matrix__cell--balanced { background: #713f12; }
.match-preview-matrix__cell--away { background: #7f1d1d; }
```

Add non-color legend swatches, a top-right `?` marker, narrow-screen padding reductions, and reduced-motion overrides for carousel scrolling and card transforms.

- [ ] **Step 6: Run focused Node and browser verification and verify GREEN**

Run:

```powershell
node tests/test_historical_match_preview_ui.js
python -m pytest tests/test_historical_match_preview_ui.py -q
$env:BWEDL_BROWSER_TESTS = '1'
python -m pytest tests/test_browser_security.py -q
Remove-Item Env:BWEDL_BROWSER_TESTS
```

Expected: Node and wrapper pass. Browser test passes at its tested desktop, 480, 390, and 320 pixel viewports with no document overflow.

- [ ] **Step 7: Commit the responsive presentation**

```powershell
git add style.css tests/test_historical_match_preview_ui.js tests/test_browser_security.py
git commit -m "style: polish match preview carousel matrix"
```

---

### Task 5: Static publication compatibility and user guidance

**Files:**
- Modify: `tests/test_accessibility_contract.js`
- Modify: `tests/test_reported_ui_regressions.js`
- Modify: `tests/test_service_worker_status.js`
- Modify: `tests/test_public_status.py`
- Modify: `tests/test_github_pages_runtime.py`
- Modify: `index.html`
- Modify: `sw_v31.js`
- Modify: `USER_GUIDE.md:129-152`

- [ ] **Step 1: Update exact release-contract expectations first**

Change test expectations to:

```text
style.css?v=9
match_preview_model.js?v=2
bundle_v31.js?v=4.0
bwedl-dashboard-v43
```

Keep every unchanged asset key exactly as published today. Add documentation assertions for `horizontal`, `Stärkevergleich`, `keine Sieg-Wahrscheinlichkeit`, and `unsichere Datenbasis`.

- [ ] **Step 2: Run release contracts and verify RED**

Run:

```powershell
node tests/test_accessibility_contract.js
node tests/test_reported_ui_regressions.js
node tests/test_service_worker_status.js
python -m pytest tests/test_public_status.py tests/test_github_pages_runtime.py -q
```

Expected: FAIL because `index.html`, `sw_v31.js`, and the guide still expose the previous keys and terminology.

- [ ] **Step 3: Publish one compatible static shell generation**

In `index.html`, change only:

```html
<link rel="stylesheet" href="style.css?v=9">
<script src="match_preview_model.js?v=2"></script>
<script src="bundle_v31.js?v=4.0"></script>
```

In `sw_v31.js`, change the cache name to `bwedl-dashboard-v43` and use the exact same three query keys in `urlsToCache`.

- [ ] **Step 4: Update the Match Preview guide**

Add a concise subsection explaining:

```markdown
### Spielauswahl und 1v1-Stärkevergleich

Erkannte nächste Spiele stehen oben in einem horizontalen Karussell. Wische auf dem Smartphone seitlich oder verwende die Pfeile und wähle die gewünschte Spielkarte aus. Die Auswahl übernimmt Liga, Heimteam und Gastteam; die Aufstellung kann danach weiterhin manuell geändert werden.

Die 1v1-Matrix vergleicht jeden der vier Heimspieler mit jedem der vier Gastspieler. Der sichtbare Prozentwert ist der relative Stärkeanteil des Heimspielers aus den bereits klassenbereinigten aktuellen und historischen Leistungswerten. Er ist keine einzelne Sieg-Wahrscheinlichkeit. Grün bedeutet Vorteil Heim, Gelb einen weitgehend ausgeglichenen Vergleich und Rot Vorteil Gast. Ein `?` kennzeichnet eine unsichere Datenbasis, etwa einen neutral ergänzten oder unbestätigten Spieler.
```

- [ ] **Step 5: Run release contracts and verify GREEN**

Run:

```powershell
node tests/test_accessibility_contract.js
node tests/test_reported_ui_regressions.js
node tests/test_service_worker_status.js
python -m pytest tests/test_public_status.py tests/test_github_pages_runtime.py -q
```

Expected: all selected JavaScript and Python release contracts pass.

- [ ] **Step 6: Commit the compatible publication shell**

```powershell
git add index.html sw_v31.js USER_GUIDE.md tests/test_accessibility_contract.js tests/test_reported_ui_regressions.js tests/test_service_worker_status.js tests/test_public_status.py tests/test_github_pages_runtime.py
git commit -m "chore: publish match preview ui assets"
```

---

### Task 6: Final verification and handoff

**Files:**
- Verify only; modify production files only if a failing test exposes a real defect and repeat RED/GREEN for that defect.

- [ ] **Step 1: Run syntax and focused JavaScript contracts**

```powershell
node --check match_preview_model.js
node --check bundle_v31.js
node --check sw_v31.js
node tests/test_match_preview_model.js
node tests/test_historical_match_preview_ui.js
node tests/test_reported_ui_regressions.js
node tests/test_accessibility_contract.js
node tests/test_dynamic_text_security.js
node tests/test_service_worker_status.js
```

Expected: syntax checks exit `0`; every contract prints its success message.

- [ ] **Step 2: Run the complete repository suite**

```powershell
python -m pytest tests -q
```

Expected: all non-environment-gated tests pass; only explicitly gated browser tests may skip.

- [ ] **Step 3: Run the opt-in browser suite**

```powershell
$env:BWEDL_BROWSER_TESTS = '1'
python -m pytest tests/test_browser_security.py -q
Remove-Item Env:BWEDL_BROWSER_TESTS
```

Expected: Playwright browser test passes. If the known Windows restricted-process `EPERM` condition occurs, rerun the identical command in the permitted process context before diagnosing code.

- [ ] **Step 4: Validate patch hygiene and scope**

```powershell
git diff --check origin/main...HEAD
git status --short --branch
git log --oneline --decorate origin/main..HEAD
```

Expected: no whitespace errors; only the planned Match Preview, test, guide, and cache files changed; the feature branch contains the design/plan commits plus bounded implementation commits.

- [ ] **Step 5: Inspect the final responsive UI**

Open the static app through the existing test server at `#matchPreview`. Verify at 320, 390, 768, and desktop widths:

- carousel cards browse locally and select the correct fixture;
- the selected badge and focus ring are clear;
- manual lineup changes still work;
- the matrix contains 16 readable values and local horizontal scrolling when required;
- green/amber/red bands and `?` markers match their accessible text;
- the document itself never overflows horizontally;
- reduced-motion mode removes smooth movement.

- [ ] **Step 6: Apply the completion workflow**

Invoke `superpowers:verification-before-completion`, then `superpowers:finishing-a-development-branch`. Report the exact test totals and commit hashes. Do not merge, push, or deploy until the user chooses and authorizes that action.
