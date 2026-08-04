const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'bundle_v31.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const BwedlAppUtils = require('../app_utils.js');

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
    return { createElement: (tagName) => new Element(tagName), getElementById: (id) => byId.get(id) || null };
}

function descendants(root) { return [root, ...root.children.flatMap(descendants)]; }

const document = createDocument();
const contentArea = document.createElement('main');
const topBarTitle = document.createElement('h1');
const rankingData = { players: [
    { name: '<img src=x onerror=alert(1)>', league: 'A-Klasse', rank: '3a', points: '30', company: 'DC Drei', v_nr: '003', rounds: { R1: 10, R2: 10, R3: 10 } },
    { name: 'Gespeicherter Spieler', league: 'A-Klasse', rank: '1', points: '20', company: 'DC Eins', v_nr: '001', rounds: { R1: 10, R2: 10 } },
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
    myPlayerName: 'Gespeicherter Spieler',
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
assert.deepEqual(rowNames(), ['Gespeicherter Spieler', 'Bob', '<img src=x onerror=alert(1)>']);
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
assert.deepEqual(rowNames(), ['Bob', '<img src=x onerror=alert(1)>', 'Gespeicherter Spieler']);
assert.deepEqual(shownRanks(), ['2', '3a', '1'], 'analysis order never rewrites official ranks');

minGames.value = '3';
minGames.dispatch('input');
assert.deepEqual(rowNames(), ['<img src=x onerror=alert(1)>']);
search.value = 'niemand';
search.dispatch('input');
mine.dispatch('click');
assert.equal(search.value, '');
assert.equal(minGames.value, '0');
const savedRow = tbody.children.find((row) => row.dataset.playerName === 'Gespeicherter Spieler');
assert.ok(savedRow);
assert.equal(savedRow.focused, true);
assert.deepEqual(savedRow.scrolledWith, { behavior: 'auto', block: 'center' });

rankingData.players = rankingData.players.filter((player) => player.name !== 'Gespeicherter Spieler');
renderRanking('A-Klasse');
document.getElementById('ranking-my-position').dispatch('click');
assert.match(document.getElementById('ranking-tools-status').textContent, /nicht in dieser Rangliste/i);
assert.equal(typeof global.alert, 'undefined', 'missing saved players use live feedback, not alerts');

assert.match(styles, /\.ranking-toolbar\s*\{/);
assert.match(styles, /@media \(max-width: 1280px\)[\s\S]*?\.ranking-toolbar/s);
assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.ranking-toolbar/s);
assert.match(styles, /\.ranking-analysis-label/);

console.log('ranking tools production DOM contracts passed');
