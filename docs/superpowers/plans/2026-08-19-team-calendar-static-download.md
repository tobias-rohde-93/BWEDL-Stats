# Team Calendar Static Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the automatic team-calendar subscription and add one mobile-first, one-time ICS download containing only confirmed future fixtures, with clear iPhone and Android/Google Calendar instructions.

**Architecture:** The browser fetches the already validated same-origin team feed with `cache: "no-store"`, strictly validates its canonical RFC 5545 bytes, retains only future `STATUS:CONFIRMED` `VEVENT` blocks, and downloads one temporary Blob. The existing subscription URL and Python publication artifacts remain unchanged; pure parsing and filename logic live in `app_utils.js`, while `bundle_v31.js` owns the dialog and async lifecycle.

**Tech Stack:** Static HTML/CSS/JavaScript PWA, Node.js contract tests, Python/pytest wrappers, Playwright browser smoke tests, GitHub Pages.

---

## File map

- Modify `app_utils.js`: add DOM-free canonical feed validation, future-event filtering, snapshot assembly, and safe filename generation.
- Create `tests/test_static_calendar_download.js`: pure Node.js behavior and adversarial parser tests.
- Create `tests/test_static_calendar_download.py`: pytest wrapper for the pure Node.js contract.
- Modify `bundle_v31.js`: render both calendar choices and device instructions; fetch, download, and clean up the static snapshot.
- Modify `tests/test_calendar_subscription.js`: exercise dialog content, download lifecycle, stale-operation guards, and unchanged subscription behavior.
- Modify `style.css`: mobile-first stacked option cards, accessible accordions, warnings, and 44-48 px controls.
- Modify `tests/test_accessibility_contract.js`: assert semantic controls and mobile/focus CSS contracts.
- Modify `index.html`: advance cache-busted query versions for the changed CSS and JavaScript assets.
- Modify `sw_v31.js`: advance the cache name and precache URLs while preserving network-only calendar feeds.
- Modify `tests/test_public_status.py`, `tests/test_service_worker_status.js`, and `tests/test_reported_ui_regressions.js`: enforce the cache rollout contract.
- Modify `tests/test_browser_security.py`: verify a real Blob download under the GitHub Pages subpath at a 390 x 844 viewport.
- Modify `README.md`, `USER_GUIDE.md`, and `WIKI.md`: document automatic subscription versus one-time import and platform-specific limitations.
- Modify `docs/superpowers/specs/2026-08-19-team-calendar-static-download-design.md`: correct the approved entry-button label and the actual stylesheet filename before the plan commit.

### Task 1: Pure static snapshot builder

**Files:**
- Create: `tests/test_static_calendar_download.js`
- Create: `tests/test_static_calendar_download.py`
- Modify: `app_utils.js`

- [ ] **Step 1: Write the failing pure JavaScript contract**

Create `tests/test_static_calendar_download.js` with a fixed clock and canonical fixtures. The test must import a not-yet-existing `buildStaticCalendarDownload` export and cover success, filtering, byte safety, and filename safety:

