# Profile History Navigation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make profile save and delete replace the active profile route with a fully synchronized dashboard route.

**Architecture:** Keep the existing profile persistence code and general navigation API unchanged. After updating profile state, replace the current browser history entry with dashboard state and delegate rendering to `navigateTo('dashboard', null, false)`. A focused Node contract executes the real `setMyPlayer` arrow function with controlled dependencies, and a pytest wrapper includes it in CI.

**Tech Stack:** Vanilla JavaScript, Node.js built-in `assert`, Python 3.13, pytest, Playwright CLI for mobile browser QA

---

## Execution precondition

Use the approved design specification as the source of truth:

- `docs/superpowers/specs/2026-08-02-profile-history-navigation-design.md`

The main checkout contains a user-owned modification to `.agent/rules/git-workflow.md`. Before implementation, invoke `superpowers:using-git-worktrees` and create an isolated `codex/profile-history-navigation` worktree from commit `9595ef4`. Do not stash, stage, commit, overwrite, or otherwise modify the user-owned file. Do not push.

## Planned file map

### Existing production file

- `bundle_v31.js:139-154` — replace the direct dashboard render after profile persistence with synchronized history replacement and central navigation.

### New test files

- `tests/test_profile_history.js` — extract and execute the exact production `setMyPlayer` function and verify save/delete persistence plus dashboard history/navigation.
- `tests/test_profile_history.py` — run the Node contract through the existing pytest and GitHub Actions suite.

No scraper, data, archive, HTML, CSS, service-worker, startup deep-link, or deployment files change.

## Task 1: Add a failing profile-history regression

**Files:**
- Create: `tests/test_profile_history.js`
- Create: `tests/test_profile_history.py`

- [ ] **Step 1: Write the executable Node contract**

Create `tests/test_profile_history.js`:

```javascript
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'bundle_v31.js'),
    'utf8',
);

function findClosingBrace(openingBrace, label) {
    let depth = 0;
    let state = 'code';

    for (let index = openingBrace; index < source.length; index += 1) {
        const character = source[index];
        const nextCharacter = source[index + 1];

        if (state === 'line-comment') {
            if (character === '\n') state = 'code';
            continue;
        }
        if (state === 'block-comment') {
            if (character === '*' && nextCharacter === '/') {
                state = 'code';
                index += 1;
            }
            continue;
        }
        if (state !== 'code') {
            if (character === '\\') {
                index += 1;
            } else if (
                (state === 'single-quote' && character === "'") ||
                (state === 'double-quote' && character === '"') ||
                (state === 'template' && character === '`')
            ) {
                state = 'code';
            }
            continue;
        }

        if (character === '/' && nextCharacter === '/') {
            state = 'line-comment';
            index += 1;
        } else if (character === '/' && nextCharacter === '*') {
            state = 'block-comment';
            index += 1;
        } else if (character === "'") {
            state = 'single-quote';
        } else if (character === '"') {
            state = 'double-quote';
        } else if (character === '`') {
            state = 'template';
        } else if (character === '{') {
            depth += 1;
        } else if (character === '}') {
            depth -= 1;
            if (depth === 0) return index;
        }
    }

    assert.fail(`Expected ${label} to have a complete body`);
}

function extractAssignedArrow(name) {
    const declarationStart = source.indexOf(`const ${name} =`);
    assert.notEqual(declarationStart, -1, `Expected const ${name} to exist`);
    const assignment = source.indexOf('=', declarationStart);
    const arrow = source.indexOf('=>', assignment);
    const openingBrace = source.indexOf('{', arrow);
    const closingBrace = findClosingBrace(openingBrace, name);
    return source.slice(assignment + 1, closingBrace + 1).trim();
}

const setMyPlayerSource = extractAssignedArrow('setMyPlayer');

function createHarness(initialName) {
    const storageCalls = [];
    const historyCalls = [];
    const navigationCalls = [];
    const link = { innerHTML: '', style: {} };
    let directRenderCalls = 0;

    const localStorage = {
        setItem(key, value) { storageCalls.push(['set', key, value]); },
        removeItem(key) { storageCalls.push(['remove', key]); },
    };
    const document = {
        getElementById(id) { return id === 'my-profile-link' ? link : null; },
    };
    const history = {
        replaceState(state, title, url) { historyCalls.push([state, title, url]); },
    };
    const navigateTo = (...args) => navigationCalls.push(args);
    const renderDashboard = () => { directRenderCalls += 1; };

    const profile = new Function(
        'localStorage',
        'document',
        'history',
        'navigateTo',
        'renderDashboard',
        `let myPlayerName = ${JSON.stringify(initialName)};
         const setMyPlayer = ${setMyPlayerSource};
         return { setMyPlayer, getMyPlayerName: () => myPlayerName };`,
    )(localStorage, document, history, navigateTo, renderDashboard);

    return {
        ...profile,
        storageCalls,
        historyCalls,
        navigationCalls,
        link,
        getDirectRenderCalls: () => directRenderCalls,
    };
}

function assertDashboardReplacement(harness) {
    assert.deepEqual(harness.historyCalls, [[
        { type: 'dashboard', id: null },
        '',
        '#dashboard',
    ]]);
    assert.deepEqual(harness.navigationCalls, [['dashboard', null, false]]);
    assert.equal(harness.getDirectRenderCalls(), 0);
}

