const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'bundle_v31.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const BwedlAppUtils = require('../app_utils.js');
const currentRankingData = require('../ranking_data.json');
const currentClubData = require('../club_data.json');

const players = [
    { name: 'Charlie', company: 'DC Drei', officialRank: 3, totalPoints: 30, average: 10, games: 3 },
    { name: 'Alice', company: 'DC Eins', officialRank: 1, totalPoints: 20, average: 10, games: 2 },
    { name: 'Bob', company: 'DC Zwei', officialRank: 2, totalPoints: 30, average: 15, games: 2 },
    { name: 'Berta', company: 'Suchverein', officialRank: 4, totalPoints: 30, average: 15, games: 2 },
];

const before = JSON.stringify(players);
const names = (values) => values.map((player) => player.name);
assert.deepEqual(names(BwedlAppUtils.filterAndSortRanking(players)), ['Alice', 'Bob', 'Charlie', 'Berta']);
assert.deepEqual(names(BwedlAppUtils.filterAndSortRanking(players, { sort: 'points' })), ['Bob', 'Charlie', 'Berta', 'Alice']);
assert.deepEqual(names(BwedlAppUtils.filterAndSortRanking(players, { sort: 'average' })), ['Bob', 'Berta', 'Alice', 'Charlie']);
assert.deepEqual(names(BwedlAppUtils.filterAndSortRanking(players, { sort: 'games' })), ['Charlie', 'Alice', 'Bob', 'Berta']);
assert.deepEqual(names(BwedlAppUtils.filterAndSortRanking(players, { query: 'suchVEREIN' })), ['Berta']);
assert.deepEqual(names(BwedlAppUtils.filterAndSortRanking(players, { minGames: 3 })), ['Charlie']);
assert.equal(JSON.stringify(players), before, 'filtering and sorting must not mutate the input');

const exactTie = [
    { name: 'First input', officialRank: 7, totalPoints: 10, average: 2, games: 5 },
    { name: 'Second input', officialRank: 7, totalPoints: 10, average: 2, games: 5 },
];
assert.deepEqual(names(BwedlAppUtils.filterAndSortRanking(exactTie, { sort: 'points' })), ['First input', 'Second input']);

const currentPlayersBefore = JSON.stringify(currentRankingData.players);
const enrichedCurrentPlayers = BwedlAppUtils.enrichRankingPlayersWithClubs(
    currentRankingData.players,
    currentClubData.clubs,
);
const oststadtPlayers = BwedlAppUtils.filterAndSortRanking(enrichedCurrentPlayers, {
    query: 'DC Oststadt',
});
assert.equal(oststadtPlayers.length, 19, 'current V-Nr. data resolves every DC Oststadt player');
assert.equal(oststadtPlayers.every((player) => player.clubName === 'DC Oststadt'), true);
assert.equal(JSON.stringify(currentRankingData.players), currentPlayersBefore, 'club enrichment does not mutate source players');
const ambiguousClubs = BwedlAppUtils.enrichRankingPlayersWithClubs(
    [{ name: 'Spieler', v_nr: '007' }, { name: 'Ohne Verein', v_nr: '999' }],
    [{ number: '007', name: 'Club A' }, { number: '007', name: 'Club B' }],
);
assert.equal(ambiguousClubs[0].clubName, undefined, 'duplicate club numbers are not guessed');
assert.equal(ambiguousClubs[0].clubIndex, undefined);
assert.equal(ambiguousClubs[1].clubName, undefined, 'missing club numbers remain unresolved');

assert.equal(BwedlAppUtils.canonicalRankingPlayerName('  CAFE\u0301   SPIELER '), 'café spieler');
assert.deepEqual(
    BwedlAppUtils.matchRankingPlayer([{ name: 'Café Spieler' }], '  CAFE\u0301   SPIELER '),
    { status: 'found', player: { name: 'Café Spieler' } },
);
assert.deepEqual(
    BwedlAppUtils.matchRankingPlayer(
        [{ name: 'Anna  Müller' }, { name: 'anna müller' }],
        'ANNA MÜLLER',
    ),
    { status: 'ambiguous', player: null },
);