```javascript
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildStaticCalendarDownload } = require(path.join(__dirname, '..', 'app_utils.js'));

const encoder = new TextEncoder();
const event = ({ uid, start, status = 'CONFIRMED', summary = 'Heimspiel gegen DC Gast' }) => [
    'BEGIN:VEVENT',
    `UID:${uid}@calendar.bwedl.invalid`,
    'DTSTAMP:20260819T010538Z',
    `DTSTART:${start}`,
    `DTEND:${start.slice(0, 9)}230000Z`,
    `SUMMARY:${summary}`,
    'DESCRIPTION:Begegnung: DC Heim - DC Gast\\nHeimspiel',
    'LOCATION:Testlokal\\, Teststraße 1',
    'SEQUENCE:0',
    'LAST-MODIFIED:20260819T010538Z',
    `STATUS:${status}`,
    'END:VEVENT',
].join('\r\n');

const feed = (...events) => encoder.encode([
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BWEDL//Team Calendar//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:BWEDL – DC Beispiel',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
    ...events,
    'END:VCALENDAR',
    '',
].join('\r\n'));

const result = buildStaticCalendarDownload(feed(
    event({ uid: 'past', start: '20260818T180000Z' }),
    event({ uid: 'future', start: '20260824T180000Z' }),
    event({ uid: 'cancelled', start: '20260825T180000Z', status: 'CANCELLED' }),
), {
    now: new Date('2026-08-19T12:00:00Z'),
    teamName: 'DĆ Beispiel / 1',
    feedPath: 'calendars/club-001-team-1.ics',
});

assert.equal(result.ok, true);
assert.equal(result.eventCount, 1);
assert.equal(result.filename, 'bwedl-dc-beispiel-1-zukuenftige-spiele.ics');
assert.match(result.content, /UID:future@calendar\.bwedl\.invalid/);
assert.doesNotMatch(result.content, /UID:(?:past|cancelled)@/);
assert.doesNotMatch(result.content, /REFRESH-INTERVAL|X-PUBLISHED-TTL/);
assert.equal(result.content.replace(/\r\n/g, '').includes('\n'), false);
assert.equal(result.content.endsWith('\r\n'), true);

for (const invalid of [
    encoder.encode('BEGIN:VCALENDAR\nEND:VCALENDAR\n'),
    Uint8Array.from([0xff]),
    feed(event({ uid: 'bad-date', start: '20260824' })),
    feed(event({ uid: 'duplicate', start: '20260824T180000Z' }).replace(
        'STATUS:CONFIRMED', 'STATUS:CONFIRMED\r\nSTATUS:CONFIRMED',
    )),
]) assert.equal(buildStaticCalendarDownload(invalid, {
    now: new Date('2026-08-19T12:00:00Z'), teamName: 'DC Beispiel', feedPath: 'calendars/club-001-team-1.ics',
}).reason, 'invalid');

assert.equal(buildStaticCalendarDownload(feed(event({ uid: 'past', start: '20260818T180000Z' })), {
    now: new Date('2026-08-19T12:00:00Z'), teamName: 'DC Beispiel', feedPath: 'calendars/club-001-team-1.ics',
}).reason, 'empty');
assert.equal(buildStaticCalendarDownload(new Uint8Array(524289), {
    now: new Date('2026-08-19T12:00:00Z'), teamName: 'DC Beispiel', feedPath: 'calendars/club-001-team-1.ics',
}).reason, 'oversized');
assert.equal(buildStaticCalendarDownload(feed(event({ uid: 'future', start: '20260824T180000Z' })), {
    now: new Date('2026-08-19T12:00:00Z'), teamName: '../../', feedPath: 'calendars/club-001-team-1.ics',
}).filename, 'bwedl-club-001-team-1-zukuenftige-spiele.ics');

console.log('static team calendar download: ok');
```

Extend this file before GREEN with table-driven cases for a folded Unicode description, a 75-octet physical-line boundary, physical trailing whitespace, nested/unbalanced components, missing and duplicate required properties, duplicate UIDs, invalid top-level header values, an unsafe feed path, invalid `now`, exactly-at-boundary inclusion, deterministic repeated output, and a safe filename capped at 120 characters.

- [ ] **Step 2: Add the pytest wrapper**

Create `tests/test_static_calendar_download.py`:

```python
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def test_static_calendar_download_contract() -> None:
    result = subprocess.run(
        ["node", "tests/test_static_calendar_download.js"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "static team calendar download: ok" in result.stdout
```

- [ ] **Step 3: Run RED**

Run: `node tests/test_static_calendar_download.js`

Expected: FAIL because `buildStaticCalendarDownload` is not exported.

- [ ] **Step 4: Implement the minimal strict parser and snapshot builder**

In `app_utils.js`, add the following implementation without a general-purpose ICS dependency:

