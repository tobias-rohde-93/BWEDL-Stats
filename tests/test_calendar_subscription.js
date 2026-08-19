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
            this.id = '';
            this.open = false;
            this.focused = false;
            this.removeCount = 0;
            this.classList = {
                add: (...names) => {
                    this.className = [...new Set(this.className.split(/\s+/).filter(Boolean).concat(names))].join(' ');
                },
                contains: (name) => this.className.split(/\s+/).includes(name),
            };
        }
        get isConnected() { return Boolean(this.parentElement); }
        appendChild(child) { this.children.push(child); child.parentElement = this; if (child.id) ids.set(child.id, child); return child; }
        append(...children) { children.forEach((child) => this.appendChild(child)); }
        insertBefore(child, reference) {
            const index = this.children.indexOf(reference);
            if (index < 0) return this.appendChild(child);
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
    const document = {
        activeElement: null,
        baseURI: 'https://stats.example.test/BWEDL-Stats/',
        body: new Element('body'),
        createElement: (tag) => new Element(tag),
        getElementById: (id) => ids.get(id) || null,
        querySelector: (selector) => document.body.querySelector(selector),
        querySelectorAll: (selector) => document.body.querySelectorAll(selector),
    };
    return document;
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
    assert.equal(action.textContent, 'Kalender abonnieren');
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
    assert.equal(dialog.querySelector('a').href, resolvedSubscription.webcal);
    assert.equal(dialog.querySelector('a').textContent, 'In Kalender-App öffnen');
    assert.match(dialog.textContent + dialog.children.map((node) => node.textContent).join(' '), /Saison 2026\/2027/);
    const buttons = dialog.querySelectorAll('button');
    const copy = buttons.find((button) => button.textContent === 'HTTPS-Link kopieren');
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

    const failedDocument = createDocument();
    const failedStatuses = [];
    const failedDialog = compile('openCalendarSubscriptionDialog', {
        document: failedDocument,
        navigator: { onLine: true, clipboard: { writeText: async () => { throw new Error('denied'); } } },
        setAppStatus: (message) => failedStatuses.push(message),
    })(failedDocument.createElement('button'), resolvedSubscription);
    failedDialog.querySelectorAll('button').find((button) => button.textContent === 'HTTPS-Link kopieren')
        .dispatchEvent({ type: 'click' });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(failedDialog.querySelector('.calendar-subscription-dialog__status').textContent, 'Abo-Link konnte nicht kopiert werden.');
    assert.equal(failedStatuses.at(-1), 'Abo-Link konnte nicht kopiert werden.');
}

dialogContract().then(() => {
    for (const name of ['resolveMyCalendarSubscription', 'createCalendarSubscriptionCard', 'openCalendarSubscriptionDialog']) {
        assert.doesNotMatch(extract(name), /\.innerHTML\b|insertAdjacentHTML/);
    }
    assert.match(source, /insertBefore\(createCalendarSubscriptionCard\('dashboard'\),\s*actionCard\)/);
    assert.match(source, /card\.after\(createCalendarSubscriptionCard\('profile'\)\)/);
    assert.doesNotMatch(source, /function calendarFilename\(/);
    assert.doesNotMatch(source, /function downloadGameCalendar\(/);
    assert.doesNotMatch(source, /key:\s*'calendar'/);
    for (const selector of [
        '.calendar-subscription-card', '.calendar-subscription-card__title', '.calendar-subscription-card__meta',
        '.calendar-subscription-card__action', '.calendar-subscription-dialog', '.calendar-subscription-dialog::backdrop',
        '.calendar-subscription-dialog__actions', '.calendar-subscription-dialog__status',
    ]) assert.match(styles, new RegExp(selector.replaceAll('.', '\\.').replace('::', '::') + '\\s*\\{'));
    console.log('team calendar subscription UI: ok');
}).catch((error) => { console.error(error); process.exitCode = 1; });
