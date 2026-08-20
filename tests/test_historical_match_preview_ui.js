const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'bundle_v31.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const BwedlAppUtils = require('../app_utils.js');

function findClosingBrace(openingBrace, label) {
    let depth = 0;
    let state = 'code';
    for (let index = openingBrace; index < source.length; index += 1) {
        const character = source[index];
        const next = source[index + 1];
        if (state === 'line') { if (character === '\n') state = 'code'; continue; }
        if (state === 'block') { if (character === '*' && next === '/') { state = 'code'; index += 1; } continue; }
        if (state !== 'code') {
            if (character === '\\') index += 1;
            else if ((state === 'single' && character === "'") || (state === 'double' && character === '"') || (state === 'template' && character === '`')) state = 'code';
            continue;
        }
        if (character === '/' && next === '/') { state = 'line'; index += 1; }
        else if (character === '/' && next === '*') { state = 'block'; index += 1; }
        else if (character === "'") state = 'single';
        else if (character === '"') state = 'double';
        else if (character === '`') state = 'template';
        else if (character === '{') depth += 1;
        else if (character === '}' && --depth === 0) return index;
    }
    assert.fail(`Expected complete ${label}`);
}

function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `Expected ${name}`);
    const opening = source.indexOf('{', start);
    return source.slice(start, findClosingBrace(opening, name) + 1);
}