```javascript
const MAX_STATIC_CALENDAR_BYTES = 512 * 1024;
const STATIC_EVENT_REQUIRED = new Set([
    'UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY', 'DESCRIPTION',
    'SEQUENCE', 'LAST-MODIFIED', 'STATUS',
]);
const STATIC_EVENT_ALLOWED = new Set([...STATIC_EVENT_REQUIRED, 'LOCATION']);
const STATIC_TOP_LEVEL = new Set([
    'VERSION', 'PRODID', 'CALSCALE', 'METHOD', 'X-WR-CALNAME',
    'REFRESH-INTERVAL;VALUE=DURATION', 'X-PUBLISHED-TTL',
    'X-BWEDL-EMPTY-FEED', 'X-WR-CALDESC',
]);
const STATIC_UNSAFE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;

function staticUtf8Length(value) {
    return new TextEncoder().encode(value).byteLength;
}

function decodeStaticCalendarBytes(value) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(value);
    } catch (_error) {
        return null;
    }
}

function unfoldStaticCalendarLines(text) {
    if (typeof text !== 'string' || !text.endsWith('\r\n') ||
        /(^|[^\r])\n/u.test(text) || /\r(?!\n)/u.test(text) || STATIC_UNSAFE_CONTROL.test(text)) return null;
    const physical = text.slice(0, -2).split('\r\n');
    const logical = [];
    for (const line of physical) {
        if (!line || staticUtf8Length(line) > 75 || /[ \t]$/u.test(line)) return null;
        if (/^[ \t]/u.test(line)) {
            if (!logical.length) return null;
            logical.at(-1).value += line.slice(1);
            logical.at(-1).raw.push(line);
        } else {
            logical.push({ value: line, raw: [line] });
        }
    }
    return logical;
}

function parseStaticUtcTimestamp(value) {
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u.exec(value);
    if (!match) return null;
    const parts = match.slice(1).map(Number);
    const milliseconds = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
    if (!Number.isFinite(milliseconds)) return null;
    const roundTrip = new Date(milliseconds).toISOString().replace(/[-:]/gu, '').replace(/\.000Z$/u, 'Z');
    return roundTrip === value ? milliseconds : null;
}

function staticCalendarFilename(teamName, feedPath) {
    if (typeof feedPath !== 'string' || !SAFE_CALENDAR_FEED_PATH.test(feedPath)) return null;
    const fallback = feedPath.slice('calendars/'.length, -'.ics'.length);
    const normalized = normalizeCalendarTeamName(teamName);
    const slug = normalized.replace(/\s+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 64).replace(/-+$/u, '');
    return `bwedl-${slug || fallback}-zukuenftige-spiele.ics`;
}

function parseStaticEvent(entries) {
    if (entries.length < 3 || entries[0].value !== 'BEGIN:VEVENT' || entries.at(-1).value !== 'END:VEVENT') return null;
    const properties = new Map();
    for (const entry of entries.slice(1, -1)) {
        if (/^(?:BEGIN|END):/u.test(entry.value)) return null;
        const separator = entry.value.indexOf(':');
        if (separator < 1) return null;
        const name = entry.value.slice(0, separator);
        const value = entry.value.slice(separator + 1);
        if (!STATIC_EVENT_ALLOWED.has(name) || properties.has(name) || !value) return null;
        properties.set(name, value);
    }
    if ([...STATIC_EVENT_REQUIRED].some((name) => !properties.has(name))) return null;
    if (!/^\d+$/u.test(properties.get('SEQUENCE'))) return null;
    if (!['CONFIRMED', 'CANCELLED'].includes(properties.get('STATUS'))) return null;
    for (const name of ['DTSTAMP', 'DTSTART', 'DTEND', 'LAST-MODIFIED']) {
        if (parseStaticUtcTimestamp(properties.get(name)) === null) return null;
    }
    return {
        startsAt: parseStaticUtcTimestamp(properties.get('DTSTART')),
        status: properties.get('STATUS'),
        raw: entries.flatMap((entry) => entry.raw),
    };
}

function buildStaticCalendarDownload(feedBytes, { now, teamName, feedPath } = {}) {
    if (!(feedBytes instanceof Uint8Array)) return { ok: false, reason: 'invalid' };
    if (feedBytes.byteLength > MAX_STATIC_CALENDAR_BYTES) return { ok: false, reason: 'oversized' };
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return { ok: false, reason: 'invalid' };
    const filename = staticCalendarFilename(teamName, feedPath);
    const text = decodeStaticCalendarBytes(feedBytes);
    const logical = text === null ? null : unfoldStaticCalendarLines(text);
    if (!filename || !logical) return { ok: false, reason: 'invalid' };
    if (logical.length < 2 || logical[0].value !== 'BEGIN:VCALENDAR' || logical.at(-1).value !== 'END:VCALENDAR') {
        return { ok: false, reason: 'invalid' };
    }
    const selectedRawEvents = [];
    const topValues = new Map();
    for (let index = 1; index < logical.length - 1; index += 1) {
        const entry = logical[index];
        if (entry.value === 'BEGIN:VEVENT') {
            const end = logical.findIndex((candidate, candidateIndex) =>
                candidateIndex > index && candidate.value === 'END:VEVENT');
            if (end < 0) return { ok: false, reason: 'invalid' };
            const parsed = parseStaticEvent(logical.slice(index, end + 1));
            if (!parsed) return { ok: false, reason: 'invalid' };
            if (parsed.status === 'CONFIRMED' && parsed.startsAt >= now.getTime()) selectedRawEvents.push(parsed.raw);
            index = end;
            continue;
        }
        if (/^(?:BEGIN|END):/u.test(entry.value)) return { ok: false, reason: 'invalid' };
        const separator = entry.value.indexOf(':');
        if (separator < 1) return { ok: false, reason: 'invalid' };
        const name = entry.value.slice(0, separator);
        const value = entry.value.slice(separator + 1);
        if (!STATIC_TOP_LEVEL.has(name) || topValues.has(name) || !value) return { ok: false, reason: 'invalid' };
        topValues.set(name, value);
    }
    if (topValues.get('VERSION') !== '2.0' || !topValues.get('PRODID') ||
        topValues.get('CALSCALE') !== 'GREGORIAN' || topValues.get('METHOD') !== 'PUBLISH') {
        return { ok: false, reason: 'invalid' };
    }
    if (!selectedRawEvents.length) return { ok: false, reason: 'empty' };
    const output = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//BWEDL Stats//Static Team Calendar//DE',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        ...selectedRawEvents.flat(),
        'END:VCALENDAR',
        '',
    ].join('\r\n');
    return Object.freeze({ ok: true, content: output, filename, eventCount: selectedRawEvents.length });
}
```