const saved = createHarness(null);
saved.setMyPlayer('Public Player');
assert.equal(saved.getMyPlayerName(), 'Public Player');
assert.deepEqual(saved.storageCalls, [['set', 'myPlayerName', 'Public Player']]);
assert.match(saved.link.innerHTML, /Public Player/);
assert.equal(saved.link.style.color, '#f8fafc');
assertDashboardReplacement(saved);

const cleared = createHarness('Public Player');
cleared.setMyPlayer(null);
assert.equal(cleared.getMyPlayerName(), null);
assert.deepEqual(cleared.storageCalls, [['remove', 'myPlayerName']]);
assert.match(cleared.link.innerHTML, /Mein Profil/);
assert.equal(cleared.link.style.color, '#94a3b8');
assertDashboardReplacement(cleared);

console.log('profile history navigation contract: ok');
```

- [ ] **Step 2: Add the pytest bridge**

Create `tests/test_profile_history.py`:

```python
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_profile_history_navigation_contract_in_node() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "test_profile_history.js")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
```

- [ ] **Step 3: Verify RED for the confirmed root cause**

Run:

```powershell
python -m pytest tests/test_profile_history.py -q -p no:cacheprovider
```

Expected: `1 failed`; the history assertion reports that no dashboard replacement occurred because current `setMyPlayer()` calls `renderDashboard()` directly.

- [ ] **Step 4: Commit the failing regression**

```powershell
git add tests/test_profile_history.js tests/test_profile_history.py
git commit -m "test: cover profile history synchronization"
```

## Task 2: Synchronize profile completion with dashboard navigation

**Files:**
- Modify: `bundle_v31.js:139-154`

- [ ] **Step 1: Replace the direct render with history replacement and navigation**

At the end of `setMyPlayer()`, replace:

```javascript
        renderDashboard();
```

with:

```javascript
        const dashboardState = { type: 'dashboard', id: null };
        history.replaceState(dashboardState, "", "#dashboard");
        navigateTo('dashboard', null, false);
```

Do not move persistence, change the sidebar update, alter alerts, or modify `navigateTo()`.

- [ ] **Step 2: Verify the focused contract turns GREEN**

Run:

```powershell
python -m pytest tests/test_profile_history.py -q -p no:cacheprovider
node tests/test_profile_history.js
node --check bundle_v31.js
```

Expected: pytest reports `1 passed`; Node prints `profile history navigation contract: ok`; syntax exits `0`.

- [ ] **Step 3: Run all automated verification**

Run:

```powershell
python -m pytest -q -p no:cacheprovider
git diff --check
```

Expected: `394 passed, 4 skipped`; `git diff --check` reports no errors. The known `archive_tables_scraper.py` invalid-escape `SyntaxWarning` may still appear and is outside this fix.

- [ ] **Step 4: Commit the minimal implementation**

```powershell
git add bundle_v31.js
git commit -m "fix: synchronize profile dashboard history"
```

## Task 3: Verify profile history in a real mobile browser

**Files:**
- No file changes expected.

- [ ] **Step 1: Start a controlled local server**

Confirm port `8000` is free, start `python server.py` in the isolated worktree, record its PID, and verify `http://127.0.0.1:8000/` returns HTTP `200`. Never terminate a process not started for this task.

- [ ] **Step 2: Verify save and route replacement at `390 x 844`**

Using Playwright CLI with a clean session and snapshots before element references:

1. Open Dashboard, then navigate to Head-to-Head.
2. Open `Mein Profil` from the mobile menu.
3. Select and save a public player; do not retain or report the name.
4. Confirm the dashboard renders and evaluate:

```javascript
({
  hash: location.hash,
  state: history.state,
  sidebarOpen: document.querySelector('.sidebar').classList.contains('open'),
  overlayActive: document.getElementById('mobile-overlay').classList.contains('active'),
  backButtonDisplay: getComputedStyle(document.getElementById('back-btn')).display
})
```

Expected: `hash` is `#dashboard`; state is `{ type: 'dashboard', id: null }`; both navigation booleans are `false`; back button is hidden.

- [ ] **Step 3: Verify Back and Forward semantics**

Press browser Back and confirm Head-to-Head renders with `#comparison`. Press Forward and confirm Dashboard renders with `#dashboard`. The profile form must not become an intermediate history destination.

- [ ] **Step 4: Verify profile deletion uses the same contract**

Open `Mein Profil`, click `Löschen`, and confirm dashboard content, `#dashboard`, dashboard history state, closed mobile navigation, and hidden back button. Confirm Match Preview remains accessible afterward.

- [ ] **Step 5: Check layout and console**

Evaluate:

```javascript
document.documentElement.scrollWidth <= document.documentElement.clientWidth
```

Expected: `true`. Review console messages: no application error or warning is allowed; favicon `404` may be recorded separately.

- [ ] **Step 6: Clean the QA environment**

Close the Playwright session, stop only the recorded server PID, verify port `8000` is no longer listening, and remove only QA-created artifacts after confirming their resolved paths remain inside the isolated worktree.

- [ ] **Step 7: Record final repository evidence**

Run:

```powershell
git status --short
git log -4 --oneline
```

Expected: feature worktree clean; latest commits are the failing regression and minimal implementation; no push occurred.

## Completion criteria

- Save and delete replace the active profile entry with the dashboard route.
- URL, history state, internal state, rendered view, back button, and mobile navigation agree.
- Back returns to the pre-profile route and Forward returns to Dashboard.
- The focused contract, JavaScript syntax, full suite, and mobile browser journeys pass.
- No startup deep-link, data, scraper, archive, layout, service-worker, or deployment behavior changes.
