const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'bundle_v31.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const BwedlAppUtils = require('../app_utils.js');

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
            if (character === '\\') index += 1;
            else if (
                (state === 'single' && character === "'") ||
                (state === 'double' && character === '"') ||
                (state === 'template' && character === '`')
            ) state = 'code';
            continue;
        }
        if (character === '/' && nextCharacter === '/') {
            state = 'line-comment';
            index += 1;
        } else if (character === '/' && nextCharacter === '*') {
            state = 'block-comment';
            index += 1;
        } else if (character === "'") state = 'single';
        else if (character === '"') state = 'double';
        else if (character === '`') state = 'template';
        else if (character === '{') depth += 1;
        else if (character === '}') {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    assert.fail(`Expected ${label} to have a complete declaration`);
}

function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `Expected function ${name} to exist`);
    const openingBrace = source.indexOf('{', start);
    return source.slice(start, findClosingBrace(openingBrace, name) + 1);
}

function compileFunction(name, dependencies = {}) {
    const names = Object.keys(dependencies);
    return Function(...names, `${extractFunction(name)}; return ${name};`)(
        ...names.map((key) => dependencies[key]),
    );
}

function createDocument() {
    const byId = new Map();
    class Element {
        constructor(tagName) {
            this.tagName = tagName.toUpperCase();
            this.children = [];
            this.attributes = {};
            this.listeners = {};
            this.style = {};
            this.hidden = false;
            this.value = '';
            this.className = '';
            this._id = '';
            this._textContent = '';
            this.classList = {
                add: (...names) => {
                    const classes = new Set(this.className.split(/\s+/).filter(Boolean));
                    names.forEach((name) => classes.add(name));
                    this.className = [...classes].join(' ');
                },
                contains: (name) => this.className.split(/\s+/).includes(name),
            };
        }
        set id(value) {
            this._id = value;
            if (value) byId.set(value, this);
        }
        get id() { return this._id; }
        set textContent(value) { this._textContent = String(value); }
        get textContent() {
            return this._textContent + this.children.map((child) => child.textContent).join('');
        }
        set innerHTML(value) { this._innerHTML = String(value); }
        get innerHTML() { return this._innerHTML || ''; }
        appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
        append(...children) { children.forEach((child) => this.appendChild(child)); }
        replaceChildren(...children) { this.children = []; this.append(...children); }
        setAttribute(name, value) { this.attributes[name] = String(value); }
        getAttribute(name) { return this.attributes[name] ?? null; }
        addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
        dispatch(type, init = {}) {
            const event = {
                key: '',
                target: this,
                currentTarget: this,
                preventDefault() { this.defaultPrevented = true; },
                stopPropagation() {},
                ...init,
            };
            (this.listeners[type] || []).forEach((listener) => listener(event));
            return event;
        }
        focus() { this.focused = true; }
    }
    return {
        createElement: (tagName) => new Element(tagName),
        getElementById: (id) => byId.get(id) || null,
    };
}

function descendants(root) {
    return [root, ...root.children.flatMap(descendants)];
}

const document = createDocument();
const clubs = [
    { name: 'DC Nord', venue: 'Sportheim', street: 'Talstraße 5', city: 'Pforzheim' },
    { name: 'Flying Arrows', venue: 'Alte Mühle', street: 'Hauptweg 1', city: 'Calw' },
    { name: '<img src=x onerror=alert(1)>', city: 'Testort' },
    ...Array.from({ length: 7 }, (_, index) => ({ name: `Verein ${index + 4}`, city: 'Enzkreis' })),
];
const clubData = { clubs };
const navigationCalls = [];
const navigateTo = (type, id) => navigationCalls.push([type, id]);

const normalizeClubSearchText = compileFunction('normalizeClubSearchText');
const filterClubEntries = compileFunction('filterClubEntries', { normalizeClubSearchText });
assert.deepEqual(filterClubEntries(clubs, 'pforzheim'), [clubs[0]]);
assert.deepEqual(filterClubEntries(clubs, 'talstrasse'), [clubs[0]]);