Export `buildStaticCalendarDownload` from the factory return object. The tests remain authoritative if a smaller equivalent implementation is clearer.

- [ ] **Step 5: Run GREEN and regression utilities**

Run:

```powershell
node tests/test_static_calendar_download.js
node tests/test_user_value_utils.js
python -m pytest tests/test_static_calendar_download.py tests/test_calendar_subscription.py -q -p no:cacheprovider
node --check app_utils.js
```

Expected: both Node markers print `ok`; pytest passes; syntax check exits 0.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- app_utils.js tests/test_static_calendar_download.js tests/test_static_calendar_download.py
git diff --cached --check
git commit -m "feat: build static team calendar snapshots"
```

### Task 2: Two-choice dialog and safe download lifecycle

**Files:**
- Modify: `bundle_v31.js`
- Modify: `tests/test_calendar_subscription.js`

- [ ] **Step 1: Extend the DOM harness and write failing dialog tests**

Update the fake element in `tests/test_calendar_subscription.js` with `download`, `hidden`, and a `click()` method that dispatches a click event. Change expected entry labels to **Kalender hinzufügen** and **Teamkalender hinzufügen**. Assert exactly two `.calendar-subscription-dialog__option` sections, the approved copy, four native `DETAILS` elements, both platform summaries under each option, and one **ICS-Datei herunterladen** button.

Add an async harness with injected `fetch`, `Blob`, `URL.createObjectURL`, `URL.revokeObjectURL`, and a fixed `Date`/clock. It must prove:

```javascript
assert.deepEqual(fetchCalls[0], [resolvedSubscription.https, { cache: 'no-store', signal: abortSignal }]);
assert.equal(snapshotCalls.length, 1);
assert.equal(downloadAnchor.download, 'bwedl-dc-beispiel-zukuenftige-spiele.ics');
assert.equal(downloadClicks, 1);
assert.deepEqual(revokedUrls, ['blob:calendar-1']);
assert.equal(downloadButton.disabled, false);
```

Add RED cases for repeated taps, offline/network failure, non-OK response, unexpected final response URL, empty result, invalid/oversized result, Blob/object-URL failure, close while fetch is pending, abort on close, and no stale live-region/app-status update after close. Retain all clipboard race, Escape, focus-return, duplicate-dialog, and safe-DOM assertions.

- [ ] **Step 2: Run RED**

Run: `node tests/test_calendar_subscription.js`

Expected: FAIL on the old labels and missing static download option.

- [ ] **Step 3: Implement the two-choice dialog**

In `bundle_v31.js`:

- Change the card action text to **Kalender hinzufügen**.
- Change the dialog heading to **Teamkalender hinzufügen** and intro to the approved one-sentence choice explanation.
- Build both option cards using `document.createElement`, `textContent`, native `details`/`summary`, and existing validated subscription values; do not use HTML string insertion.
- Keep the automatic option's `webcal` link and clipboard action behavior unchanged.
- Add a download button with an independent operation counter, `AbortController`, and in-flight flag.
- Fetch `subscription.https` with `{ cache: 'no-store', signal }`, require `response.ok`, require `new URL(response.url).href === subscription.https`, convert `await response.arrayBuffer()` to `Uint8Array`, and call `window.BwedlAppUtils.buildStaticCalendarDownload(...)` with the current instant, `subscription.name`, and `subscription.path`.
- Map `reason === 'empty'` to **Aktuell sind keine zukünftigen Spieltermine verfügbar.**; map network/offline errors to **Die Kalenderdatei konnte nicht geladen werden. Prüfe deine Internetverbindung.**; map other validation/output failures to **Die Kalenderdatei konnte nicht sicher erstellt werden.**
- On success, construct `new Blob([result.content], { type: 'text/calendar;charset=utf-8' })`, activate a hidden temporary `<a download>`, remove it, and revoke the object URL in a `finally` block.
- While active, disable the button and display **ICS-Datei wird erstellt ...**. On dialog cleanup, increment both operation counters and abort the pending download controller.

The download handler must keep this lifecycle shape:

```javascript
if (removed || downloadInFlight || downloadButton.disabled) return;
if (!navigator.onLine) return reportDownloadFailure('network');
downloadInFlight = true;
downloadButton.disabled = true;
downloadButton.textContent = 'ICS-Datei wird erstellt ...';
const operation = ++downloadOperation;
const controller = new AbortController();
downloadController = controller;
try {
    const response = await fetch(subscription.https, { cache: 'no-store', signal: controller.signal });
    // Validate response and create the snapshot/download only while canUpdate().
} finally {
    if (operation !== downloadOperation) return;
    downloadInFlight = false;
    downloadController = null;
    if (!removed && dialog.isConnected) {
        downloadButton.disabled = false;
        downloadButton.textContent = 'ICS-Datei herunterladen';
    }
}
```

- [ ] **Step 4: Run GREEN and related UI regressions**

Run:

```powershell
node tests/test_calendar_subscription.js
node tests/test_season_context.js
node tests/test_personal_match_center.js
node --check bundle_v31.js
python -m pytest tests/test_calendar_subscription.py tests/test_season_context.py tests/test_personal_match_center.py -q -p no:cacheprovider
```

Expected: all direct contracts print `ok`; pytest passes; syntax check exits 0.

- [ ] **Step 5: Commit Task 2**

```powershell
git add -- bundle_v31.js tests/test_calendar_subscription.js
git diff --cached --check
git commit -m "feat: add static team calendar download"
```

### Task 3: Mobile-first styling and accessibility contract

**Files:**
- Modify: `style.css`
- Modify: `tests/test_accessibility_contract.js`
- Modify: `tests/test_calendar_subscription.js`

- [ ] **Step 1: Write failing style and semantics assertions**

Require CSS rules for:

```text
.calendar-subscription-dialog__intro
.calendar-subscription-dialog__options
.calendar-subscription-dialog__option
.calendar-subscription-dialog__badge
.calendar-subscription-dialog__warning
.calendar-subscription-dialog__instructions
.calendar-subscription-dialog__download
```

Assert the narrow breakpoint stacks controls at full width, the dialog uses a `100dvh`-bounded height, option actions have at least `min-height: 48px`, every interactive control has a visible `:focus-visible` rule, warning meaning is present in text, and reduced-motion rules cover the new controls. Assert each native `summary` has useful text and is keyboard-focusable by semantics.

- [ ] **Step 2: Run RED**

Run:

```powershell
node tests/test_accessibility_contract.js
node tests/test_calendar_subscription.js
```

Expected: FAIL because the new class contracts do not exist.

- [ ] **Step 3: Implement responsive CSS**

Extend the existing calendar section in `style.css`:

```css
.calendar-subscription-dialog {
    width: min(38rem, calc(100vw - 1rem));
    max-height: calc(100dvh - 1rem);
    overflow: auto;
}

