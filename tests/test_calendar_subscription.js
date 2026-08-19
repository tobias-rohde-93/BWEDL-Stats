const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'bundle_v31.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

function closingBrace(start) {
    let depth = 0;
    let quote = '';
    for (let index = start; index < source.length; index += 1) {
        const character = source[index];
        if (quote) {
            if (character === '\\') index += 1;
            else if (character === quote) quote = '';
            continue;
        }
        if (character === '"' || character === "'" || character === '`') quote = character;
        else if (character === '{') depth += 1;
        else if (character === '}') {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    assert.fail('unterminated function');
}

function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `Expected ${name} to exist`);
    const opening = source.indexOf('{', start);
    return source.slice(start, closingBrace(opening) + 1);
}

function compile(name, bindings = {}) {
    const keys = Object.keys(bindings);
    return Function(...keys, `${extract(name)}; return ${name};`)(...keys.map((key) => bindings[key]));
}

function createDocument() {
    const ids = new Map();
    class Element {
        constructor(tagName) {
            this.tagName = tagName.toUpperCase();
            this.children = [];
            this.parentElement = null;
            this.className = '';
            this.attributes = {};
            this.listeners = {};
            this.textContent = '';
            this.type = '';
            this.href = '';
            this.download = '';
            this.hidden = false;
            this.id = '';
            this.open = false;
            this.disabled = false;
            this.focused = false;
            this.clickCount = 0;
            this.removeCount = 0;
            this.classList = {
                add: (...names) => {
                    this.className = [...new Set(this.className.split(/\s+/).filter(Boolean).concat(names))].join(' ');
                },
                contains: (name) => this.className.split(/\s+/).includes(name),
            };
        }
        get isConnected() { return Boolean(this.parentElement); }
        get firstChild() { return this.children[0] || null; }
        appendChild(child) { this.children.push(child); child.parentElement = this; if (child.id) ids.set(child.id, child); return child; }
        append(...children) { children.forEach((child) => this.appendChild(child)); }
        insertBefore(child, reference) {
            const index = this.children.indexOf(reference);
            if (reference === null) return this.appendChild(child);
            if (index < 0) {
                const error = new Error('NotFoundError: reference is not a child of this element');
                error.name = 'NotFoundError';
                throw error;
            }
            this.children.splice(index, 0, child); child.parentElement = this; return child;
        }
        remove() { this.removeCount += 1; if (!this.parentElement) return; const index = this.parentElement.children.indexOf(this); if (index >= 0) this.parentElement.children.splice(index, 1); this.parentElement = null; }
        setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') { this.id = String(value); ids.set(this.id, this); } }
        addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
        dispatchEvent(event) {
            const dispatched = event && typeof event === 'object' ? event : { type: String(event) };
            dispatched.cancelable = Boolean(dispatched.cancelable);
            dispatched.defaultPrevented = Boolean(dispatched.defaultPrevented);
            dispatched.preventDefault = () => {
                if (dispatched.cancelable) dispatched.defaultPrevented = true;
            };
            (this.listeners[dispatched.type] || []).forEach((handler) => handler(dispatched));
            if (this.tagName === 'DIALOG' && dispatched.type === 'cancel' && !dispatched.defaultPrevented) {
                this.close();
            }
            return !dispatched.defaultPrevented;
        }
        click() { this.clickCount += 1; this.dispatchEvent({ type: 'click' }); }
        focus() { this.focused = true; document.activeElement = this; }
        showModal() { this.open = true; }
        close() { if (!this.open) return; this.open = false; this.dispatchEvent({ type: 'close' }); }
        querySelectorAll(selector) {
            const matches = (node) => selector.startsWith('.')
                ? node.classList.contains(selector.slice(1))
                : selector.startsWith('#') ? node.id === selector.slice(1) : node.tagName === selector.toUpperCase();
            return this.children.flatMap((child) => [(matches(child) ? child : null), ...child.querySelectorAll(selector)].filter(Boolean));
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    }
    const createdElements = [];
    const document = {
        activeElement: null,
        baseURI: 'https://stats.example.test/BWEDL-Stats/',
        body: new Element('body'),
        createdElements,
        createElement: (tag) => {
            const element = new Element(tag);
            createdElements.push(element);
            return element;
        },
        getElementById: (id) => ids.get(id) || null,
        querySelector: (selector) => document.body.querySelector(selector),
        querySelectorAll: (selector) => document.body.querySelectorAll(selector),
    };
    return document;
}

function allText(node) {
    return [node.textContent, ...node.children.flatMap((child) => [allText(child)])].join(' ');
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function nextTurn() {
    return new Promise((resolve) => setImmediate(resolve));
}

{
    const document = createDocument();
    const parent = document.createElement('div');
    const child = document.createElement('span');
    const foreignReference = document.createElement('span');
    assert.throws(() => parent.insertBefore(child, foreignReference), { name: 'NotFoundError' });
    assert.equal(parent.insertBefore(child, null), child);
}

const calendarIndex = {
    schema_version: 1,
    season: '2026-2027',
    teams: { 'dc beispiel': { name: 'DC Beispiel', path: 'calendars/club-001-team-1.ics' } },
};
const utils = {
    resolveCalendarFeed(index, team) {
        if (index !== calendarIndex || team !== 'DC Beispiel') return null;
        return { name: 'DC Beispiel', path: 'calendars/club-001-team-1.ics' };
    },
    buildCalendarSubscriptionUrls(feedPath, base) {
        if (feedPath !== 'calendars/club-001-team-1.ics' || !base) return null;
        return { https: 'https://stats.example.test/BWEDL-Stats/calendars/club-001-team-1.ics', webcal: 'webcal://stats.example.test/BWEDL-Stats/calendars/club-001-team-1.ics' };
    },
};

const resolvedSubscription = compile('resolveMyCalendarSubscription', {
    window: { BWEDL_CALENDAR_INDEX: calendarIndex, BwedlAppUtils: utils },
    document: { baseURI: 'https://stats.example.test/BWEDL-Stats/' },
    myPlayerProfile: { recordKey: 'A|1' },
    myTeamName: 'DC Beispiel',
})();
assert.deepEqual(resolvedSubscription, {
    name: 'DC Beispiel', path: 'calendars/club-001-team-1.ics',
    https: 'https://stats.example.test/BWEDL-Stats/calendars/club-001-team-1.ics',
    webcal: 'webcal://stats.example.test/BWEDL-Stats/calendars/club-001-team-1.ics', season: '2026/2027',
});
assert.equal(compile('resolveMyCalendarSubscription', {
    window: { BWEDL_CALENDAR_INDEX: { bad: true }, BwedlAppUtils: utils }, document: { baseURI: 'https://stats.example.test/' },
    myPlayerProfile: { recordKey: 'A|1' }, myTeamName: 'DC Beispiel',
})(), null);
assert.equal(compile('resolveMyCalendarSubscription', {
    window: { BWEDL_CALENDAR_INDEX: calendarIndex, BwedlAppUtils: utils }, document: { baseURI: 'https://stats.example.test/' },
    myPlayerProfile: null, myTeamName: 'DC Beispiel',
})(), null);

function cardHarness({ profile = { recordKey: 'A|1' }, team = 'DC Beispiel', subscription = resolvedSubscription, online = true, context = 'dashboard' } = {}) {
    const document = createDocument();
    const calls = [];
    const card = compile('createCalendarSubscriptionCard', {
        document,
        myPlayerProfile: profile,
        myTeamName: team,
        resolveMyCalendarSubscription: () => subscription,
        openCalendarSubscriptionDialog: (...args) => calls.push(['dialog', ...args]),
        navigateTo: (...args) => calls.push(['navigate', ...args]),
        navigator: { onLine: online },
        setAppStatus: (message) => calls.push(['status', message]),
    })(context);
    return { card, calls };
}

{
    const { card, calls } = cardHarness();
    assert.equal(card.tagName, 'SECTION');
    assert.equal(card.classList.contains('calendar-subscription-card'), true);
    assert.equal(card.querySelectorAll('H2').length, 1);
    assert.match(card.textContent + card.children.map((node) => node.textContent).join(' '), /DC Beispiel/);
    assert.match(card.textContent + card.children.map((node) => node.textContent).join(' '), /Ligaspiele · aktuelle Saison/);
    const action = card.querySelector('button');
    assert.equal(action.type, 'button');
    assert.equal(action.textContent, 'Kalender hinzufügen');
    action.dispatchEvent({ type: 'click' });
    assert.equal(calls[0][0], 'dialog');
}
{
    const { card } = cardHarness({ context: 'profile' });
    assert.equal(card.querySelector('h2').textContent, 'Kalender-Abo');
    assert.equal(card.classList.contains('calendar-subscription-card--profile'), true);
}
{
    const { card, calls } = cardHarness({ profile: null, team: null, subscription: null });
    assert.equal(card.querySelector('button').textContent, 'Mein Profil einrichten');
    card.querySelector('button').dispatchEvent({ type: 'click' });
    assert.deepEqual(calls, [['navigate', 'profile']]);
}
{
    const { card } = cardHarness({ subscription: null });
    assert.match(card.textContent + card.children.map((node) => node.textContent).join(' '), /aktuell kein Kalender verfügbar/);
    assert.equal(card.querySelectorAll('button').length, 0);
}
{
    const { card, calls } = cardHarness({ online: false });
    card.querySelector('button').dispatchEvent({ type: 'click' });
    assert.deepEqual(calls, [['status', 'Für das Kalender-Abo ist eine Internetverbindung erforderlich.']]);
}

async function dialogContract() {
    const document = createDocument();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const statuses = [];
    const copied = [];
    const openDialog = compile('openCalendarSubscriptionDialog', {
        document,
        navigator: { onLine: true, clipboard: { writeText: async (value) => copied.push(value) } },
        setAppStatus: (message) => statuses.push(message),
    });
    const dialog = openDialog(trigger, resolvedSubscription);
    assert.equal(dialog.tagName, 'DIALOG');
    assert.equal(dialog.className, 'calendar-subscription-dialog');
    assert.equal(dialog.attributes['aria-labelledby'].startsWith('calendar-subscription-title-'), true);
    assert.ok(dialog.attributes['aria-describedby']);
    assert.equal(dialog.querySelector('h2').textContent, 'Teamkalender hinzufügen');
    assert.equal(dialog.querySelector('a').href, resolvedSubscription.webcal);
    assert.equal(dialog.querySelector('a').textContent, 'In Kalender-App öffnen');
    assert.match(allText(dialog), /Wähle zwischen automatischer Aktualisierung und einer einmaligen Kopie\./);
    assert.match(allText(dialog), /Saison 2026\/2027/);
    assert.equal(dialog.querySelectorAll('.calendar-subscription-dialog__option').length, 2);
    assert.match(allText(dialog), /Automatisch aktuell bleiben/);
    assert.match(allText(dialog), /Wird als eigener, schreibgeschützter Teamkalender hinzugefügt\./);
    assert.match(allText(dialog), /Termine einmalig übernehmen/);
    assert.match(allText(dialog), /Keine automatische Aktualisierung/);
    assert.equal(dialog.querySelectorAll('details').length, 4);
    const summaries = dialog.querySelectorAll('summary').map((summary) => summary.textContent);
    assert.deepEqual(summaries, [
        'Anleitung für iPhone', 'Anleitung für Android / Google Kalender',
        'Anleitung für iPhone', 'Anleitung für Android / Google Kalender',
    ]);
    const buttons = dialog.querySelectorAll('button');
    const copy = buttons.find((button) => button.textContent === 'Abo-Link kopieren');
    assert.ok(buttons.find((button) => button.textContent === 'ICS-Datei herunterladen'));
    copy.dispatchEvent({ type: 'click' });
    await Promise.resolve();
    assert.deepEqual(copied, [resolvedSubscription.https]);
    assert.match(dialog.querySelector('.calendar-subscription-dialog__status').textContent, /kopiert/i);
    assert.equal(openDialog(trigger, resolvedSubscription), dialog, 'duplicate opening is prevented');
    dialog.close();

    const assertClosedOnce = (targetDialog, targetTrigger) => {
        assert.equal(targetDialog.open, false);
        assert.equal(targetDialog.parentElement, null);
        assert.equal(document.querySelector('.calendar-subscription-dialog'), null);
        assert.equal(targetDialog.removeCount, 1);
        assert.equal(document.activeElement, targetTrigger);
        targetDialog.close();
        targetDialog.dispatchEvent({ type: 'cancel', cancelable: true });
        assert.equal(targetDialog.removeCount, 1, 'later native events must not run cleanup twice');
    };

    const cancelTrigger = document.createElement('button');
    document.body.appendChild(cancelTrigger);
    const cancelDialog = openDialog(cancelTrigger, resolvedSubscription);
    const cancelEvent = { type: 'cancel', cancelable: true };
    assert.equal(cancelDialog.dispatchEvent(cancelEvent), true);
    assertClosedOnce(cancelDialog, cancelTrigger);
    assert.equal(cancelEvent.defaultPrevented, false);

    const closeTrigger = document.createElement('button');
    document.body.appendChild(closeTrigger);
    const closeDialog = openDialog(closeTrigger, resolvedSubscription);
    closeDialog.querySelectorAll('button').find((button) => button.textContent === 'Schließen')
        .dispatchEvent({ type: 'click' });
    assertClosedOnce(closeDialog, closeTrigger);

    const preventedDialog = document.createElement('dialog');
    document.body.appendChild(preventedDialog);
    preventedDialog.showModal();
    preventedDialog.addEventListener('cancel', (event) => event.preventDefault());
    const preventedEvent = { type: 'cancel', cancelable: true };
    assert.equal(preventedDialog.dispatchEvent(preventedEvent), false);
    assert.equal(preventedEvent.defaultPrevented, true);
    assert.equal(preventedDialog.open, true);
    assert.equal(preventedDialog.removeCount, 0);
    preventedDialog.close();
    preventedDialog.remove();

    const concurrencyDocument = createDocument();
    const concurrencyTrigger = concurrencyDocument.createElement('button');
    concurrencyDocument.body.appendChild(concurrencyTrigger);
    const concurrencyStatuses = [];
    const firstCopy = deferred();
    const secondCopy = deferred();
    let clipboardWrites = 0;
    const concurrencyDialog = compile('openCalendarSubscriptionDialog', {
        document: concurrencyDocument,
        navigator: {
            onLine: true,
            clipboard: {
                writeText: () => {
                    clipboardWrites += 1;
                    return clipboardWrites === 1 ? firstCopy.promise : secondCopy.promise;
                },
            },
        },
        setAppStatus: (message) => concurrencyStatuses.push(message),
    })(concurrencyTrigger, resolvedSubscription);
    const concurrencyButton = concurrencyDialog.querySelectorAll('button')
        .find((button) => button.textContent === 'Abo-Link kopieren');
    concurrencyButton.dispatchEvent({ type: 'click' });
    assert.equal(concurrencyButton.disabled, true);
    concurrencyButton.dispatchEvent({ type: 'click' });
    assert.equal(clipboardWrites, 1, 'a pending clipboard write ignores repeated clicks');
    assert.equal(concurrencyStatuses.length, 0);
    firstCopy.resolve();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(concurrencyButton.disabled, false);
    assert.equal(concurrencyStatuses.at(-1), 'Abo-Link wurde kopiert.');
    concurrencyButton.dispatchEvent({ type: 'click' });
    assert.equal(clipboardWrites, 2);
    assert.equal(concurrencyButton.disabled, true);
    secondCopy.reject(new Error('denied'));
    await Promise.resolve(); await Promise.resolve();
    assert.equal(concurrencyButton.disabled, false);
    assert.equal(concurrencyDialog.querySelector('.calendar-subscription-dialog__status').textContent, 'Abo-Link konnte nicht kopiert werden.');
    assert.equal(concurrencyStatuses.at(-1), 'Abo-Link konnte nicht kopiert werden.');

    const closePendingDocument = createDocument();
    const closePendingTrigger = closePendingDocument.createElement('button');
    closePendingDocument.body.appendChild(closePendingTrigger);
    const closePendingCopy = deferred();
    const closePendingStatuses = [];
    const closePendingDialog = compile('openCalendarSubscriptionDialog', {
        document: closePendingDocument,
        navigator: { onLine: true, clipboard: { writeText: () => closePendingCopy.promise } },
        setAppStatus: (message) => closePendingStatuses.push(message),
    })(closePendingTrigger, resolvedSubscription);
    closePendingDialog.querySelectorAll('button').find((button) => button.textContent === 'Abo-Link kopieren')
        .dispatchEvent({ type: 'click' });
    closePendingDialog.close();
    closePendingCopy.reject(new Error('closed'));
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(closePendingStatuses, [], 'a settled copy after close must not update stale UI or app status');

    const missingClipboardDocument = createDocument();
    const missingClipboardStatuses = [];
    const missingClipboardDialog = compile('openCalendarSubscriptionDialog', {
        document: missingClipboardDocument,
        navigator: { onLine: true },
        setAppStatus: (message) => missingClipboardStatuses.push(message),
    })(missingClipboardDocument.createElement('button'), resolvedSubscription);
    const missingClipboardButton = missingClipboardDialog.querySelectorAll('button')
        .find((button) => button.textContent === 'Abo-Link kopieren');
    missingClipboardButton.dispatchEvent({ type: 'click' });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(missingClipboardButton.disabled, false);
    assert.equal(missingClipboardDialog.querySelector('.calendar-subscription-dialog__status').textContent, 'Abo-Link konnte nicht kopiert werden.');
    assert.equal(missingClipboardStatuses.at(-1), 'Abo-Link konnte nicht kopiert werden.');

    const failedDocument = createDocument();
    const failedStatuses = [];
    const failedDialog = compile('openCalendarSubscriptionDialog', {
        document: failedDocument,
        navigator: { onLine: true, clipboard: { writeText: async () => { throw new Error('denied'); } } },
        setAppStatus: (message) => failedStatuses.push(message),
    })(failedDocument.createElement('button'), resolvedSubscription);
    failedDialog.querySelectorAll('button').find((button) => button.textContent === 'Abo-Link kopieren')
        .dispatchEvent({ type: 'click' });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(failedDialog.querySelector('.calendar-subscription-dialog__status').textContent, 'Abo-Link konnte nicht kopiert werden.');
    assert.equal(failedStatuses.at(-1), 'Abo-Link konnte nicht kopiert werden.');
    assert.equal(failedDialog.querySelectorAll('button').find((button) => button.textContent === 'Abo-Link kopieren').disabled, false);

    const NativeUrl = URL;
    const downloadDocument = createDocument();
    const downloadStatuses = [];
    const fetchCalls = [];
    const builderCalls = [];
    const createdUrls = [];
    const revokedUrls = [];
    class DownloadUrl extends NativeUrl {
        static createObjectURL(blob) {
            createdUrls.push(blob);
            return 'blob:calendar-snapshot';
        }
        static revokeObjectURL(value) { revokedUrls.push(value); }
    }
    const feedBytes = Uint8Array.from([66, 69, 71, 73, 78]);
    const downloadDialog = compile('openCalendarSubscriptionDialog', {
        document: downloadDocument,
        navigator: { onLine: true, clipboard: { writeText: async () => {} } },
        setAppStatus: (message) => downloadStatuses.push(message),
        fetch: async (request, options) => {
            fetchCalls.push([request, options]);
            return {
                ok: true,
                url: resolvedSubscription.https,
                arrayBuffer: async () => feedBytes.buffer,
            };
        },
        window: {
            BwedlAppUtils: {
                buildStaticCalendarDownload(bytes, options) {
                    builderCalls.push([bytes, options]);
                    return {
                        ok: true,
                        content: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
                        filename: 'bwedl-dc-beispiel-zukuenftige-spiele.ics',
                        eventCount: 1,
                    };
                },
            },
        },
        URL: DownloadUrl,
        Blob,
        AbortController,
    })(downloadDocument.createElement('button'), resolvedSubscription);
    const downloadButton = downloadDialog.querySelectorAll('button')
        .find((button) => button.textContent === 'ICS-Datei herunterladen');
    downloadButton.dispatchEvent({ type: 'click' });
    assert.equal(downloadButton.disabled, true);
    await nextTurn();
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0][0], resolvedSubscription.https);
    assert.equal(fetchCalls[0][1].cache, 'no-store');
    assert.equal(fetchCalls[0][1].signal instanceof AbortSignal, true);
    assert.equal(builderCalls.length, 1);
    assert.deepEqual([...builderCalls[0][0]], [...feedBytes]);
    assert.equal(builderCalls[0][1].teamName, resolvedSubscription.name);
    assert.equal(builderCalls[0][1].feedPath, resolvedSubscription.path);
    assert.equal(builderCalls[0][1].now instanceof Date, true);
    assert.equal(createdUrls.length, 1);
    assert.equal(createdUrls[0].type, 'text/calendar;charset=utf-8');
    assert.equal(await createdUrls[0].text(), 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    const downloadAnchor = downloadDocument.createdElements.find((element) => (
        element.tagName === 'A' && element.download === 'bwedl-dc-beispiel-zukuenftige-spiele.ics'
    ));
    assert.ok(downloadAnchor);
    assert.equal(downloadAnchor.href, 'blob:calendar-snapshot');
    assert.equal(downloadAnchor.clickCount, 1);
    assert.equal(downloadAnchor.parentElement, null);
    assert.deepEqual(revokedUrls, ['blob:calendar-snapshot']);
    assert.equal(downloadButton.disabled, false);
    assert.equal(downloadDialog.querySelector('.calendar-subscription-dialog__status').textContent, 'ICS-Datei wurde heruntergeladen.');
    assert.equal(downloadStatuses.at(-1), 'ICS-Datei wurde heruntergeladen.');

    const pendingDocument = createDocument();
    const pendingFetch = deferred();
    let pendingFetchCount = 0;
    let pendingSignal = null;
    let pendingBuilderCalls = 0;
    const pendingStatuses = [];
    const pendingDialog = compile('openCalendarSubscriptionDialog', {
        document: pendingDocument,
        navigator: { onLine: true, clipboard: { writeText: async () => {} } },
        setAppStatus: (message) => pendingStatuses.push(message),
        fetch: (_request, options) => {
            pendingFetchCount += 1;
            pendingSignal = options.signal;
            return pendingFetch.promise;
        },
        window: { BwedlAppUtils: { buildStaticCalendarDownload: () => { pendingBuilderCalls += 1; } } },
        URL: DownloadUrl,
        Blob,
        AbortController,
    })(pendingDocument.createElement('button'), resolvedSubscription);
    const pendingButton = pendingDialog.querySelectorAll('button')
        .find((button) => button.textContent === 'ICS-Datei herunterladen');
    pendingButton.dispatchEvent({ type: 'click' });
    pendingButton.dispatchEvent({ type: 'click' });
    assert.equal(pendingFetchCount, 1, 'a pending download ignores repeated clicks');
    assert.equal(pendingButton.disabled, true);
    pendingDialog.close();
    assert.equal(pendingSignal.aborted, true, 'closing aborts the feed request');
    pendingFetch.resolve({
        ok: true,
        url: resolvedSubscription.https,
        arrayBuffer: async () => feedBytes.buffer,
    });
    await nextTurn();
    assert.equal(pendingBuilderCalls, 0);
    assert.deepEqual(pendingStatuses, [], 'a settled download after close must not update stale UI');
    assert.equal(pendingDocument.createdElements.filter((element) => element.download).length, 0);

    const runDownloadFailure = async ({ response, builderResult, createObjectUrl, expected }) => {
        const failureDocument = createDocument();
        const failureStatuses = [];
        class FailureUrl extends NativeUrl {
            static createObjectURL(blob) {
                if (createObjectUrl) return createObjectUrl(blob);
                return 'blob:failure';
            }
            static revokeObjectURL() {}
        }
        const failureDialog = compile('openCalendarSubscriptionDialog', {
            document: failureDocument,
            navigator: { onLine: true, clipboard: { writeText: async () => {} } },
            setAppStatus: (message) => failureStatuses.push(message),
            fetch: async () => {
                if (response instanceof Error) throw response;
                return response;
            },
            window: { BwedlAppUtils: { buildStaticCalendarDownload: () => builderResult } },
            URL: FailureUrl,
            Blob,
            AbortController,
        })(failureDocument.createElement('button'), resolvedSubscription);
        const failureButton = failureDialog.querySelectorAll('button')
            .find((button) => button.textContent === 'ICS-Datei herunterladen');
        failureButton.dispatchEvent({ type: 'click' });
        await nextTurn();
        assert.equal(failureButton.disabled, false);
        assert.equal(failureDialog.querySelector('.calendar-subscription-dialog__status').textContent, expected);
        assert.equal(failureStatuses.at(-1), expected);
        assert.equal(failureDocument.createdElements.filter((element) => element.download).length, 0);
    };
    const validResponse = {
        ok: true,
        url: resolvedSubscription.https,
        arrayBuffer: async () => feedBytes.buffer,
    };
    await runDownloadFailure({
        response: new Error('offline'),
        expected: 'Die Kalenderdatei konnte nicht geladen werden. Prüfe deine Internetverbindung.',
    });
    await runDownloadFailure({
        response: { ...validResponse, ok: false },
        expected: 'Die Kalenderdatei konnte nicht geladen werden. Prüfe deine Internetverbindung.',
    });
    await runDownloadFailure({
        response: validResponse,
        builderResult: { ok: false, reason: 'empty' },
        expected: 'Aktuell sind keine zukünftigen Spieltermine verfügbar.',
    });
    await runDownloadFailure({
        response: validResponse,
        builderResult: { ok: false, reason: 'invalid' },
        expected: 'Die Kalenderdatei konnte nicht sicher erstellt werden.',
    });
    await runDownloadFailure({
        response: { ...validResponse, url: 'https://evil.example.test/calendar.ics' },
        builderResult: { ok: true, content: 'safe', filename: 'safe.ics', eventCount: 1 },
        expected: 'Die Kalenderdatei konnte nicht sicher erstellt werden.',
    });
    await runDownloadFailure({
        response: validResponse,
        builderResult: { ok: true, content: 'safe', filename: 'safe.ics', eventCount: 1 },
        createObjectUrl: () => { throw new Error('blob unavailable'); },
        expected: 'Die Kalenderdatei konnte nicht sicher erstellt werden.',
    });
}

dialogContract().then(() => {
    for (const name of ['resolveMyCalendarSubscription', 'createCalendarSubscriptionCard', 'openCalendarSubscriptionDialog']) {
        assert.doesNotMatch(extract(name), /\.innerHTML\b|insertAdjacentHTML/);
    }
    assert.match(source, /appendChild\(createCalendarSubscriptionCard\('dashboard'\)\);\s*grid\.appendChild\(actionCard\)/);
    assert.match(source, /card\.after\(createCalendarSubscriptionCard\('profile'\)\)/);
    assert.doesNotMatch(source, /function calendarFilename\(/);
    assert.doesNotMatch(source, /function downloadGameCalendar\(/);
    assert.doesNotMatch(source, /key:\s*'calendar'/);
    for (const selector of [
        '.calendar-subscription-card', '.calendar-subscription-card__title', '.calendar-subscription-card__meta',
        '.calendar-subscription-card__action', '.calendar-subscription-dialog', '.calendar-subscription-dialog::backdrop',
        '.calendar-subscription-dialog__options', '.calendar-subscription-dialog__option',
        '.calendar-subscription-dialog__badge', '.calendar-subscription-dialog__warning',
        '.calendar-subscription-dialog__option-actions', '.calendar-subscription-dialog__instructions',
        '.calendar-subscription-dialog__download', '.calendar-subscription-dialog__actions',
        '.calendar-subscription-dialog__status',
    ]) assert.match(styles, new RegExp(selector.replaceAll('.', '\\.').replace('::', '::') + '\\s*\\{'));
    assert.match(styles, /\.calendar-subscription-dialog__option-actions (?:button|a)[\s\S]*?min-height:\s*48px/);
    assert.match(styles, /\.calendar-subscription-dialog__instructions summary:focus-visible[\s\S]*?outline:/);
    assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.calendar-subscription-dialog\s*\{[\s\S]*?100dvh/);
    assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.calendar-subscription-dialog__option-actions[\s\S]*?width:\s*100%/);
    console.log('team calendar subscription UI: ok');
}).catch((error) => { console.error(error); process.exitCode = 1; });
