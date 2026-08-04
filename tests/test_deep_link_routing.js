const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'bundle_v31.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const BwedlAppUtils = require(path.join(root, 'app_utils.js'));

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
                (state === 'single-quote' && character === "'") ||
                (state === 'double-quote' && character === '"') ||
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
        } else if (character === "'") state = 'single-quote';
        else if (character === '"') state = 'double-quote';
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
    const declarationStart = source.indexOf(`function ${name}(`);
    assert.notEqual(declarationStart, -1, `Expected function ${name} to exist`);
    const sourceStart = source.slice(Math.max(0, declarationStart - 6), declarationStart) === 'async '
        ? declarationStart - 6
        : declarationStart;
    const openingBrace = source.indexOf('{', declarationStart);
    const closingBrace = findClosingBrace(openingBrace, `function ${name}`);
    return source.slice(sourceStart, closingBrace + 1);
}

const routeExistsSource = extractFunction('routeExists');
const routeHashSource = extractFunction('routeHash');
const routesMatchSource = extractFunction('routesMatch');
const initializeSource = extractFunction('initializeRouteFromLocation');
const setStatusSource = extractFunction('setAppStatus');
const shareSource = extractFunction('shareCurrentView');
const initSource = extractFunction('init');
const navigateSource = extractFunction('navigateTo');