.calendar-subscription-dialog__options {
    display: grid;
    gap: 1rem;
}

.calendar-subscription-dialog__option {
    display: grid;
    gap: 0.65rem;
    padding: 1rem;
    border: 1px solid #475569;
    border-radius: 9px;
    background: #111c30;
}

.calendar-subscription-dialog__warning {
    padding: 0.7rem;
    color: #fef3c7;
    background: #422006;
    border-left: 3px solid #fbbf24;
}

.calendar-subscription-dialog__instructions summary {
    min-height: 44px;
    padding: 0.65rem 0;
    color: #bfdbfe;
    cursor: pointer;
}

.calendar-subscription-dialog__open-link,
.calendar-subscription-dialog__actions button,
.calendar-subscription-dialog__download {
    min-height: 48px;
}

@media (max-width: 480px) {
    .calendar-subscription-dialog {
        width: calc(100vw - 0.5rem);
        max-height: calc(100dvh - 0.5rem);
        padding: 1rem;
    }
    .calendar-subscription-dialog__actions {
        display: grid;
        grid-template-columns: 1fr;
    }
}
```

Integrate these declarations with existing colors and selectors instead of duplicating conflicting rules. Add focus-visible and reduced-motion coverage for summary and the download button.

- [ ] **Step 4: Run GREEN**

Run:

```powershell
node tests/test_accessibility_contract.js
node tests/test_calendar_subscription.js
python -m pytest tests/test_accessibility_contract.py tests/test_calendar_subscription.py -q -p no:cacheprovider
```

Expected: all tests pass.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -- style.css tests/test_accessibility_contract.js tests/test_calendar_subscription.js
git diff --cached --check
git commit -m "style: optimize calendar choices for smartphones"
```

