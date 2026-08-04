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
    clubData: { clubs: [{ name: 'DC Eins' }] },
    ligapokalArchive: { '2025/26': {} },
};

function createRoutingHarness(hash) {
    const historyCalls = [];
    const navigationCalls = [];
    const window = { location: { hash }, BwedlAppUtils };
    const history = {
        replaceState(...args) {
            historyCalls.push(args);
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
        ${initializeSource}
        return { initializeRouteFromLocation, getCurrentState: () => currentState };`,
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
}

for (const malformedHash of ['#ranking/%E0%A4%A', '#ranking/Nicht%20vorhanden', '#unknown/value']) {
    const harness = createRoutingHarness(malformedHash);
    harness.initializeRouteFromLocation();
    const expectedRoute = { type: 'dashboard', id: null };
    assert.deepEqual(harness.navigationCalls, [['dashboard', null, false]]);
    assert.deepEqual(harness.historyCalls, [[expectedRoute, '', '#dashboard']]);
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

    for (const share of [undefined, async () => { throw new Error('declined'); }]) {
        const harness = createShareHarness({ share, writeText: async () => {} });
        await harness.shareCurrentView('Aktuelle Rangliste');
        assert.deepEqual(harness.copied, ['https://example.test/app#ranking/Saison%202026%2F27']);
        assert.match(harness.statusNode.textContent, /kopiert/i);
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