const contentArea = document.createElement('main');
const topBarTitle = document.createElement('h1');
const renderClubList = compileFunction('renderClubList', {
    document,
    topBarTitle,
    contentArea,
    clubData,
    filterClubEntries,
    navigateTo,
});
renderClubList();
const overview = contentArea.children[0];
const search = document.getElementById('club-search');
const grid = descendants(overview).find((element) => element.classList.contains('club-overview-grid'));
assert.equal(grid.children.length, clubs.length, 'overview initially retains every club');
search.value = 'calw';
search.dispatch('input');
assert.equal(grid.children.length, 1, 'city search filters the rendered production DOM');
grid.children[0].dispatch('click');
assert.deepEqual(navigationCalls.pop(), ['club', 1]);
search.value = 'nord';
search.dispatch('input');
grid.children[0].dispatch('keydown', { key: 'Enter' });
assert.deepEqual(navigationCalls.pop(), ['club', 0]);
assert.equal(grid.children[0].textContent.includes('<img src=x'), false, 'filtered club data is text, not parsed markup');

const appendClubSidebarLink = compileFunction('appendClubSidebarLink', { document });
const clubSidebarContainer = document.createElement('div');
const renderClubSidebarShortcuts = compileFunction('renderClubSidebarShortcuts', {
    clubSidebarContainer,
    appendClubSidebarLink,
    navigateTo,
    document,
    favorites: [{ type: 'club', id: 1, name: clubs[1].name }],
    clubData,
    recentClubIds: [2],
});
renderClubSidebarShortcuts();
const sidebarButtons = descendants(clubSidebarContainer).filter((element) => element.tagName === 'BUTTON');
assert.deepEqual(sidebarButtons.map((button) => button.textContent), [
    'Vereinsübersicht', 'Verein suchen', clubs[1].name, clubs[2].name,
]);
assert.ok(sidebarButtons.length < clubs.length, 'sidebar does not reproduce the complete catalogue');
sidebarButtons[0].dispatch('click');
assert.deepEqual(navigationCalls.pop(), ['clubList', null]);

const createDisclosureButton = compileFunction('createDisclosureButton', { document });
const sidebarDisclosureContent = document.createElement('div');
const sidebarDisclosure = createDisclosureButton('Vereine', 'club-sidebar-shortcuts', sidebarDisclosureContent, false);
assert.equal(sidebarDisclosure.tagName, 'BUTTON');
assert.equal(sidebarDisclosure.getAttribute('aria-expanded'), 'false');
assert.equal(sidebarDisclosureContent.hidden, true);
sidebarDisclosure.dispatch('click');
assert.equal(sidebarDisclosure.getAttribute('aria-expanded'), 'true');
assert.equal(sidebarDisclosureContent.hidden, false);

const createDisclosureSection = compileFunction('createDisclosureSection', { document, createDisclosureButton });
for (const [id, expanded] of [
    ['current-season-summary', true],
    ['club-league-history', false],
    ['club-cup-history', false],
]) {
    const body = document.createElement('div');
    const section = createDisclosureSection('Bereich', id, body, expanded);
    const trigger = descendants(section).find((element) => element.tagName === 'BUTTON');
    assert.equal(trigger.getAttribute('aria-controls'), id);
    assert.equal(trigger.getAttribute('aria-expanded'), String(expanded));
    assert.equal(body.hidden, !expanded);
    trigger.dispatch('click');
    assert.equal(body.hidden, expanded);
    assert.equal(trigger.getAttribute('aria-expanded'), String(!expanded));
}