### Task 4: Installed-PWA cache rollout

**Files:**
- Modify: `index.html`
- Modify: `sw_v31.js`
- Modify: `tests/test_public_status.py`
- Modify: `tests/test_service_worker_status.js`
- Modify: `tests/test_reported_ui_regressions.js`

- [ ] **Step 1: Write RED cache-version expectations**

Update the three cache/version contracts to require:

```text
CACHE_NAME = bwedl-dashboard-v40
style.css?v=7
app_utils.js?v=4
bundle_v31.js?v=3.7
```

Also assert that `bwedl-dashboard-v39` is absent and that both `index.html` and the service-worker precache use the same three query versions. Keep the existing assertions that `calendar_state.json` and `calendars/*.ics` are not precached, are fetched with `cache: "no-store"`, and never use Cache Storage fallback.

- [ ] **Step 2: Run RED**

Run:

```powershell
node tests/test_service_worker_status.js
node tests/test_reported_ui_regressions.js
python -m pytest tests/test_public_status.py -q -p no:cacheprovider
```

Expected: FAIL on v39 and the old asset query versions.

- [ ] **Step 3: Advance the deployed asset versions**

In `index.html`, replace only these asset references:

```html
<link rel="stylesheet" href="style.css?v=7">
<script src="app_utils.js?v=4"></script>
<script src="bundle_v31.js?v=3.7"></script>
```

