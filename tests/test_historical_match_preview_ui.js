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
            this._rect = { left: 0, width: 0 };
            this.scrollIntoViewCalls = [];
            this.focusCalls = 0;
            this._text = '';
            this.classList = {
                add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
                remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(' '); },
                contains: (name) => this.className.split(/\s+/).includes(name),
            };
        }
        set textContent(value) { this._text = String(value ?? ''); this.children = []; }
        get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
        set innerHTML(value) {
            this._innerHTML = String(value);
            this._text = '';
            this.children = [];
            const hostileTags = [...this._innerHTML.matchAll(/<(img|svg|script)\b/giu)];
            if (hostileTags.length) {
                this.ownerDocument.usedUnsafePlayerHtml = true;
                hostileTags.forEach((match) => this.appendChild(new Element(match[1], this.ownerDocument)));
            }
        }
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
        removeAttribute(name) { delete this.attributes[name]; }
        addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
        dispatchEvent(event) { event.target ||= this; for (const handler of this.listeners[event.type] || []) handler(event); return true; }
        querySelectorAll(selector) { return this.children.flatMap((child) => [...(selectorMatches(child, selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        closest(selector) { let current = this; while (current) { if (selectorMatches(current, selector)) return current; current = current.parentElement; } return null; }
        contains(target) { return target === this || this.children.some((child) => child.contains(target)); }
        scrollIntoView(options) {
            const call = options || {};
            this.scrollIntoViewCalls.push(call);
            this.ownerDocument.scrollCalls.push(call);
        }
        focus() { this.focusCalls += 1; this.ownerDocument.focusedElement = this; }
        getBoundingClientRect() { return this._rect; }
    }
    const document = {
        root: null,
        usedUnsafePlayerHtml: false,
        scrollCalls: [],
        focusedElement: null,
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

function makeModel(calibrated, comparisonPercents = [], comparisonOutputs = []) {
    const calls = { calibration: 0, training: 0, outcome: 0, roster: 0, rosterOptions: [], complete: [], forecast: 0, pairStrength: 0 };
    const rosters = {
        '035': [
            player('h1', `<img src=x onerror=alert(1)>${'A'.repeat(500)}`, 'current+history', 'medium', 48, {
                sourceSeasons: ['2025/26'],
                sourceClasses: ['Bezirksliga', 'A-Klasse'],
                historicalPrior: {
                    seasons: [{ sourceClass: 'NICHT AUS ROHDATEN', targetClass: 'NICHT AUS ROHDATEN' }],
                    segments: [{ league: '<script>raw segment</script>' }],
                },
            }),
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
            return { players: rosters[options.teamId] || [], targetClass: 'B-Klasse', classMean: 35, classMeanAvailable: true, teamConfidence: 'provisional', diagnostics: {} };
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
        comparePairStrength(homeSlot, awaySlot) {
            const comparisonIndex = calls.pairStrength++;
            if (Object.hasOwn(comparisonOutputs, comparisonIndex)) {
                const configuredOutput = comparisonOutputs[comparisonIndex];
                return typeof configuredOutput === 'function' ? configuredOutput() : configuredOutput;
            }
            const configuredPercent = comparisonPercents[comparisonIndex];
            if (Number.isInteger(configuredPercent)) {
                return {
                    homeShare: configuredPercent / 100,
                    awayShare: (100 - configuredPercent) / 100,
                    homePercent: configuredPercent,
                    awayPercent: 100 - configuredPercent,
                    uncertain: false,
                };
            }
            const homeRating = Number(homeSlot && homeSlot.adjustedRating);
            const awayRating = Number(awaySlot && awaySlot.adjustedRating);
            const total = homeRating + awayRating;
            if (!Number.isFinite(homeRating) || homeRating <= 0 || !Number.isFinite(awayRating) || awayRating <= 0 || !Number.isFinite(total) || total <= 0) {
                return { homeShare: 0.5, awayShare: 0.5, homePercent: 50, awayPercent: 50, uncertain: true };
            }
            const homeShare = homeRating / total;
            const uncertain = [homeSlot, awaySlot].some((slot) => slot
                && (slot.confidence === 'very-low'
                    || slot.evidence === 'neutral'
                    || slot.evidence === 'historical-fallback'
                    || slot.rosterUnconfirmed === true));
            const homePercent = Math.round(homeShare * 100);
            return { homeShare, awayShare: 1 - homeShare, homePercent, awayPercent: 100 - homePercent, uncertain };
        },
    };
}

{
    const model = makeModel(true);
    assert.deepEqual(model.comparePairStrength(
        { adjustedRating: 60, confidence: 'high', evidence: 'current' },
        { adjustedRating: 40, confidence: 'medium', evidence: 'current+history' },
    ), { homeShare: 0.6, awayShare: 0.4, homePercent: 60, awayPercent: 40, uncertain: false });
    assert.equal(model.comparePairStrength(
        { adjustedRating: 60, confidence: 'very-low', evidence: 'current' },
        { adjustedRating: 40, confidence: 'high', evidence: 'current' },
    ).uncertain, true);
}

function createCarouselLikeBanner(document) {
    const banner = document.createElement('article');
    banner.className = 'match-preview-card';
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'load-btn match-preview-card__select';
    const league = document.createElement('span');
    league.className = 'match-preview-card__league';
    league.textContent = 'B-Klasse 2026-2027';
    const teams = document.createElement('div');
    teams.className = 'match-preview-card__teams';
    teams.textContent = 'Alpha VS Bravo';
    const date = document.createElement('span');
    date.className = 'match-preview-card__date';
    date.textContent = '01.09.2026';
    const status = document.createElement('span');
    status.className = 'match-preview-card__status';
    status.textContent = 'Partie auswählen';
    select.append(league, teams, date, status);
    banner.appendChild(select);
    return { banner, select, league, teams, date, status };
}

function runRealAutoFill(document, nextMatch, banner) {
    const finder = Function(`${extractFunction('normMatchPreview')}; ${extractFunction('findTeamOptionMatchPreview')}; return findTeamOptionMatchPreview;`)();
    const apply = Function('findTeamOptionMatchPreview', 'setTimeout', 'Event', 'setAppStatus', `${extractFunction('applyMatchSelectorAutoFill')}; return applyMatchSelectorAutoFill;`)(
        finder,
        (callback) => { callback(); return 0; },
        class Event { constructor(type) { this.type = type; } },
        () => {},
    );
    const leagueSelect = document.createElement('select');
    leagueSelect.value = '';
    const teamASelect = document.createElement('select');
    const teamBSelect = document.createElement('select');
    [['035', 'Alpha'], ['036', 'Bravo']].forEach(([value, text]) => {
        const homeOption = document.createElement('option');
        homeOption.value = value;
        homeOption.textContent = text;
        teamASelect.appendChild(homeOption);
        const awayOption = document.createElement('option');
        awayOption.value = value;
        awayOption.textContent = text;
        teamBSelect.appendChild(awayOption);
    });
    apply(false, nextMatch, {
        leagueSelect, teamASelect, teamBSelect, banner,
        updateExclusions() {}, loadSelection() {},
    });
}

{
    const document = createDocument();
    const { banner, select, league, teams, date, status } = createCarouselLikeBanner(document);
    runRealAutoFill(document, { league: 'B-Klasse 2026-2027', home: 'Alpha', away: 'Bravo' }, banner);
    assert.equal(status.textContent, 'Ausgewählt');
    assert.equal(banner.dataset.state, 'selected');
    assert.equal(select.attributes['aria-pressed'], 'true');
    assert.equal(select.children.length, 4, 'callback-absent success must not replace carousel button children');
    assert.equal(league.textContent, 'B-Klasse 2026-2027');
    assert.equal(teams.textContent, 'Alpha VS Bravo');
    assert.equal(date.textContent, '01.09.2026');
    runRealAutoFill(document, { league: 'B-Klasse 2026-2027', home: 'Alpha', away: 'Alpha' }, banner);
    assert.equal(status.textContent, 'Auswahl unvollständig');
    assert.equal(banner.dataset.state, 'incomplete');
    assert.equal(select.attributes['aria-pressed'], 'false');
    assert.equal(select.children.length, 4, 'callback-absent incomplete feedback must keep carousel button children');
    assert.equal(date.textContent, '01.09.2026');
}

function renderScenario(calibrated = true, rendererDeclaration = extractFunction('renderMatchPreview'), scenarioOptions = {}) {
    const document = createDocument();
    const contentArea = document.createElement('main');
    document.root = contentArea;
    const topBarTitle = document.createElement('div');
    const model = makeModel(calibrated, scenarioOptions.comparisonPercents, scenarioOptions.comparisonOutputs);
    const exposedModel = typeof scenarioOptions.wrapModel === 'function'
        ? scenarioOptions.wrapModel(model)
        : model;
    const window = {
        BwedlMatchPreviewModel: exposedModel,
        ARCHIVE_TABLES: [],
        matchMedia: () => ({ matches: scenarioOptions.reducedMotion === true }),
        resizeObservers: [],
        resizeListeners: new Set(),
        addEventListener(type, listener) { if (type === 'resize') window.resizeListeners.add(listener); },
        removeEventListener(type, listener) { if (type === 'resize') window.resizeListeners.delete(listener); },
    };
    window.ResizeObserver = class {
        constructor(callback) { this.callback = callback; window.resizeObservers.push(this); }
        observe() {}
        disconnect() { this.disconnected = true; }
    };
    const rankingPlayers = [];
    const autoFillCalls = [];
    const autoFillCompletions = [];
    const formPlayers = [];
    const pendingTimers = [];
    const scheduleTimer = (callback, delay = 0) => {
        if (scenarioOptions.deferTimers) {
            pendingTimers.push({ callback, delay });
            return pendingTimers.length;
        }
        callback();
        return 0;
    };
    const detectedMatches = scenarioOptions.detectedMatches
        || (scenarioOptions.detectedMatch ? [scenarioOptions.detectedMatch] : []);
    const bindings = {
        document, contentArea, topBarTitle, window,
        leagueData: { leagues: { 'B-Klasse 2026-2027': { table: '<table></table>' } } },
        rankingData: { players: rankingPlayers }, archiveData: {},
        clubData: { clubs: [{ number: '035', name: '<svg onload=alert(1)>Alpha' }, { number: '036', name: '<script>alert(1)</script>Bravo' }] },
        dataStatus: { domains: { rankings: { season: '2025/26', state: 'retained' } } },
        detectNextMatch: () => detectedMatches, readMatchPreviewGame: () => null,
        BwedlAppUtils: { ...BwedlAppUtils, mergeMatchPreviewGames: (_selected, detected) => detected, buildMatchPreviewTeams: () => [{ id: '035', name: '<svg onload=alert(1)>Alpha' }, { id: '036', name: '<script>alert(1)</script>Bravo' }] },
        createSeasonNotice: () => null,
        safeTableRowsFromHtml: () => [['1', 'Alpha', '0'], ['2', 'Bravo', '0']],
        findHistoricalResults: () => ({ matches: [] }),
        isMyPlayerRecord: (candidate) => candidate.id === 'h1', calculateOptimalLineup: () => ({ players: [], avg: 0 }),
        getPlayerFormTrend: (formPlayer) => {
            formPlayers.push(formPlayer);
            return { trend: 'flat', values: Object.values(formPlayer.rounds || {}).map(Number), lastNAvg: 42 };
        },
        applyMatchSelectorAutoFill: (isAuto, match, controls) => {
            if (typeof controls.canApply === 'function' && !controls.canApply()) return;
            autoFillCalls.push({ isAuto, match });
            const runInternalChange = typeof controls.runInternalChange === 'function'
                ? controls.runInternalChange
                : (callback) => callback();
            if (scenarioOptions.incompleteAutoFill) {
                if (typeof controls.setBannerState === 'function') controls.setBannerState('incomplete');
                return;
            }
            runInternalChange(() => {
                controls.leagueSelect.value = match.league;
                controls.leagueSelect.dispatchEvent({ type: 'change', isTrusted: false });
            });
            const complete = () => {
                if (typeof controls.canApply === 'function' && !controls.canApply()) return;
                const reversed = match.home === 'Bravo';
                runInternalChange(() => {
                    controls.teamASelect.value = reversed ? '036' : '035';
                    controls.teamBSelect.value = reversed ? '035' : '036';
                });
                controls.updateExclusions();
                controls.loadSelection();
                if (typeof controls.setBannerState === 'function') controls.setBannerState('selected');
                else {
                    controls.banner.style.borderColor = '#22c55e';
                    controls.banner.querySelector('.load-btn').textContent = isAuto ? '✓ Vorausgewählt' : '✓ Ausgewählt';
                }
                autoFillCompletions.push({ isAuto, match });
            };
            if (scenarioOptions.deferAutoFillWork) scheduleTimer(complete, 200);
            else complete();
        },
        escapeHtmlText: BwedlAppUtils.escapeHtmlText,
        setTimeout: scheduleTimer,
        setAppStatus() {}, Event: class Event { constructor(type) { this.type = type; this.isTrusted = false; } },
    };
    const render = Function(...Object.keys(bindings), `${rendererDeclaration}; return renderMatchPreview;`)(...Object.values(bindings));
    render();
    const selects = contentArea.querySelectorAll('SELECT');
    assert.equal(selects.length, 3);
    if (!scenarioOptions.skipManualSelection) {
        selects[0].value = 'B-Klasse 2026-2027';
        selects[0].dispatchEvent({ type: 'change' });
        selects[1].value = '035'; selects[2].value = '036';
        selects[1].dispatchEvent({ type: 'change' });
        selects[2].dispatchEvent({ type: 'change' });
    }
    return {
        document, contentArea, model, render, window, selects, rankingPlayers, autoFillCalls, autoFillCompletions, formPlayers,
        flushNextTimer: () => {
            const timer = pendingTimers.shift();
            assert.ok(timer, 'Expected a pending timer');
            timer.callback();
        },
        flushTimer: (delay) => {
            const index = pendingTimers.findIndex((timer) => timer.delay === delay);
            assert.notEqual(index, -1, `Expected a pending ${delay}ms timer`);
            const [timer] = pendingTimers.splice(index, 1);
            timer.callback();
        },
        pendingTimerCount: () => pendingTimers.length,
        triggerResize: () => window.resizeObservers.forEach((observer) => observer.callback()),
    };
}

function renderUnavailableModelScenario(model, configureWindow) {
    const document = createDocument();
    const contentArea = document.createElement('main');
    document.root = contentArea;
    const topBarTitle = document.createElement('div');
    const window = {};
    if (typeof configureWindow === 'function') configureWindow(window);
    else if (model !== undefined) window.BwedlMatchPreviewModel = model;
    const clubData = { clubs: [] };
    const archiveData = {};
    const rendererDeclaration = extractFunction('renderMatchPreview');
    const render = Function(
        'document', 'contentArea', 'topBarTitle', 'window', 'clubData', 'archiveData',
        `${rendererDeclaration}; return renderMatchPreview;`,
    )(document, contentArea, topBarTitle, window, clubData, archiveData);

    assert.doesNotThrow(() => render());
    return { document, contentArea, topBarTitle };
}

{
    let rootGetterCalls = 0;
    const scenario = renderUnavailableModelScenario(undefined, (window) => {
        Object.defineProperty(window, 'BwedlMatchPreviewModel', {
            configurable: true,
            get() {
                rootGetterCalls += 1;
                throw new Error('root model getter must stay inert');
            },
        });
    });
    assert.ok(scenario.contentArea.querySelector('[role="alert"]'));
    assert.equal(rootGetterCalls, 0, 'the model root must be read from its own data descriptor');
}

{
    const scenario = renderUnavailableModelScenario(undefined);
    const alert = scenario.contentArea.querySelector('[role="alert"]');
    assert.ok(alert, 'missing model dependency must render an accessible error');
    assert.match(alert.textContent, /Match-Preview ist derzeit nicht verfügbar/);
    assert.equal(alert.attributes['aria-live'], 'polite');
    assert.equal(scenario.topBarTitle.textContent, 'Match Preview');
    assert.equal(scenario.contentArea.querySelectorAll('SCRIPT').length, 0);
}

{
    let partialMethodCalls = 0;
    const scenario = renderUnavailableModelScenario({
        buildClassCalibration() { partialMethodCalls += 1; },
    });
    assert.ok(scenario.contentArea.querySelector('[role="alert"]'));
    assert.equal(partialMethodCalls, 0, 'partial APIs must fail closed before any model method runs');
}

{
    let proxyGetCalls = 0;
    const scenario = renderScenario(true, extractFunction('renderMatchPreview'), {
        wrapModel: (model) => new Proxy(model, {
            get() {
                proxyGetCalls += 1;
                throw new Error('validated model properties must not be reread');
            },
        }),
    });
    assert.equal(proxyGetCalls, 0);
    assert.deepEqual(
        { calibration: scenario.model.calls.calibration, training: scenario.model.calls.training, outcome: scenario.model.calls.outcome },
        { calibration: 1, training: 1, outcome: 1 },
    );
    assert.equal(scenario.contentArea.querySelector('[role="alert"]'), null);
}

{
    let thisAwareModel;
    const scenario = renderScenario(true, extractFunction('renderMatchPreview'), {
        wrapModel: (model) => {
            thisAwareModel = {};
            for (const name of ['buildClassCalibration', 'buildOutcomeTrainingExamples', 'calibrateOutcomeModel', 'buildTeamRoster', 'completeLineup', 'comparePairStrength', 'forecastMatch']) {
                Object.defineProperty(thisAwareModel, name, {
                    enumerable: true,
                    value: function (...args) {
                        assert.equal(this, thisAwareModel, `${name} keeps the validated model as this`);
                        return Reflect.apply(model[name], model, args);
                    },
                });
            }
            return thisAwareModel;
        },
    });
    assert.equal(scenario.contentArea.querySelector('[role="alert"]'), null);
}

{
    const scenario = renderScenario(true);
    assert.deepEqual({ calibration: scenario.model.calls.calibration, training: scenario.model.calls.training, outcome: scenario.model.calls.outcome }, { calibration: 1, training: 1, outcome: 1 });
    assert.equal(scenario.model.calls.rosterOptions.every((options) => options.currentPlayers === scenario.rankingPlayers), true);
    const text = scenario.contentArea.textContent;
    for (const expected of ['Vorjahreskader', 'Klassenwechsel: Bezirksliga, A-Klasse → B-Klasse', 'Klassen: Bezirksliga, A-Klasse', 'Zielklasse: B-Klasse', 'Kaderzugehörigkeit unbestätigt', 'Datenqualität: vorläufig']) assert.match(text, new RegExp(expected));
    assert.doesNotMatch(text, /NICHT AUS ROHDATEN|raw segment/);
    const firstHomeRow = scenario.document.getElementById('list-a').querySelector('.match-preview-player');
    assert.equal(firstHomeRow.querySelectorAll('.match-preview-player__name').length, 1, 'a transferred player renders once');
    assert.equal((firstHomeRow.textContent.match(/2025\/26/g) || []).length, 1, 'one player-season renders once');
    assert.equal(scenario.contentArea.querySelectorAll('INPUT').filter((input) => input.checked).length, 8);
    assert.equal(scenario.document.getElementById('list-a').querySelectorAll('INPUT').filter((input) => input.checked).length, 4);
    assert.equal(scenario.document.getElementById('list-b').querySelectorAll('INPUT').filter((input) => input.checked).length, 4);
    assert.equal(scenario.contentArea.querySelectorAll('[data-evidence]').length, 8);
    assert.equal(scenario.contentArea.querySelectorAll('IMG').length, 0, 'player names must stay inert text');
    assert.equal(scenario.contentArea.querySelectorAll('SVG').length, 0, 'team names must stay inert text');
    assert.equal(scenario.contentArea.querySelectorAll('SCRIPT').length, 0, 'source seasons must stay inert text');
    assert.equal(scenario.document.usedUnsafePlayerHtml, false, 'hostile external values must never reach innerHTML');
    const ownPlayerName = scenario.document.getElementById('list-a').querySelector('.match-preview-player__name');
    assert.ok(ownPlayerName.classList.contains('my-player-text'));
    assert.equal(ownPlayerName.textContent.length > 500, true);
    scenario.contentArea.querySelector('.match-preview-calculate').dispatchEvent({ type: 'click' });
    assert.equal(scenario.contentArea.querySelectorAll('.match-preview-sparkline').length, 8);
    const firstSparklinePoints = scenario.contentArea.querySelector('.match-preview-sparkline').querySelectorAll('.match-preview-sparkline__point');
    assert.equal(firstSparklinePoints.length, 2);
    assert.notEqual(firstSparklinePoints[0].style.height, firstSparklinePoints[1].style.height);
    const formPanel = scenario.contentArea.querySelector('.match-preview-form');
    const matrixPanel = scenario.contentArea.querySelector('.match-preview-pairings');
    const matrixScroll = scenario.contentArea.querySelector('.match-preview-matrix-scroll');
    const matrix = scenario.contentArea.querySelector('.match-preview-matrix');
    assert.ok(matrixPanel);
    assert.equal(matrixPanel.children[0].tagName, 'H2');
    assert.equal(matrixPanel.children[0].textContent, '1v1-Analyse');
    assert.match(matrixPanel.textContent, /Stärkevergleich|Einschätzung/);
    assert.match(matrixPanel.textContent, /keine Einzelspiel-Siegwahrscheinlichkeit/i);
    assert.match(matrixPanel.textContent, /\?\s*=\s*unsichere Datenbasis/i);
    assert.ok(matrixPanel.querySelector('.match-preview-matrix__scroll-hint'));
    assert.doesNotMatch(matrixPanel.textContent, /Siegchance|Gewinnwahrscheinlichkeit/i);
    assert.ok(matrixScroll);
    assert.equal(matrixScroll.tabIndex, 0);
    assert.match(matrixScroll.attributes['aria-label'], /horizontal.*scrollbar|horizontal scrollable/i);
    const scrollHint = matrixPanel.querySelector('.match-preview-matrix__scroll-hint');
    matrixScroll.clientWidth = 700;
    matrixScroll.scrollWidth = 1_000;
    scenario.triggerResize();
    assert.equal(scrollHint.hidden, false, 'overflow shows the hint even at a 641-768px viewport width');
    matrixScroll.scrollWidth = 700;
    scenario.triggerResize();
    assert.equal(scrollHint.hidden, true, 'no overflow hides the hint');
    assert.ok(matrix);
    assert.equal(matrix.tagName, 'TABLE');
    assert.equal(matrix.parentElement, matrixScroll);
    assert.equal(matrix.querySelectorAll('THEAD').length, 1);
    assert.equal(matrix.querySelectorAll('TBODY').length, 1);
    assert.equal(matrix.querySelectorAll('TH[scope="col"]').length, 4);
    assert.equal(matrix.querySelectorAll('TH[scope="row"]').length, 4);
    assert.equal(matrix.querySelectorAll('.match-preview-matrix__cell').length, 16);
    const values = matrix.querySelectorAll('.match-preview-matrix__value');
    assert.equal(values.length, 16);
    values.forEach((value) => assert.match(value.textContent, /^(?:0|[1-9]\d?|100) %$/));
    matrix.querySelectorAll('.match-preview-matrix__cell').forEach((cell) => {
        assert.match(cell.attributes['aria-label'], /: \d+% Heim, \d+% Gast, (?:Vorteil Heim|ausgeglichen|Vorteil Gast)/);
        const percentages = [...cell.attributes['aria-label'].matchAll(/(\d+)% (?:Heim|Gast)/g)].map((match) => Number(match[1]));
        assert.equal(percentages.length, 2);
        assert.equal(percentages[0] + percentages[1], 100);
    });
    assert.equal(matrix.querySelectorAll('.match-preview-matrix__uncertain').length > 0, true);
    const uncertaintyMarker = matrix.querySelector('.match-preview-matrix__uncertain');
    assert.equal(uncertaintyMarker.textContent, '?');
    assert.equal(uncertaintyMarker.attributes['aria-hidden'], 'true');
    assert.match(uncertaintyMarker.parentElement.attributes['aria-label'], /unsichere Datenbasis/);
    assert.match(matrix.querySelector('TH[scope="row"]').textContent, /<img src=x onerror=alert\(1\)>/);
    assert.match(matrix.querySelector('.match-preview-matrix__cell').attributes['aria-label'], /<img src=x onerror=alert\(1\)>/);
    assert.equal(scenario.contentArea.querySelectorAll('.match-preview-pairing').length, 0);
    assert.ok(matrixPanel.parentElement.children.indexOf(formPanel) < matrixPanel.parentElement.children.indexOf(matrixPanel), 'form curves stay before the matrix');
    for (const legendText of ['55–100', '46–54', '0–45']) assert.match(matrixPanel.textContent, new RegExp(legendText));
    assert.ok(scenario.formPlayers.some((formPlayer) => formPlayer.id === 'h1' && formPlayer.evidence === 'current+history'));
    assert.ok(scenario.formPlayers.some((formPlayer) => formPlayer.id === 'h2' && formPlayer.evidence === 'historical'));
    assert.equal(scenario.formPlayers.some((formPlayer) => formPlayer.evidence === 'neutral'), false);
    assert.equal(scenario.document.scrollCalls.at(-1).behavior, 'smooth');
    const homeChecks = scenario.document.getElementById('list-a').querySelectorAll('INPUT');
    homeChecks[0].checked = false;
    homeChecks[0].dispatchEvent({ type: 'change', target: homeChecks[0], preventDefault() {} });
    const previousMatrixObserver = scenario.window.resizeObservers.at(-1);
    scenario.contentArea.querySelector('.match-preview-calculate').dispatchEvent({ type: 'click' });
    assert.equal(previousMatrixObserver.disconnected, true, 'recalculating must disconnect the previous matrix observer');
    assert.equal(scenario.window.resizeListeners.size, 1, 'recalculating must keep one active resize listener');
    assert.match(scenario.document.getElementById('preview-results').textContent, /Unbekannter Spieler \(Klassenwert\)/);
    assert.equal(scenario.model.calls.complete.at(-2).manual, true);
    assert.deepEqual(scenario.model.calls.complete.at(-2).ids, ['h2', 'h3', 'h4']);
    const result = scenario.document.getElementById('preview-results').textContent;
    assert.match(result, /Heimsieg 46%/); assert.match(result, /Unentschieden 21%/); assert.match(result, /Auswärtssieg 33%/);
    assert.equal([...result.matchAll(/(?:Heimsieg|Unentschieden|Auswärtssieg) (\d+)%/g)].slice(0, 3).reduce((sum, match) => sum + Number(match[1]), 0), 100);
    assert.match(result, /Plausibler Bereich/);
    assert.match(result, /Aktuelle Form/);
    assert.match(result, /Historische Form/);
    assert.match(result, /Keine Formdaten/);
    const observerBeforeRerender = scenario.window.resizeObservers.at(-1);
    scenario.render();
    assert.equal(observerBeforeRerender.disconnected, true, 'rerender must disconnect the previous matrix observer');
    assert.equal(scenario.contentArea.querySelectorAll('.match-preview-shell').length, 1, 'rerender must replace rather than duplicate preview DOM');
}

{
    const scenario = renderScenario(true, extractFunction('renderMatchPreview'), {
        comparisonPercents: [55, 54, 46, 45],
    });
    scenario.contentArea.querySelector('.match-preview-calculate').dispatchEvent({ type: 'click' });
    const cells = scenario.contentArea.querySelectorAll('.match-preview-matrix__cell');
    assert.equal(scenario.model.calls.pairStrength, 16, 'the renderer asks the approved helper for every pairing');
    assert.deepEqual(cells.slice(0, 4).map((cell) => cell.querySelector('.match-preview-matrix__value').textContent), ['55 %', '54 %', '46 %', '45 %']);
    assert.equal(cells[0].classList.contains('match-preview-matrix__cell--home'), true);
    assert.equal(cells[1].classList.contains('match-preview-matrix__cell--balanced'), true);
    assert.equal(cells[2].classList.contains('match-preview-matrix__cell--balanced'), true);
    assert.equal(cells[3].classList.contains('match-preview-matrix__cell--away'), true);
    assert.deepEqual(cells.slice(0, 4).map((cell) => cell.attributes['aria-label'].match(/\d+% Gast/)[0]), ['45% Gast', '46% Gast', '54% Gast', '55% Gast']);
}

{
    const throwingGetter = {};
    Object.defineProperty(throwingGetter, 'homePercent', {
        get() { throw new Error('homePercent getter must not run'); },
    });
    const throwingCoercion = {
        [Symbol.toPrimitive]() { throw new Error('homePercent coercion must not run'); },
    };
    const descriptorProxy = new Proxy({ homePercent: 55 }, {
        getOwnPropertyDescriptor() { throw new Error('comparison proxy descriptor must not run unchecked'); },
    });
    const comparisonOutputs = [
        { homePercent: null },
        { homePercent: false },
        { homePercent: '' },
        { homePercent: '55' },
        { homePercent: 54.5 },
        { homePercent: -1 },
        { homePercent: 101 },
        throwingGetter,
        { homePercent: throwingCoercion },
        () => { throw new Error('comparison helper failure'); },
        descriptorProxy,
    ];
    const scenario = renderScenario(true, extractFunction('renderMatchPreview'), { comparisonOutputs });
    assert.doesNotThrow(() => scenario.contentArea.querySelector('.match-preview-calculate').dispatchEvent({ type: 'click' }));
    const malformedCells = scenario.contentArea.querySelectorAll('.match-preview-matrix__cell').slice(0, comparisonOutputs.length);
    assert.equal(malformedCells.length, comparisonOutputs.length);
    malformedCells.forEach((cell) => {
        assert.equal(cell.querySelector('.match-preview-matrix__value').textContent, '50 %');
        assert.equal(cell.classList.contains('match-preview-matrix__cell--balanced'), true);
        assert.equal(cell.querySelectorAll('.match-preview-matrix__uncertain').length, 1);
        assert.equal(cell.querySelector('.match-preview-matrix__uncertain').textContent, '?');
        assert.match(cell.attributes['aria-label'], /50% Heim, 50% Gast, ausgeglichen, unsichere Datenbasis/);
    });
    assert.equal(scenario.contentArea.querySelectorAll('IMG').length, 0);
    assert.equal(scenario.contentArea.querySelectorAll('SVG').length, 0);
    assert.equal(scenario.contentArea.querySelectorAll('SCRIPT').length, 0);
    assert.equal(scenario.document.usedUnsafePlayerHtml, false);
}

{
    const detectedMatch = {
        league: 'B-Klasse 2026-2027',
        home: '<svg onload=alert(1)>Alpha',
        away: '<script>alert(1)</script>Bravo',
    };
    const scenario = renderScenario(true, extractFunction('renderMatchPreview'), {
        detectedMatch,
        skipManualSelection: true,
    });
    assert.equal(scenario.autoFillCalls.length, 1);
    assert.equal(scenario.autoFillCalls[0].isAuto, true);
    assert.deepEqual(scenario.selects.map((select) => select.value), ['B-Klasse 2026-2027', '035', '036']);
    assert.equal(scenario.document.getElementById('player-selection-area').style.display, 'block');
}

{
    const scenario = renderScenario(true, extractFunction('renderMatchPreview'), {
        detectedMatches: [
            { league: 'B-Klasse 2026-2027', home: '<svg onload=alert(1)>Alpha', away: '<script>alert(1)</script>Bravo', dateStr: '01.09.2026' },
            { league: 'B-Klasse 2026-2027', home: 'Bravo', away: 'Alpha', dateStr: '08.09.2026' },
        ],
        deferTimers: true,
        deferAutoFillWork: true,
        skipManualSelection: true,
    });
    const carousel = scenario.contentArea.querySelector('.match-preview-carousel');
    assert.ok(carousel);
    assert.equal(carousel.querySelectorAll('.match-preview-carousel__track').length, 1);
    const cards = scenario.contentArea.querySelectorAll('.match-preview-card');
    assert.equal(cards.length, 2);
    const selects = cards.map((card) => card.querySelector('.match-preview-card__select'));
    assert.equal(selects.filter(Boolean).length, 2);
    selects.forEach((select) => {
        assert.equal(select.tagName, 'BUTTON');
        assert.equal(select.type, 'button');
        assert.equal(select.attributes['aria-pressed'], 'false');
        assert.match(select.attributes['aria-label'], /auswählen$/);
    });
    assert.equal(scenario.contentArea.querySelectorAll('SVG').length, 0, 'hostile match names must stay inert text');
    assert.equal(scenario.contentArea.querySelectorAll('SCRIPT').length, 0, 'hostile match names must stay inert text');
    assert.equal(carousel.querySelectorAll('.match-preview-carousel__arrow').length, 2);
    const dots = carousel.querySelectorAll('.match-preview-carousel__dot');
    assert.equal(dots.length, 2);
    assert.equal(dots[0].attributes['aria-current'], 'true');
    assert.equal(dots[1].attributes['aria-current'], undefined);

    selects[1].dispatchEvent({ type: 'click' });
    scenario.flushTimer(200);
    assert.deepEqual(scenario.autoFillCalls.map((call) => [call.isAuto, call.match.home]), [[false, 'Bravo']]);
    assert.equal(selects[0].attributes['aria-pressed'], 'false');
    assert.equal(selects[1].attributes['aria-pressed'], 'true');
    assert.equal(cards[0].querySelector('.match-preview-card__status').textContent, 'Partie auswählen');
    assert.equal(cards[1].querySelector('.match-preview-card__status').textContent, 'Ausgewählt');
    assert.equal(cards[1].scrollIntoViewCalls.at(-1).behavior, 'smooth');

    const arrows = carousel.querySelectorAll('.match-preview-carousel__arrow');
    assert.equal(arrows[0].disabled, false);
    arrows[1].dispatchEvent({ type: 'click' });
    assert.equal(arrows[0].disabled, false);
    assert.equal(arrows[1].disabled, true);
    assert.equal(dots[0].attributes['aria-current'], undefined);
    assert.equal(dots[1].attributes['aria-current'], 'true');
    assert.equal(scenario.document.focusedElement, selects[1]);
    assert.ok(selects[1].focusCalls > 0);
    assert.ok(cards[1].scrollIntoViewCalls.length > 1);
    arrows[1].dispatchEvent({ type: 'click' });
    assert.equal(dots[1].attributes['aria-current'], 'true', 'next navigation clamps at the last card');
    let leftPrevented = false;
    carousel.dispatchEvent({ type: 'keydown', key: 'ArrowLeft', preventDefault() { leftPrevented = true; } });
    assert.equal(leftPrevented, true);
    assert.equal(dots[0].attributes['aria-current'], 'true');
    let tabPrevented = false;
    carousel.dispatchEvent({ type: 'keydown', key: 'Tab', preventDefault() { tabPrevented = true; } });
    assert.equal(tabPrevented, false, 'Tab must retain normal browser behavior');
    let rightPrevented = false;
    carousel.dispatchEvent({ type: 'keydown', key: 'ArrowRight', preventDefault() { rightPrevented = true; } });
    assert.equal(rightPrevented, true);
    assert.equal(dots[1].attributes['aria-current'], 'true');
}

{
    const scenario = renderScenario(true, extractFunction('renderMatchPreview'), { skipManualSelection: true });
    assert.equal(scenario.contentArea.querySelector('.match-preview-carousel'), null);
    assert.ok(scenario.contentArea.querySelector('#match-preview-league'), 'manual selector remains available without detected games');
}

{
    const scenario = renderScenario(true, extractFunction('renderMatchPreview'), {
        detectedMatches: [
            { league: 'B-Klasse 2026-2027', home: 'Alpha', away: 'Bravo', spieltag: '1. Spieltag', dateStr: '01.09.2026' },
            { league: 'B-Klasse 2026-2027', home: 'Alpha', away: 'Bravo', spieltag: '2. Spieltag', dateStr: '08.09.2026' },
            { league: 'B-Klasse 2026-2027', home: 'Alpha', away: 'Bravo', spieltag: '3. Spieltag', dateStr: '15.09.2026' },
        ],
        deferTimers: true,
        deferAutoFillWork: true,
        skipManualSelection: true,
    });
    const carousel = scenario.contentArea.querySelector('.match-preview-carousel');
    const track = carousel.querySelector('.match-preview-carousel__track');
    const cards = carousel.querySelectorAll('.match-preview-card');
    const selects = cards.map((card) => card.querySelector('.match-preview-card__select'));
    const dots = carousel.querySelectorAll('.match-preview-carousel__dot');
    const arrows = carousel.querySelectorAll('.match-preview-carousel__arrow');
    assert.equal(cards[0].querySelector('.match-preview-card__matchday').textContent, '1. Spieltag');
    assert.equal(cards[1].querySelector('.match-preview-card__matchday').textContent, '2. Spieltag');
    assert.notEqual(selects[0].attributes['aria-label'], selects[1].attributes['aria-label'], 'duplicate-team fixtures require distinct accessible names');
    assert.equal(selects[1].attributes['aria-label'], 'Alpha gegen Bravo, B-Klasse 2026-2027, 2. Spieltag, 08.09.2026 auswählen');
    assert.deepEqual(dots.map((dot) => dot.attributes['aria-label']), [
        'Partie 1 von 3 anzeigen',
        'Partie 2 von 3 anzeigen',
        'Partie 3 von 3 anzeigen',
    ]);

    selects[1].dispatchEvent({ type: 'click' });
    scenario.flushTimer(200);
    assert.equal(dots[1].attributes['aria-current'], 'true', 'selection synchronizes browse state to the selected card');
    assert.equal(arrows[0].disabled, false);
    assert.equal(arrows[1].disabled, false);
    arrows[1].dispatchEvent({ type: 'click' });
    assert.equal(dots[2].attributes['aria-current'], 'true', 'next proceeds from the selected card to card three');

    track._rect = { left: -80, width: 100 };
    cards[0]._rect = { left: -50, width: 20 };
    cards[1]._rect = { left: 40, width: 20 };
    cards[2]._rect = { left: 130, width: 20 };
    track.dispatchEvent({ type: 'scroll' });
    scenario.flushTimer(120);
    assert.equal(dots[0].attributes['aria-current'], 'true', 'settled native scrolling synchronizes the nearest card');
    assert.equal(arrows[0].disabled, true);
    assert.equal(arrows[1].disabled, false);
    assert.equal(selects[1].attributes['aria-pressed'], 'true', 'native browsing remains independent from selected state');
    assert.equal(selects[0].attributes['aria-pressed'], 'false');
    assert.equal(selects[2].attributes['aria-pressed'], 'false');

    track._rect = { left: 100, width: 100 };
    track.dispatchEvent({ type: 'scroll' });
    scenario.render();
    scenario.flushTimer(120);
    assert.equal(dots[0].attributes['aria-current'], 'true', 'a pending native-scroll settle callback from an obsolete render stays inert');
    const rerenderedDots = scenario.contentArea.querySelectorAll('.match-preview-carousel__dot');
    assert.equal(rerenderedDots[0].attributes['aria-current'], 'true');
}

{
    const scenario = renderScenario(true, extractFunction('renderMatchPreview'), {
        detectedMatch: { league: 'B-Klasse 2026-2027', home: 'Alpha', away: 'Bravo' },
        deferTimers: true,
        skipManualSelection: true,
    });
    const carousel = scenario.contentArea.querySelector('.match-preview-carousel');
    assert.ok(carousel);
    assert.equal(carousel.querySelectorAll('.match-preview-card').length, 1);
    assert.equal(carousel.querySelectorAll('.match-preview-carousel__arrow').length, 0);
    assert.equal(carousel.querySelectorAll('.match-preview-carousel__dot').length, 0);
}

{
    const scenario = renderScenario(true, extractFunction('renderMatchPreview'), {
        detectedMatch: { league: 'B-Klasse 2026-2027', home: 'Alpha', away: 'Bravo' },
        reducedMotion: true,
        skipManualSelection: true,
    });
    const card = scenario.contentArea.querySelector('.match-preview-card');
    card.querySelector('.match-preview-card__select').dispatchEvent({ type: 'click' });
    assert.equal(card.scrollIntoViewCalls.at(-1).behavior, 'auto', 'card selection honors reduced-motion preferences');
}

{
    const scenario = renderScenario(true, extractFunction('renderMatchPreview'), {
        detectedMatch: { league: 'B-Klasse 2026-2027', home: '<svg onload=alert(1)>Alpha', away: '' },
        deferTimers: true,
        skipManualSelection: true,
    });
    const card = scenario.contentArea.querySelector('.match-preview-card');
    const select = card.querySelector('.match-preview-card__select');
    assert.match(card.querySelector('.match-preview-card__teams').textContent, /<svg onload=alert\(1\)>AlphaVSGast/);
    assert.equal(select.attributes['aria-label'], '<svg onload=alert(1)>Alpha gegen Gast, B-Klasse 2026-2027, Termin offen auswählen');
    assert.equal(scenario.contentArea.querySelectorAll('SVG').length, 0, 'hostile incomplete names stay inert');
}

{
    const scenario = renderScenario(true, extractFunction('renderMatchPreview'), {
        detectedMatch: { league: 'B-Klasse 2026-2027', home: 'Alpha', away: 'Bravo' },
        incompleteAutoFill: true,
        deferTimers: true,
        skipManualSelection: true,
    });
    const card = scenario.contentArea.querySelector('.match-preview-card');
    card.querySelector('.match-preview-card__select').dispatchEvent({ type: 'click' });
    assert.equal(card.querySelector('.match-preview-card__status').textContent, 'Auswahl unvollständig');
    assert.equal(card.querySelector('.match-preview-card__select').attributes['aria-pressed'], 'false');
}

{
    const matches = [
        { league: 'B-Klasse 2026-2027', home: 'Alpha', away: 'Bravo' },
        { league: 'B-Klasse 2026-2027', home: 'Bravo', away: 'Alpha' },
    ];
    const scenario = renderScenario(true, extractFunction('renderMatchPreview'), {
        detectedMatches: matches,
        deferTimers: true,
        deferAutoFillWork: true,
        skipManualSelection: true,
    });
    const cards = scenario.contentArea.querySelectorAll('.match-preview-card');
    cards[1].querySelector('.match-preview-card__select').dispatchEvent({ type: 'click' });
    scenario.flushTimer(100);
    scenario.flushTimer(200);
    assert.deepEqual(scenario.autoFillCalls.map((call) => [call.isAuto, call.match.home]), [[false, 'Bravo']]);
    assert.deepEqual(scenario.autoFillCompletions.map((call) => [call.isAuto, call.match.home]), [[false, 'Bravo']]);
    assert.deepEqual(scenario.selects.map((select) => select.value), ['B-Klasse 2026-2027', '036', '035']);
    assert.equal(cards[0].querySelector('.match-preview-card__status').textContent, 'Partie auswählen');
    assert.equal(cards[1].querySelector('.match-preview-card__status').textContent, 'Ausgewählt');
}

{
    const scenario = renderScenario(true, extractFunction('renderMatchPreview'), {
        detectedMatches: [
            { league: 'B-Klasse 2026-2027', home: 'Alpha', away: 'Bravo' },
            { league: 'B-Klasse 2026-2027', home: 'Bravo', away: 'Alpha' },
        ],
        deferTimers: true,
        deferAutoFillWork: true,
        skipManualSelection: true,
    });
    const cards = scenario.contentArea.querySelectorAll('.match-preview-card');
    cards[0].querySelector('.match-preview-card__select').dispatchEvent({ type: 'click' });
    cards[1].querySelector('.match-preview-card__select').dispatchEvent({ type: 'click' });
    scenario.flushTimer(200);
    scenario.flushTimer(200);
    scenario.flushTimer(100);
    assert.deepEqual(scenario.autoFillCompletions.map((call) => call.match.home), ['Bravo']);
    assert.equal(cards[0].querySelector('.match-preview-card__status').textContent, 'Partie auswählen');
    assert.equal(cards[1].querySelector('.match-preview-card__status').textContent, 'Ausgewählt');
}

{
    const scenario = renderScenario(true, extractFunction('renderMatchPreview'), {
        detectedMatch: { league: 'B-Klasse 2026-2027', home: 'Alpha', away: 'Bravo' },
        deferTimers: true,
        deferAutoFillWork: true,
        skipManualSelection: true,
    });
    assert.equal(scenario.pendingTimerCount(), 1);
    scenario.render();
    assert.equal(scenario.pendingTimerCount(), 2);
    scenario.flushTimer(100);
    assert.equal(scenario.autoFillCalls.length, 0, 'a timer from an obsolete render must be inert');
    const currentSelects = scenario.contentArea.querySelectorAll('SELECT');
    assert.deepEqual(currentSelects.map((select) => select.value), ['', '', '']);
    scenario.flushTimer(100);
    scenario.flushTimer(200);
    assert.equal(scenario.autoFillCalls.length, 1);
    assert.equal(scenario.autoFillCalls[0].isAuto, true);
    assert.deepEqual(currentSelects.map((select) => select.value), ['B-Klasse 2026-2027', '035', '036']);
}

{
    const scenario = renderScenario(true, extractFunction('renderMatchPreview'), {
        detectedMatch: { league: 'B-Klasse 2026-2027', home: 'Alpha', away: 'Bravo' },
        deferTimers: true,
        deferAutoFillWork: true,
        skipManualSelection: true,
    });
    assert.equal(scenario.autoFillCalls.length, 0);
    scenario.flushTimer(100);
    scenario.flushTimer(200);
    assert.deepEqual(scenario.autoFillCalls.map((call) => call.isAuto), [true]);
    assert.deepEqual(scenario.autoFillCompletions.map((call) => call.isAuto), [true]);
    assert.deepEqual(scenario.selects.map((select) => select.value), ['B-Klasse 2026-2027', '035', '036']);
    const card = scenario.contentArea.querySelector('.match-preview-card');
    assert.equal(card.querySelector('.match-preview-card__status').textContent, 'Ausgewählt');
    scenario.selects[1].dispatchEvent({ type: 'change', isTrusted: true });
    assert.equal(card.querySelector('.match-preview-card__status').textContent, 'Partie auswählen');
}

{
    const scenario = renderScenario(true, extractFunction('renderMatchPreview'), {
        detectedMatch: { league: 'B-Klasse 2026-2027', home: 'Alpha', away: 'Bravo' },
        deferTimers: true,
        deferAutoFillWork: true,
        skipManualSelection: true,
    });
    scenario.selects[0].value = 'B-Klasse 2026-2027';
    scenario.selects[0].dispatchEvent({ type: 'change', isTrusted: true });
    scenario.flushTimer(100);
    assert.equal(scenario.autoFillCalls.length, 0, 'a trusted selector interaction must cancel initial auto-fill');
    assert.equal(scenario.selects[0].value, 'B-Klasse 2026-2027');
}

{
    const scenario = renderScenario(true, extractFunction('renderMatchPreview'), {
        detectedMatch: { league: 'B-Klasse 2026-2027', home: 'Alpha', away: 'Bravo' },
        deferTimers: true,
        deferAutoFillWork: true,
        skipManualSelection: true,
    });
    scenario.flushTimer(100);
    scenario.selects[1].value = '999';
    scenario.selects[1].dispatchEvent({ type: 'change', isTrusted: false });
    scenario.selects[2].value = '996';
    scenario.selects[2].dispatchEvent({ type: 'change', isTrusted: false });
    scenario.flushTimer(200);
    assert.equal(scenario.autoFillCompletions.length, 0, 'selector interaction must invalidate delayed auto-fill work');
    assert.deepEqual(scenario.selects.map((select) => select.value), ['B-Klasse 2026-2027', '999', '996']);
    assert.notEqual(scenario.contentArea.querySelector('.match-preview-card').querySelector('.match-preview-card__status').textContent, 'Ausgewählt');
}

{
    const unsafeRenderer = extractFunction('renderMatchPreview').replace(
        'element.textContent = text;',
        'element.innerHTML = text;',
    );
    const scenario = renderScenario(true, unsafeRenderer);
    assert.equal(scenario.document.usedUnsafePlayerHtml, true,
        'the strict DOM harness must detect an unsafe external-value innerHTML regression');
    assert.ok(scenario.contentArea.querySelectorAll('IMG').length
        + scenario.contentArea.querySelectorAll('SVG').length
        + scenario.contentArea.querySelectorAll('SCRIPT').length > 0);
}

{
    const scenario = renderScenario(false);
    scenario.contentArea.querySelector('.match-preview-calculate').dispatchEvent({ type: 'click' });
    const result = scenario.document.getElementById('preview-results').textContent;
    assert.match(result, /Relative Aufstellungsstärke/);
    assert.match(result, /Datenqualität der Teams: sehr unsicher/);
    assert.doesNotMatch(result, /% Siegchance|Heimsieg \d+%|Auswärtssieg \d+%/);
}

{
    const scenario = renderScenario(false, extractFunction('renderMatchPreview'), { reducedMotion: true });
    scenario.contentArea.querySelector('.match-preview-calculate').dispatchEvent({ type: 'click' });
    assert.equal(scenario.document.scrollCalls.at(-1).behavior, 'auto');
}

for (const selector of ['.match-preview-shell', '.match-preview-team-grid', '.match-preview-player', '.match-preview-evidence', '.match-preview-lineup-grid', '.match-preview-probability-grid']) {
    assert.match(styles, new RegExp(selector.replace('.', '\\.') + '\\s*\\{'));
}
assert.match(styles, /@media\s*\(max-width:\s*390px\)/);
assert.match(styles, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.match-preview-probability-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
assert.match(styles, /min-height:\s*44px/);
assert.match(styles, /prefers-reduced-motion:\s*reduce/);
assert.match(styles, /\.visually-hidden\s*\{/);
assert.match(styles, /\.match-preview-next-games\s*\{[\s\S]*?overflow:\s*visible/);
assert.match(styles, /\.match-preview-carousel__track\s*\{[\s\S]*?overflow-x:\s*auto[\s\S]*?scroll-snap-type:\s*x\s+mandatory/);
assert.match(styles, /\.match-preview-card\s*\{[\s\S]*?scroll-snap-align:\s*start/);
assert.match(styles, /\.match-preview-card__select\s*\{[\s\S]*?min-height:\s*max\(44px,\s*10\.75rem\)/);
assert.match(styles, /\.match-preview-card\[data-state="selected"\]\s+\.match-preview-card__select\s*\{/);
assert.match(styles, /\.match-preview-card\[data-state="incomplete"\]\s+\.match-preview-card__select\s*\{/);
assert.match(styles, /\.match-preview-matrix-scroll\s*\{[\s\S]*?overflow-x:\s*auto/);
assert.match(styles, /\.match-preview-matrix\s*\{[\s\S]*?min-width:/);
assert.match(styles, /\.match-preview-matrix\s+th\[scope="row"\]\s*\{[\s\S]*?position:\s*sticky/);
assert.match(styles, /\.match-preview-matrix__cell--home\s*\{/);
assert.match(styles, /\.match-preview-matrix__cell--balanced\s*\{/);
assert.match(styles, /\.match-preview-matrix__cell--away\s*\{/);
assert.match(styles, /\.match-preview-matrix__uncertain\s*\{/);
assert.match(styles, /\.match-preview-matrix__scroll-hint\s*\{[\s\S]*?display:\s*block/);
assert.match(styles, /\.match-preview-matrix__scroll-hint\[hidden\]\s*\{[\s\S]*?display:\s*none/);
assert.match(styles, /\.match-preview-carousel__track:focus-visible[\s\S]*?\.match-preview-matrix-scroll:focus-visible/);
assert.match(styles, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.match-preview-card\s*\{[\s\S]*?flex-basis:/);
const rendererSource = source.slice(source.indexOf('function renderMatchPreview('), source.indexOf('window.triggerUpdate'));
assert.doesNotMatch(rendererSource, /\/api\//);
assert.doesNotMatch(rendererSource, /\.isTrusted\b/);

console.log('historical match preview UI contract: ok');