assert.match(initSource, /initializeRouteFromLocation\(\)/);
assert.doesNotMatch(
    initSource,
    /history\.replaceState\([^;]*#dashboard[^;]*\);\s*renderDashboard\(\)/s,
    'Startup must not overwrite a valid deep link with the dashboard',
);

const data = {
    leagueData: { leagues: { 'Bezirksliga Süd': {} } },
    rankingData: { rankings: { 'Saison 2026/27': [] } },
    clubData: { clubs: [{ name: 'DC Eins' }, { name: 'DC Zwei' }] },
    ligapokalArchive: { '2025/26': {} },
};

const routeExists = new Function(
    'leagueData',
    'rankingData',
    'clubData',
    'ligapokalArchive',
    `${routeExistsSource}; return routeExists;`,
)(data.leagueData, data.rankingData, data.clubData, data.ligapokalArchive);

assert.equal(routeExists('club', '0'), true);
assert.equal(routeExists('club', '1'), true);
for (const invalidClubId of ['00', '01', '-1', '1.0', '2', 'not-a-number']) {
    assert.equal(routeExists('club', invalidClubId), false, `Expected club/${invalidClubId} to be invalid`);
}

assert.match(source, /window\.addEventListener\(\s*['"]popstate['"]\s*,\s*initializeRouteFromLocation\s*\)/);
assert.match(source, /window\.addEventListener\(\s*['"]hashchange['"]\s*,\s*initializeRouteFromLocation\s*\)/);

function createRoutingHarness(hash) {
    const historyCalls = [];
    const navigationCalls = [];
    const window = { location: { hash }, BwedlAppUtils };
    const history = {
        state: null,
        replaceState(...args) {
            historyCalls.push(args);
            this.state = args[0];
            window.location.hash = args[2];
        },
    };
    const harness = new Function(
        'window',
        'history',
        'navigateTo',
        'leagueData',
        'rankingData',
        'clubData',
        'ligapokalArchive',
        `let currentState = null;
        ${routeExistsSource}
        ${routeHashSource}
        ${routesMatchSource}
        ${initializeSource}
        return {
            initializeRouteFromLocation,
            getCurrentState: () => currentState,
            setLocationHash: (hash) => { window.location.hash = hash; },
            clearHistoryState: () => { history.state = null; },
        };`,
    )(
        window,
        history,
        (...args) => navigationCalls.push(args),
        data.leagueData,
        data.rankingData,
        data.clubData,
        data.ligapokalArchive,
    );
    return { ...harness, historyCalls, navigationCalls };
}

{
    const harness = createRoutingHarness('#ranking/Saison%202026%2F27');
    harness.initializeRouteFromLocation();
    const expectedRoute = { type: 'ranking', id: 'Saison 2026/27' };
    assert.deepEqual(harness.navigationCalls, [['ranking', 'Saison 2026/27', false]]);
    assert.deepEqual(harness.historyCalls, [[expectedRoute, '', '#ranking/Saison%202026%2F27']]);
    assert.deepEqual(harness.getCurrentState(), expectedRoute);

    // A state-less popstate resolves the current hash rather than forcing the dashboard.
    harness.navigationCalls.length = 0;
    harness.historyCalls.length = 0;
    harness.setLocationHash('#league/Bezirksliga%20S%C3%BCd');
    harness.clearHistoryState();
    harness.initializeRouteFromLocation();
    const leagueRoute = { type: 'league', id: 'Bezirksliga Süd' };
    assert.deepEqual(harness.navigationCalls, [['league', 'Bezirksliga Süd', false]]);
    assert.deepEqual(harness.historyCalls, [[leagueRoute, '', '#league/Bezirksliga%20S%C3%BCd']]);
    assert.deepEqual(harness.getCurrentState(), leagueRoute);

    // Manual hash changes use the same resolver and a duplicate browser event does not re-render.
    harness.navigationCalls.length = 0;
    harness.historyCalls.length = 0;
    harness.setLocationHash('#club/0');
    harness.initializeRouteFromLocation();
    assert.deepEqual(harness.navigationCalls, [['club', '0', false]]);
    assert.deepEqual(harness.historyCalls, [[{ type: 'club', id: '0' }, '', '#club/0']]);
    harness.navigationCalls.length = 0;
    harness.historyCalls.length = 0;
    harness.initializeRouteFromLocation();
    assert.deepEqual(harness.navigationCalls, []);
    assert.deepEqual(harness.historyCalls, []);

    // An invalid state-less popstate is canonicalized to the rendered dashboard.
    harness.setLocationHash('#club/00');
    harness.clearHistoryState();
    harness.initializeRouteFromLocation();
    assert.deepEqual(harness.navigationCalls, [['dashboard', null, false]]);
    assert.deepEqual(harness.historyCalls, [[{ type: 'dashboard', id: null }, '', '#dashboard']]);
    assert.deepEqual(harness.getCurrentState(), { type: 'dashboard', id: null });
}

for (const malformedHash of ['#ranking/%E0%A4%A', '#ranking/Nicht%20vorhanden', '#unknown/value']) {
    const harness = createRoutingHarness(malformedHash);
    harness.initializeRouteFromLocation();
    const expectedRoute = { type: 'dashboard', id: null };
    assert.deepEqual(harness.navigationCalls, [['dashboard', null, false]]);
    assert.deepEqual(harness.historyCalls, [[expectedRoute, '', '#dashboard']]);
    assert.deepEqual(harness.getCurrentState(), expectedRoute);
}

{
    const pushCalls = [];
    const navigateTo = new Function(
        'history',
        'window',
        'backBtn',
        'closeMobileNavigation',
        `let currentState = null; ${routeHashSource}; ${navigateSource}; return navigateTo;`,
    )(
        { pushState: (...args) => pushCalls.push(args) },
        { scrollTo() {} },
        null,
        () => {},
    );
    navigateTo('__routing_contract__', 'Saison 2026/27');
    assert.deepEqual(
        pushCalls,
        [[{ type: '__routing_contract__', id: 'Saison 2026/27' }, '', '#__routing_contract__/Saison%202026%2F27']],
    );
}

assert.match(html, /id="app-status"[^>]*role="status"[^>]*aria-live="polite"/);
assert.match(css, /\.app-status\s*\{/);
assert.doesNotMatch(shareSource, /alert\s*\(/);

function createShareHarness({ share, writeText }) {
    const statuses = [];
    const shared = [];
    const copied = [];
    const statusNode = { textContent: '' };
    const navigator = {};
    if (share) navigator.share = async (payload) => {
        shared.push(payload);
        return share(payload);
    };
    if (writeText) navigator.clipboard = {
        async writeText(value) {
            copied.push(value);
            return writeText(value);
        },
    };
    const window = {
        location: { href: 'https://example.test/app#index.html', hash: '#ranking/old' },
    };
    const document = {
        getElementById(id) {
            return id === 'app-status' ? statusNode : null;
        },
    };
    const currentState = { type: 'ranking', id: 'Saison 2026/27' };
    const shareCurrentView = new Function(
        'navigator',
        'window',
        'document',
        'currentState',
        'statuses',
        'leagueData',
        'rankingData',
        'clubData',
        'ligapokalArchive',
        `${routeHashSource}
        ${routeExistsSource}
        ${setStatusSource}
        const originalSetAppStatus = setAppStatus;
        setAppStatus = (message) => { statuses.push(message); originalSetAppStatus(message); };
        ${shareSource}
        return shareCurrentView;`,
    )(
        navigator,
        window,
        document,
        currentState,
        statuses,
        data.leagueData,
        data.rankingData,
        data.clubData,
        data.ligapokalArchive,
    );
    return { shareCurrentView, shared, copied, statuses, statusNode };
}

(async () => {
    {
        const harness = createShareHarness({ share: async () => {}, writeText: async () => {} });
        await harness.shareCurrentView('Aktuelle Rangliste');
        assert.equal(harness.shared.length, 1);
        assert.equal(harness.copied.length, 0);
        assert.equal(harness.shared[0].url, 'https://example.test/app#ranking/Saison%202026%2F27');
        assert.match(harness.statusNode.textContent, /geteilt/i);
    }

    for (const share of [undefined, async () => { throw new Error('share failed'); }]) {
        const harness = createShareHarness({ share, writeText: async () => {} });
        await harness.shareCurrentView('Aktuelle Rangliste');
        assert.deepEqual(harness.copied, ['https://example.test/app#ranking/Saison%202026%2F27']);
        assert.match(harness.statusNode.textContent, /kopiert/i);
    }

    {
        const abortError = new Error('User cancelled');
        abortError.name = 'AbortError';
        const harness = createShareHarness({
            share: async () => { throw abortError; },
            writeText: async () => {},
        });
        await harness.shareCurrentView('Aktuelle Rangliste');
        assert.deepEqual(harness.copied, []);
        assert.match(harness.statusNode.textContent, /abgebrochen/i);
    }

    {
        const harness = createShareHarness({
            share: async () => { throw new Error('share failed'); },
            writeText: async () => { throw new Error('clipboard failed'); },
        });
        await assert.doesNotReject(() => harness.shareCurrentView('Aktuelle Rangliste'));
        assert.match(harness.statusNode.textContent, /nicht/i);
    }

    console.log('deep link routing and share feedback contract: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