function findClosingBrace(openingBrace, label) {
    let depth = 0;
    let state = 'code';
    for (let index = openingBrace; index < source.length; index += 1) {
        const character = source[index];
        const nextCharacter = source[index + 1];
        if (state === 'line-comment') { if (character === '\n') state = 'code'; continue; }
        if (state === 'block-comment') {
            if (character === '*' && nextCharacter === '/') { state = 'code'; index += 1; }
            continue;
        }
        if (state !== 'code') {
            if (character === '\\') index += 1;
            else if ((state === 'single' && character === "'") || (state === 'double' && character === '"') || (state === 'template' && character === '`')) state = 'code';
            continue;
        }
        if (character === '/' && nextCharacter === '/') { state = 'line-comment'; index += 1; }
        else if (character === '/' && nextCharacter === '*') { state = 'block-comment'; index += 1; }
        else if (character === "'") state = 'single';
        else if (character === '"') state = 'double';
        else if (character === '`') state = 'template';
        else if (character === '{') depth += 1;
        else if (character === '}' && --depth === 0) return index;
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
    const dependencyNames = Object.keys(dependencies);
    return Function(...dependencyNames, `${extractFunction(name)}; return ${name};`)(
        ...dependencyNames.map((dependency) => dependencies[dependency]),
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
            this.dataset = {};
            this.className = '';
            this.value = '';
            this._textContent = '';
            this.classList = {
                add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
                contains: (name) => this.className.split(/\s+/).includes(name),
            };
        }
        set id(value) { this._id = value; if (value) byId.set(value, this); }
        get id() { return this._id || ''; }
        set textContent(value) { this._textContent = String(value); this.children = []; }
        get textContent() { return this._textContent + this.children.map((child) => child.textContent).join(''); }
        set innerHTML(value) { this.usedInnerHTML = true; this._textContent = String(value); this.children = []; }
        get innerHTML() { return this._textContent; }
        get firstChild() { return this.children[0] || null; }
        get firstElementChild() { return this.children[0] || null; }
        appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
        append(...children) { children.forEach((child) => this.appendChild(child)); }
        replaceChildren(...children) { this.children.forEach((child) => { child.parentElement = null; }); this.children = []; this.append(...children); }
        insertBefore(child, before) { const index = this.children.indexOf(before); if (index < 0) return this.appendChild(child); this.children.splice(index, 0, child); child.parentElement = this; return child; }
        setAttribute(name, value) { this.attributes[name] = String(value); }
        getAttribute(name) { return this.attributes[name] ?? null; }
        addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
        dispatch(type, init = {}) { const event = { target: this, currentTarget: this, preventDefault() {}, ...init }; (this.listeners[type] || []).forEach((listener) => listener(event)); }
        focus() { this.focused = true; }
        scrollIntoView(options) { this.scrolledWith = options; }
    }
    return {
        createElement: (tagName) => new Element(tagName),
        createDocumentFragment: () => new Element('#fragment'),
        getElementById: (id) => byId.get(id) || null,
    };
}

function descendants(root) { return [root, ...root.children.flatMap(descendants)]; }

const document = createDocument();
const contentArea = document.createElement('main');
const topBarTitle = document.createElement('h1');
const rankingData = { players: [
    { name: '<img src=x onerror=alert(1)>', league: 'A-Klasse', rank: '3a', points: '30', company: 'DC Drei', v_nr: '003', rounds: { R1: 10, R2: 10, R3: 10 } },
    { name: 'Café Spieler', league: 'A-Klasse', rank: '1', points: '20', company: 'DC Eins', v_nr: '001', rounds: { R1: 10, R2: 10 } },
    { name: 'Bob', league: 'A-Klasse', rank: '2', points: '30', company: 'DC Zwei', v_nr: '002', rounds: { R1: 15, R2: 15 } },
] };
const clubData = { clubs: [
    { number: '001', name: 'DC Eins' },
    { number: '002', name: 'DC Zwei' },
    { number: '003', name: 'DC Drei' },
] };
const seasonNotice = document.createElement('aside');
seasonNotice.textContent = 'Vorjahresstand 2025/26';
const window = { BwedlAppUtils, matchMedia: () => ({ matches: true }) };
const renderRanking = compileFunction('renderRanking', {
    topBarTitle,
    contentArea,
    document,
    rankingData,
    clubData,
    myPlayerName: '  CAFE\u0301   SPIELER ',
    createSeasonNotice: () => seasonNotice,
    calculateTotalPoints: (player) => Number(player.points),
    calculatePlayerStats: (player) => {
        const values = Object.values(player.rounds || {}).map(Number).filter(Number.isFinite);
        return { count: values.length, avg: values.reduce((sum, value) => sum + value, 0) / (values.length || 1) };
    },
    navigateTo() {},
    window,
});