In `sw_v31.js`, set:

```javascript
const CACHE_NAME = 'bwedl-dashboard-v40';
```

and use the same `style.css?v=7`, `app_utils.js?v=4`, and `bundle_v31.js?v=3.7` entries in `urlsToCache`. Do not change the fetch strategy.

- [ ] **Step 4: Run GREEN**

Run:

```powershell
node tests/test_service_worker_status.js
node tests/test_reported_ui_regressions.js
python -m pytest tests/test_public_status.py -q -p no:cacheprovider
node --check sw_v31.js
```

Expected: all contracts pass and syntax check exits 0.

- [ ] **Step 5: Commit Task 4**

```powershell
git add -- index.html sw_v31.js tests/test_public_status.py tests/test_service_worker_status.js tests/test_reported_ui_regressions.js
git diff --cached --check
git commit -m "chore: roll calendar download assets"
```

### Task 5: Real browser download and user documentation

**Files:**
- Modify: `tests/test_browser_security.py`
- Modify: `README.md`
- Modify: `USER_GUIDE.md`
- Modify: `WIKI.md`

- [ ] **Step 1: Write the failing browser download flow**

Extend the test Pages feed with three canonical events: one year-2000 confirmed event, one year-2099 confirmed event, and one year-2099 cancelled event. Include `LAST-MODIFIED` in each event. At the 390 x 844 viewport:

```python
page.evaluate("location.hash = '#dashboard'")
page.get_by_role("button", name="Kalender hinzufügen").click()
dialog = page.get_by_role("dialog", name="Teamkalender hinzufügen")
expect(dialog.get_by_text("Automatisch aktuell bleiben", exact=True)).to_be_visible()
expect(dialog.get_by_text("Termine einmalig übernehmen", exact=True)).to_be_visible()
assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")

with page.expect_download() as download_info:
    dialog.get_by_role("button", name="ICS-Datei herunterladen").click()
download = download_info.value
downloaded = Path(download.path()).read_bytes()
assert downloaded.startswith(b"BEGIN:VCALENDAR\r\n")
assert downloaded.count(b"BEGIN:VEVENT\r\n") == 1
assert b"future-confirmed@calendar.bwedl.invalid" in downloaded
assert b"past-confirmed@calendar.bwedl.invalid" not in downloaded
assert b"future-cancelled@calendar.bwedl.invalid" not in downloaded
assert b"\n" not in downloaded.replace(b"\r\n", b"")
```

Retain the same webcal/HTTPS equality checks, Escape/focus checks, no `/api/` assertion, XSS probes, and service-worker offline scenario. Update the offline action label to **Kalender hinzufügen** while preserving its existing no-dialog status behavior.

- [ ] **Step 2: Run browser RED**

Run: `$env:BWEDL_BROWSER_TESTS='1'; python -m pytest tests/test_browser_security.py -q -p no:cacheprovider`

