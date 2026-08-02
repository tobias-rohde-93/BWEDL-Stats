# Mobile Navigation Overlay Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every application navigation closes both the mobile sidebar and its overlay so the rendered page remains clickable and the menu can be reopened.

**Architecture:** Keep the fix inside the existing vanilla-JavaScript bundle by introducing one closure-scoped `closeMobileNavigation()` helper beside the sidebar state. Route all existing close paths and `navigateTo()` through that helper. Add a Node regression test that executes the real helper extracted from the bundle and a pytest wrapper so the check runs in the existing CI suite.

**Tech Stack:** Vanilla JavaScript, Node.js built-in `assert`, Python 3.13, pytest, Playwright CLI for mobile browser QA

---

## Execution precondition

Use the approved design specification as the source of truth:

- `docs/superpowers/specs/2026-08-02-mobile-navigation-overlay-design.md`

The main checkout contains a user-owned modification to `.agent/rules/git-workflow.md`. Before implementation, invoke `superpowers:using-git-worktrees` and create an isolated `codex/mobile-navigation-overlay` worktree from commit `b4fe413`. Do not stash, stage, commit, overwrite, or otherwise modify the user-owned file.

## Planned file map

### Existing production file

- `bundle_v31.js:156-192,2029-2040` — define the single close helper and route overlay click, outside click, sidebar-item click, and application navigation through it.

### New test files

- `tests/test_mobile_navigation.js` — execute the exact helper declaration from the production bundle and enforce the navigation-state contract.
- `tests/test_mobile_navigation.py` — run the Node regression from pytest so GitHub Actions includes it automatically.

No scraper, data, archive, HTML, CSS, service-worker, or deployment file changes are required.

## Task 1: Add an executable regression for the broken mobile state

**Files:**
- Create: `tests/test_mobile_navigation.js`
- Create: `tests/test_mobile_navigation.py`

- [ ] **Step 1: Write the failing Node regression**

Create `tests/test_mobile_navigation.js`:

```javascript
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'bundle_v31.js'),
    'utf8'
);

function extractFunction(name) {
    const marker = `function ${name}(`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `${name} must exist in bundle_v31.js`);

    const openingBrace = source.indexOf('{', start);
    let depth = 0;
    for (let index = openingBrace; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    assert.fail(`${name} must have a complete function body`);
}

function classList(...initialClasses) {
    const classes = new Set(initialClasses);
    return {
        contains(name) { return classes.has(name); },
        remove(name) { classes.delete(name); }
    };
}

const sidebar = { classList: classList('sidebar', 'open') };
const mobileOverlay = { classList: classList('mobile-overlay', 'active') };
const closeSource = extractFunction('closeMobileNavigation');
const closeMobileNavigation = new Function(
    'sidebar',
    'mobileOverlay',
    `${closeSource}; return closeMobileNavigation;`
)(sidebar, mobileOverlay);

closeMobileNavigation();

assert.equal(sidebar.classList.contains('open'), false);
assert.equal(mobileOverlay.classList.contains('active'), false);

const navigateSource = extractFunction('navigateTo');
assert.match(navigateSource, /closeMobileNavigation\(\);/);
assert.doesNotMatch(navigateSource, /sidebar\.classList\.remove\('open'\)/);
assert.doesNotMatch(navigateSource, /mobileOverlay\.classList\.remove\('active'\)/);

assert.match(
    source,
    /mobileOverlay\.addEventListener\('click', closeMobileNavigation\)/
);
const closeCalls = source.match(/closeMobileNavigation\(\);/g) || [];
assert.equal(closeCalls.length, 3);
assert.match(source, /sidebar\.classList\.toggle\('open'\)/);
assert.match(source, /mobileOverlay\.classList\.toggle\('active'\)/);

console.log('mobile navigation close contract: ok');
```

- [ ] **Step 2: Add the pytest wrapper**

Create `tests/test_mobile_navigation.py`:

```python
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_mobile_navigation_close_contract_in_node() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "test_mobile_navigation.js")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
```

- [ ] **Step 3: Run the regression and verify that it fails for the known reason**

Run:

```powershell
python -m pytest tests/test_mobile_navigation.py -q
```

Expected: `1 failed`; Node reports `closeMobileNavigation must exist in bundle_v31.js`.

- [ ] **Step 4: Commit the failing regression**

```powershell
git add tests/test_mobile_navigation.js tests/test_mobile_navigation.py
git commit -m "test: cover mobile navigation overlay state"
```

## Task 2: Centralize mobile navigation closing

**Files:**
- Modify: `bundle_v31.js:156-192`
- Modify: `bundle_v31.js:2029-2040`

- [ ] **Step 1: Add the shared close helper**

Immediately after the existing `mobileOverlay` declaration, add:

```javascript
    function closeMobileNavigation() {
        if (sidebar) sidebar.classList.remove('open');
        if (mobileOverlay) mobileOverlay.classList.remove('active');
    }
```

- [ ] **Step 2: Route the three existing close handlers through the helper**

Make the overlay-click handler read:

```javascript
        if (mobileOverlay) {
            mobileOverlay.addEventListener('click', closeMobileNavigation);
        }
```

In the outside-click handler, replace its two direct `classList.remove(...)` statements with:

```javascript
                closeMobileNavigation();
```

In the sidebar link/clickable-item handler, replace its two direct `classList.remove(...)` statements with:

```javascript
                    closeMobileNavigation();
```

Keep the existing `window.innerWidth <= 768`, target, and containment conditions unchanged.

- [ ] **Step 3: Make every application navigation restore the closed state**

At the beginning of `navigateTo()`, before history handling, add:

```javascript
        closeMobileNavigation();
```

Delete the old partial close block completely:

```javascript
        const sidebar = document.querySelector('.sidebar');
        if (window.innerWidth <= 768 && sidebar && sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
        }
```

Renumber or simplify the nearby comments so they describe history, render, back-button visibility, and scrolling accurately. Do not change route rendering or history behavior.

- [ ] **Step 4: Run the focused regression and JavaScript syntax check**

Run:

```powershell
python -m pytest tests/test_mobile_navigation.py -q
node --check bundle_v31.js
```

Expected: `1 passed`; `mobile navigation close contract: ok` when the Node test is run directly; the syntax check exits `0`.

- [ ] **Step 5: Run the complete automated suite**

Run:

```powershell
python -m pytest -q
git diff --check
```

Expected: all tests pass (the baseline before this fix was `392 passed, 4 skipped`, so the new expected count is `393 passed, 4 skipped`); `git diff --check` reports no errors. The known `archive_tables_scraper.py` invalid-escape `SyntaxWarning` may still appear and is outside this fix.

- [ ] **Step 6: Commit the implementation**

```powershell
git add bundle_v31.js
git commit -m "fix: close mobile overlay on navigation"
```

## Task 3: Verify the real mobile journeys

**Files:**
- No file changes expected.

- [ ] **Step 1: Start the local static application**

Run `python server.py` from the isolated worktree and wait for:

```text
Server started at http://localhost:8000
```

If port `8000` is already occupied, identify the owning process before deciding whether it belongs to this task; do not terminate an unrelated process.

- [ ] **Step 2: Verify Dashboard to Head-to-Head at the mobile viewport**

Using Playwright CLI, open `http://127.0.0.1:8000/` at `390 x 844` and perform this exact journey:

1. Open the hamburger menu.
2. Click `H2H VERGLEICH`.
3. Confirm the title is `H2H Vergleich` and `#comparison-area` exists.
4. Evaluate that `.sidebar` does not contain `open` and `#mobile-overlay` does not contain `active`.
5. Click the hamburger again and confirm `.sidebar.open` and `#mobile-overlay.active` are both present.

Expected: H2H renders, the overlay does not intercept the page after navigation, and the menu reopens normally.

- [ ] **Step 3: Verify the profile and Match Preview journey**

Continue at `390 x 844`:

1. Open `Mein Profil` from the sidebar.
2. Use the existing player search to choose a public player and save the profile.
3. Return to the dashboard.
4. Click the `Match Preview Tool` teaser.
5. Confirm the page title is `Match Preview`.

Expected: profile controls and Match Preview are clickable; no invisible overlay blocks any step.

- [ ] **Step 4: Check layout and console evidence**

Evaluate:

```javascript
document.documentElement.scrollWidth <= document.documentElement.clientWidth
```

Expected: `true`. Review console output from both journeys; there must be no application error. A favicon request returning `404` is a known non-application issue and may be recorded separately.

- [ ] **Step 5: Stop and clean the QA session**

Close the Playwright session and stop only the local server process started in Step 1. Confirm that no Playwright artifact directory or unrelated workspace change remains.

- [ ] **Step 6: Record final repository evidence**

Run:

```powershell
git status --short
git log -3 --oneline
```

Expected: the feature worktree is clean and its latest commits are the regression and implementation commits. The user-owned `.agent/rules/git-workflow.md` modification remains only in the original main checkout and was never included in either commit.

## Completion criteria

- The exact production helper removes both mobile-navigation classes.
- All four close paths use the helper.
- `navigateTo()` contains no partial sidebar-only close logic.
- The focused regression, full pytest suite, and JavaScript syntax check pass.
- Both mobile browser journeys pass at `390 x 844` without horizontal overflow or application console errors.
- No data, scraper, archive, layout, service-worker, or deployment behavior changed.