const createGameActionsElement = compileFunction('createGameActionsElement', {
    document,
    gameShareText: (game) => `${game.home} gegen ${game.away}`,
    buildGameActions: () => [{
        key: 'preview',
        label: 'Match Preview',
        ariaLabel: 'Match Preview öffnen',
        activate() {},
    }],
});
const createClubMatchesGrid = compileFunction('createClubMatchesGrid', {
    document,
    isClubMatch: (clubName, team) => team === clubName,
    club: clubs[0],
    createGameActionsElement,
});
const rawSchedule = [
    ...Array.from({ length: 7 }, (_, index) => ({
        home: index % 2 ? 'DC Nord' : `Gast ${index}`,
        away: index % 2 ? `Gast ${index}` : 'DC Nord',
        dateStr: `0${index + 2}.09.2026 20:00`,
        leagueName: 'A-Klasse',
        isPending: true,
    })),
    { home: 'DC Nord', away: 'Freilos', dateStr: '01.09.2026 20:00', isPending: true },
];
const upcoming = BwedlAppUtils.selectUpcomingGames(rawSchedule, new Date(2026, 7, 31));
assert.equal(upcoming.length, 7, 'real selector excludes byes before club rendering');
const matchesGrid = createClubMatchesGrid(upcoming, [], '');
const upcomingList = descendants(matchesGrid).find((element) => element.classList.contains('club-upcoming-list'));
const expansion = descendants(matchesGrid).find((element) => element.classList.contains('club-upcoming-toggle'));
assert.equal(upcomingList.children.length, 5, 'five real games render by default');
assert.equal(descendants(upcomingList).filter((element) => element.classList.contains('game-actions')).length, 5);
assert.equal(expansion.getAttribute('aria-expanded'), 'false');
assert.equal(expansion.getAttribute('aria-controls'), upcomingList.id);
expansion.dispatch('click');
assert.equal(upcomingList.children.length, 7, 'expansion restores every real game');
assert.equal(expansion.getAttribute('aria-expanded'), 'true');
assert.equal(expansion.textContent, 'Weniger anzeigen');

const archiveMatchDisplayState = compileFunction('archiveMatchDisplayState');
assert.deepEqual(
    archiveMatchDisplayState({ home: 'DC Nord', away: '', scoreHome: '', scoreAway: '' }, true),
    { incomplete: true, label: 'Daten unvollständig' },
);
assert.deepEqual(
    archiveMatchDisplayState({ home: 'Freilos', away: 'Freilos', isFreilos: true }, true),
    { incomplete: false, label: 'Freilos' },
);
const createArchiveMatchResult = compileFunction('createArchiveMatchResult', {
    document,
    archiveMatchDisplayState,
});
const incompleteResult = createArchiveMatchResult(
    { home: 'DC Nord', away: '', scoreHome: '', scoreAway: '' },
    true,
);
assert.equal(incompleteResult.tagName, 'SPAN');
assert.equal(incompleteResult.textContent, 'Daten unvollständig');
assert.equal(incompleteResult.getAttribute('role'), 'status');
assert.equal(incompleteResult.classList.contains('incomplete-data'), true);

const clubSidebarBlock = source.slice(source.indexOf('// 3. Clubs'), source.indexOf('// 4. Comparison'));
assert.match(clubSidebarBlock, /createDisclosureButton/);
assert.doesNotMatch(clubSidebarBlock, /createElement\(['"]div['"]\)[\s\S]*?header\.addEventListener\(['"]click['"]/);
const clubSource = extractFunction('renderClub');
assert.match(clubSource, /createDisclosureSection\(\s*['"]Vereinsinfos & Kontakt['"]/);
assert.doesNotMatch(clubSource, /onclick="this\.nextElementSibling/);
assert.doesNotMatch(source, /selectUpcomingGames\(upcoming(?:League|Ligapokal)Matches,[^;\r\n]*\)\.slice\(0, 5\)/);
assert.match(styles, /\.club-sidebar-disclosure\s*\{[^}]*border:\s*0;/s);
assert.match(styles, /\.club-upcoming-toggle/);
assert.match(styles, /\.club-contact-grid/);
assert.match(styles, /\.archive-freilos/);

console.log('club experience production DOM contracts passed');