renderRanking('A-Klasse');
const root = contentArea.firstChild;
assert.equal(root.firstChild, seasonNotice, 'season notice remains first');
const search = document.getElementById('ranking-player-search');
const sort = document.getElementById('ranking-sort');
const minGames = document.getElementById('ranking-min-games');
const mine = document.getElementById('ranking-my-position');
const status = document.getElementById('ranking-tools-status');
assert.ok(search && sort && minGames && mine && status, 'accessible ranking controls render');
assert.equal(status.getAttribute('aria-live'), 'polite');
assert.match(sort.textContent, /Offizielle Reihenfolge/);
assert.match(sort.textContent, /Analyseansicht: Punkte/);

const tbody = descendants(root).find((element) => element.tagName === 'TBODY');
const rowNames = () => tbody.children.map((row) => row.dataset.playerName);
const shownRanks = () => tbody.children.map((row) => row.children[0].textContent.trim());
assert.deepEqual(rowNames(), ['Café Spieler', 'Bob', '<img src=x onerror=alert(1)>']);
assert.deepEqual(shownRanks(), ['1', '2', '3a'], 'official rank labels are displayed verbatim from source data');
assert.equal(tbody.children[0].classList.contains('my-player-row'), true);
assert.equal(descendants(tbody).some((element) => element.usedInnerHTML), false, 'visible rows are rebuilt without HTML injection');
assert.equal(descendants(tbody).some((element) => element.tagName === 'IMG'), false);

search.value = 'Bob';
search.dispatch('input');
assert.deepEqual(rowNames(), ['Bob']);
sort.value = 'points';
sort.dispatch('change');
search.value = '';
search.dispatch('input');
assert.deepEqual(rowNames(), ['Bob', '<img src=x onerror=alert(1)>', 'Café Spieler']);
assert.deepEqual(shownRanks(), ['2', '3a', '1'], 'analysis order never rewrites official ranks');

minGames.value = '3';
minGames.dispatch('input');
assert.deepEqual(rowNames(), ['<img src=x onerror=alert(1)>']);
search.value = 'niemand';
search.dispatch('input');
mine.dispatch('click');
assert.equal(search.value, '');
assert.equal(minGames.value, '0');
const savedRow = tbody.children.find((row) => row.dataset.playerName === 'Café Spieler');
assert.ok(savedRow);
assert.equal(savedRow.focused, true);
assert.deepEqual(savedRow.scrolledWith, { behavior: 'auto', block: 'center' });

rankingData.players = rankingData.players.filter((player) => player.name !== 'Café Spieler');
renderRanking('A-Klasse');
document.getElementById('ranking-my-position').dispatch('click');
assert.match(document.getElementById('ranking-tools-status').textContent, /nicht in dieser Rangliste/i);
assert.equal(typeof global.alert, 'undefined', 'missing saved players use live feedback, not alerts');

const collisionData = { players: [
    { name: 'Anna  Müller', league: 'A-Klasse', rank: '1', points: '10', rounds: { R1: 10 } },
    { name: 'anna müller', league: 'A-Klasse', rank: '2', points: '9', rounds: { R1: 9 } },
] };
const collisionRender = compileFunction('renderRanking', {
    topBarTitle,
    contentArea,
    document,
    rankingData: collisionData,
    clubData: { clubs: [] },
    myPlayerName: 'ANNA MÜLLER',
    createSeasonNotice: () => null,
    calculateTotalPoints: (player) => Number(player.points),
    calculatePlayerStats: (player) => ({ count: 1, avg: Number(player.points) }),
    navigateTo() {},
    window,
});
collisionRender('A-Klasse');
const collisionRows = descendants(contentArea.firstChild).find((element) => element.tagName === 'TBODY').children;
assert.equal(collisionRows.some((row) => row.classList.contains('my-player-row')), false, 'ambiguous canonical names highlight no row');
document.getElementById('ranking-my-position').dispatch('click');
assert.match(document.getElementById('ranking-tools-status').textContent, /nicht eindeutig/i);