function createDocument() {
    function selectorMatches(element, selector) {
        if (selector.startsWith('#')) return element.id === selector.slice(1);
        if (selector.startsWith('.')) return element.className.split(/\s+/).includes(selector.slice(1));
        const attr = selector.match(/^([a-z]+)?\[([^=\]]+)(?:="([^"]*)")?\]$/i);
        if (attr) {
            const tagMatches = !attr[1] || element.tagName === attr[1].toUpperCase();
            const dataKey = attr[2].startsWith('data-')
                ? attr[2].slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())
                : null;
            const actual = attr[2] === 'type' ? element.type : dataKey ? element.dataset[dataKey] : element.attributes[attr[2]];
            return tagMatches && actual !== undefined && (attr[3] === undefined || String(actual) === attr[3]);
        }
        return element.tagName === selector.toUpperCase();
    }

    class Element {
        constructor(tagName, document) {
            this.tagName = tagName.toUpperCase();
            this.ownerDocument = document;
            this.children = [];
            this.parentElement = null;
            this.className = '';
            this.id = '';
            this.value = '';
            this.type = '';
            this.checked = false;
            this.disabled = false;
            this.dataset = {};
            this.attributes = {};
            this.listeners = {};
            this.style = {};
            this._text = '';
            this.classList = {
                add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
                remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(' '); },
                contains: (name) => this.className.split(/\s+/).includes(name),
            };
        }
        set textContent(value) { this._text = String(value ?? ''); this.children = []; }
        get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
        set innerHTML(value) { this._innerHTML = String(value); this._text = ''; this.children = []; }
        get innerHTML() { return this._innerHTML || ''; }
        get firstChild() { return this.children[0] || null; }
        get options() { return this.children.filter((child) => child.tagName === 'OPTION'); }
        appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
        append(...children) { children.forEach((child) => this.appendChild(child)); }
        insertBefore(child, reference) {
            const index = this.children.indexOf(reference);
            if (reference === null) return this.appendChild(child);
            assert.notEqual(index, -1);
            this.children.splice(index, 0, child); child.parentElement = this; return child;
        }
        remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); }
        setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') this.id = String(value); if (name === 'type') this.type = String(value); }
        addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
        dispatchEvent(event) { event.target ||= this; for (const handler of this.listeners[event.type] || []) handler(event); return true; }
        querySelectorAll(selector) { return this.children.flatMap((child) => [...(selectorMatches(child, selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        closest(selector) { let current = this; while (current) { if (selectorMatches(current, selector)) return current; current = current.parentElement; } return null; }
        contains(target) { return target === this || this.children.some((child) => child.contains(target)); }
        scrollIntoView() {}
    }
    const document = {
        root: null,
        createElement(tagName) { return new Element(tagName, document); },
        getElementById(id) { return document.root && (document.root.id === id ? document.root : document.root.querySelector(`#${id}`)); },
        querySelectorAll(selector) { return document.root ? document.root.querySelectorAll(selector) : []; },
    };
    return document;
}

function player(id, name, evidence, confidence, rating, extra = {}) {
    return {
        id, name, evidence, confidence, adjustedRating: rating, rating,
        currentAppearances: evidence.startsWith('current') ? 6 : 0,
        rounds: { R1: '40', R2: '44' }, sourceSeasons: ['2025/26'],
        rosterUnconfirmed: evidence.startsWith('historical'), ...extra,
    };
}

function makeModel(calibrated) {
    const calls = { calibration: 0, training: 0, outcome: 0, roster: 0, rosterOptions: [], complete: [], forecast: 0 };
    const rosters = {
        '035': [
            player('h1', '<img src=x onerror=alert(1)>', 'current+history', 'medium', 48, { historicalPrior: { seasons: [{ sourceClass: 'A', targetClass: 'B' }] } }),
            player('h2', 'Historische Hanne', 'historical', 'provisional', 46),
            player('h3', 'Ersatz Eva', 'historical-fallback', 'very-low', 44),
            player('h4', 'Aktuelle Anna', 'current', 'high', 42),
        ],
        '036': [
            player('a1', 'Gast Eins', 'current', 'high', 41),
            player('a2', 'Gast Zwei', 'current+history', 'medium', 40),
            player('a3', 'Gast Drei', 'historical', 'provisional', 39),
            player('a4', 'Gast Vier', 'current', 'high', 38),
        ],
    };
    return {
        calls,
        buildClassCalibration() { calls.calibration += 1; return { kind: 'calibration' }; },
        buildOutcomeTrainingExamples(options) { calls.training += 1; assert.ok(Array.isArray(options.clubs)); return []; },
        calibrateOutcomeModel() { calls.outcome += 1; return { calibrated }; },
        buildTeamRoster(options) {
            calls.roster += 1;
            calls.rosterOptions.push(options);
            assert.equal(options.currentDatasetSeason, '2025/26');
            return { players: rosters[options.teamId] || [], classMean: 35, classMeanAvailable: true, teamConfidence: 'provisional', diagnostics: {} };
        },
        completeLineup(known, options = {}) {
            calls.complete.push({ ids: known.map((item) => item.id), manual: options.manual === true });
            const result = known.slice(0, 4).map((item) => ({ ...item }));
            while (result.length < 4) result.push(player(`neutral-${result.length}`, 'Unbekannter Spieler (Klassenwert)', 'neutral', 'very-low', options.classMean || 35));
            result.teamConfidence = result.filter((item) => item.evidence === 'neutral').length >= 2 ? 'very-low' : 'provisional';
            return result;
        },
        forecastMatch(home, away) {
            calls.forecast += 1;
            assert.equal(home.length, 4); assert.equal(away.length, 4);
            if (!calibrated) return { mode: 'relative', homeScore: 44, awayScore: 40, relative: { homeShare: 0.524, awayShare: 0.476 }, teamConfidence: 'very-low', uncertaintyText: 'Relative Aufstellungsstärke mit unsicherer Datenbasis' };
            return { mode: 'probability', home: 0.456, draw: 0.211, away: 0.333, low: { home: 0.35, draw: 0.12, away: 0.23 }, high: { home: 0.56, draw: 0.31, away: 0.44 }, homeScore: 44, awayScore: 40, teamConfidence: 'provisional' };
        },
    };
}

function renderScenario(calibrated = true) {
    const document = createDocument();
    const contentArea = document.createElement('main');
    document.root = contentArea;
    const topBarTitle = document.createElement('div');
    const model = makeModel(calibrated);
    const window = { BwedlMatchPreviewModel: model, ARCHIVE_TABLES: [] };
    const rankingPlayers = [];
    const bindings = {
        document, contentArea, topBarTitle, window,
        leagueData: { leagues: { 'B-Klasse 2026-2027': { table: '<table></table>' } } },
        rankingData: { players: rankingPlayers }, archiveData: {},
        clubData: { clubs: [{ number: '035', name: 'Alpha' }, { number: '036', name: 'Bravo' }] },
        dataStatus: { domains: { rankings: { season: '2025/26', state: 'retained' } } },
        detectNextMatch: () => [], readMatchPreviewGame: () => null,
        BwedlAppUtils: { ...BwedlAppUtils, mergeMatchPreviewGames: () => [], buildMatchPreviewTeams: () => [{ id: '035', name: 'Alpha' }, { id: '036', name: 'Bravo' }] },
        createSeasonNotice: () => null,
        safeTableRowsFromHtml: () => [['1', 'Alpha', '0'], ['2', 'Bravo', '0']],
        findHistoricalResults: () => ({ matches: [] }),
        isMyPlayerRecord: () => false, calculateOptimalLineup: () => ({ players: [], avg: 0 }),
        getPlayerFormTrend: () => ({ trend: 'flat', values: [], lastNAvg: 0 }), renderMatchSparkline: () => '',
        escapeHtmlText: BwedlAppUtils.escapeHtmlText,
        setTimeout: (callback) => callback(), setAppStatus() {}, Event: class Event { constructor(type) { this.type = type; } },
    };
    const render = Function(...Object.keys(bindings), `${extractFunction('renderMatchPreview')}; return renderMatchPreview;`)(...Object.values(bindings));
    render();
    const selects = contentArea.querySelectorAll('SELECT');
    assert.equal(selects.length, 3);
    selects[0].value = 'B-Klasse 2026-2027';
    selects[0].dispatchEvent({ type: 'change' });
    selects[1].value = '035'; selects[2].value = '036';
    selects[1].dispatchEvent({ type: 'change' });
    selects[2].dispatchEvent({ type: 'change' });
    return { document, contentArea, model, render, selects, rankingPlayers };
}

{
    const scenario = renderScenario(true);
    assert.deepEqual({ calibration: scenario.model.calls.calibration, training: scenario.model.calls.training, outcome: scenario.model.calls.outcome }, { calibration: 1, training: 1, outcome: 1 });
    assert.equal(scenario.model.calls.rosterOptions.every((options) => options.currentPlayers === scenario.rankingPlayers), true);
    const text = scenario.contentArea.textContent;
    for (const expected of ['Vorjahreskader', 'Klassenwechsel: A → B', 'Kaderzugehörigkeit unbestätigt', 'Datenqualität: vorläufig']) assert.match(text, new RegExp(expected));
    assert.equal(scenario.contentArea.querySelectorAll('INPUT').filter((input) => input.checked).length, 8);
    assert.equal(scenario.document.getElementById('list-a').querySelectorAll('INPUT').filter((input) => input.checked).length, 4);
    assert.equal(scenario.document.getElementById('list-b').querySelectorAll('INPUT').filter((input) => input.checked).length, 4);
    assert.equal(scenario.contentArea.querySelectorAll('[data-evidence]').length, 8);
    assert.equal(scenario.contentArea.querySelectorAll('IMG').length, 0, 'player names must stay inert text');
    const homeChecks = scenario.document.getElementById('list-a').querySelectorAll('INPUT');
    homeChecks[0].checked = false;
    homeChecks[0].dispatchEvent({ type: 'change', target: homeChecks[0], preventDefault() {} });
    scenario.contentArea.querySelector('.match-preview-calculate').dispatchEvent({ type: 'click' });
    assert.match(scenario.document.getElementById('preview-results').textContent, /Unbekannter Spieler \(Klassenwert\)/);
    assert.equal(scenario.model.calls.complete.at(-2).manual, true);
    assert.deepEqual(scenario.model.calls.complete.at(-2).ids, ['h2', 'h3', 'h4']);
    const result = scenario.document.getElementById('preview-results').textContent;
    assert.match(result, /Heimsieg 46%/); assert.match(result, /Unentschieden 21%/); assert.match(result, /Auswärtssieg 33%/);
    assert.equal([...result.matchAll(/(?:Heimsieg|Unentschieden|Auswärtssieg) (\d+)%/g)].slice(0, 3).reduce((sum, match) => sum + Number(match[1]), 0), 100);
    assert.match(result, /Plausibler Bereich/);
    assert.match(result, /Aktuelle Form/);
    assert.match(result, /Historische Form/);
    scenario.render();
    assert.equal(scenario.contentArea.querySelectorAll('.match-preview-shell').length, 1, 'rerender must replace rather than duplicate preview DOM');
}

{
    const scenario = renderScenario(false);
    scenario.contentArea.querySelector('.match-preview-calculate').dispatchEvent({ type: 'click' });
    const result = scenario.document.getElementById('preview-results').textContent;
    assert.match(result, /Relative Aufstellungsstärke/);
    assert.doesNotMatch(result, /% Siegchance|Heimsieg \d+%|Auswärtssieg \d+%/);
}

for (const selector of ['.match-preview-shell', '.match-preview-team-grid', '.match-preview-player', '.match-preview-evidence', '.match-preview-lineup-grid', '.match-preview-probability-grid']) {
    assert.match(styles, new RegExp(selector.replace('.', '\\.') + '\\s*\\{'));
}
assert.match(styles, /@media\s*\(max-width:\s*390px\)/);
assert.match(styles, /min-height:\s*44px/);
assert.match(styles, /prefers-reduced-motion:\s*reduce/);
assert.doesNotMatch(source.slice(source.indexOf('function renderMatchPreview('), source.indexOf('window.triggerUpdate')), /\/api\//);

console.log('historical match preview UI contract: ok');