Expected: FAIL because the current dialog has no static download action.

- [ ] **Step 3: Update documentation with exact choice and platform guidance**

In all three documents, state:

```markdown
- **Automatisch aktuell:** als eigener schreibgeschützter Teamkalender; Änderungen und Absagen werden übernommen.
- **Einmalige ICS-Datei:** alle zukünftigen bestätigten Ligaspiele in einer Datei; Import in einen bestehenden Kalender möglich, danach keine automatische Aktualisierung.
```

Document the approved iPhone subscription/import steps and Android/Google computer-only URL/import steps. Include the duplicate-import warning, the exclusion of past/cancelled/unconfirmed/Ligapokal fixtures, and the fact that GitHub Pages remains the only runtime. Do not claim that a download proves successful import or external refresh.

- [ ] **Step 4: Run browser GREEN and documentation/runtime contracts**

Run:

```powershell
$env:BWEDL_BROWSER_TESTS='1'
python -m pytest tests/test_browser_security.py tests/test_github_pages_runtime.py tests/test_files.py -q -p no:cacheprovider
node --check app_utils.js
node --check bundle_v31.js
node --check sw_v31.js
```

Expected: browser test and Python contracts pass; all syntax checks exit 0.

- [ ] **Step 5: Commit Task 5**

```powershell
git add -- tests/test_browser_security.py README.md USER_GUIDE.md WIKI.md
git diff --cached --check
git commit -m "docs: explain calendar subscription and import"
```

### Task 6: Full verification and release-ready branch review

**Files:**
- Verify all modified files; do not modify `.agent/rules/git-workflow.md`.

- [ ] **Step 1: Run focused JavaScript and Python suites**

```powershell
node tests/test_static_calendar_download.js
node tests/test_calendar_subscription.js
node tests/test_accessibility_contract.js
node tests/test_user_value_utils.js
node tests/test_season_context.js
node tests/test_personal_match_center.js
python -m pytest tests/test_static_calendar_download.py tests/test_calendar_subscription.py tests/test_accessibility_contract.py tests/test_github_pages_runtime.py tests/test_files.py -q -p no:cacheprovider
```

Expected: all direct markers print `ok`; focused pytest passes.

- [ ] **Step 2: Run the full suite**

Run: `python -m pytest tests -q -p no:cacheprovider`

Expected: all tests pass; only documented platform/symlink skips remain. If Windows sandbox temporary-directory creation fails with `WinError 5`, rerun the identical command with approved elevated filesystem access before diagnosing product code.

- [ ] **Step 3: Run the real Chromium smoke test**

Run: `$env:BWEDL_BROWSER_TESTS='1'; python -m pytest tests/test_browser_security.py -q -p no:cacheprovider`

Expected: PASS with the download event and mobile layout assertions.

- [ ] **Step 4: Prove generated calendar artifacts are unchanged**

Run:

```powershell
$calendarGeneratedAt = python -c "import json; print(json.load(open('data_status.json', encoding='utf-8'))['domains']['leagues']['updated_at'])"
python -m pipeline.calendar_feeds --league-json league_data.json --club-json club_data.json --previous-state calendar_state.json --updated-at $calendarGeneratedAt --output-dir .
git diff --exit-code -- calendar_index.json calendar_index.js calendar_state.json calendars
```

Expected: exit 0. This browser-only feature must not alter the canonical subscription publication.

- [ ] **Step 5: Inspect exact scope and whitespace**

```powershell
git diff --check main...HEAD
git status --short --branch
git log --oneline main..HEAD
```

Expected: no whitespace errors; only the user's pre-existing `.agent/rules/git-workflow.md` working-tree modification remains outside committed feature scope.

- [ ] **Step 6: Request final review before integration or push**

Review the full `main...HEAD` diff against the approved design, rerun any counterexample found, and fix Critical/Important findings with separate TDD commits. Do not merge, push, or deploy until the user separately requests it.