class MaliciousRankingDOMParser {
    parseFromString(value, type) {
        assert.match(value, /onerror/);
        assert.equal(type, 'text/html');
        const thead = { tagName: 'THEAD' };
        const tbody = { tagName: 'TBODY' };
        const cell = (tagName, textContent) => ({
            tagName,
            textContent,
            getAttribute() { return null; },
        });
        const rows = [
            { parentElement: thead, children: [
                cell('TH', 'Rang<script>alert(1)</script>'),
                cell('TH', 'Name'),
            ] },
            { parentElement: tbody, children: [
                cell('TD', '1'),
                cell('TD', 'Spieler <img src=x onerror=alert(2)>'),
            ] },
        ];
        const table = {
            querySelectorAll(selector) {
                assert.equal(selector, 'tr');
                return rows;
            },
        };
        rows.forEach((row) => { row.closest = () => table; });
        return {
            querySelectorAll(selector) {
                assert.equal(selector, 'table');
                return [table];
            },
        };
    }
}
const fallbackDocument = createDocument();
const fallbackParser = compileFunction('parseInertHtmlDocument', { DOMParser: MaliciousRankingDOMParser });
const fallbackSpan = compileFunction('safePublishedSpan');
const fallbackModels = compileFunction('safeTableModelsFromHtml', {
    parseInertHtmlDocument: fallbackParser,
    safePublishedSpan: fallbackSpan,
});
const fallbackModelTable = compileFunction('createSafeTableFromModel', { document: fallbackDocument });
const fallbackTables = compileFunction('createSafeTablesFromHtml', {
    document: fallbackDocument,
    safeTableModelsFromHtml: fallbackModels,
    createSafeTableFromModel: fallbackModelTable,
});
const safeFallbackTable = compileFunction('createSafeTableFromHtml', {
    document: fallbackDocument,
    createSafeTablesFromHtml: fallbackTables,
});
const fallbackContent = fallbackDocument.createElement('main');
const fallbackNotice = fallbackDocument.createElement('aside');
fallbackNotice.textContent = 'Vorjahresstand';
const fallbackRender = compileFunction('renderRanking', {
    topBarTitle: fallbackDocument.createElement('h1'),
    contentArea: fallbackContent,
    document: fallbackDocument,
    rankingData: {
        players: [],
        rankings: { 'A-Klasse': '<table onclick="alert(3)"><tr><th>Rang<script>alert(1)</script></th><th>Name</th></tr><tr><td>1</td><td><img src=x onerror=alert(2)>Spieler</td></tr></table>' },
    },
    clubData: { clubs: [] },
    myPlayerName: null,
    createSeasonNotice: () => fallbackNotice,
    calculateTotalPoints() {},
    calculatePlayerStats() {},
    navigateTo() {},
    createSafeTableFromHtml: safeFallbackTable,
    window,
});
fallbackRender('A-Klasse');
const fallbackRoot = fallbackContent.firstChild;
assert.equal(fallbackRoot.firstChild, fallbackNotice, 'fallback preserves the season notice');
assert.equal(descendants(fallbackRoot).filter((element) => element.tagName === 'TH').length, 2);
assert.equal(descendants(fallbackRoot).filter((element) => element.tagName === 'TD').length, 2);
assert.match(fallbackRoot.textContent, /Rang<script>alert\(1\)<\/script>.*Spieler <img src=x onerror=alert\(2\)>/);
assert.equal(descendants(fallbackRoot).some((element) => element.usedInnerHTML), false);
assert.equal(descendants(fallbackRoot).some((element) => ['IMG', 'SCRIPT', 'SVG', 'STYLE', 'A'].includes(element.tagName)), false);
assert.equal(descendants(fallbackRoot).some((element) => Object.keys(element.attributes).some((name) => /^on/i.test(name))), false);

assert.match(styles, /\.ranking-toolbar\s*\{/);
assert.match(styles, /@media \(max-width: 1280px\)[\s\S]*?\.ranking-toolbar/s);
assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.ranking-toolbar/s);
assert.match(styles, /\.ranking-analysis-label/);

console.log('ranking tools production DOM contracts passed');
