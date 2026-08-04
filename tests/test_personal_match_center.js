const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'bundle_v31.js'), 'utf8');
const clubData = require('../club_data.json');
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
    const functionStart = source.indexOf(`function ${name}(`);
    assert.notEqual(functionStart, -1, `Expected function ${name} to exist`);
    const start = source.slice(Math.max(0, functionStart - 6), functionStart) === 'async '
        ? functionStart - 6
        : functionStart;
    const openingBrace = source.indexOf('{', functionStart);
    return source.slice(start, findClosingBrace(openingBrace, name) + 1);
}

function compileFunction(name, dependencies = {}) {
    const names = Object.keys(dependencies);
    return Function(...names, `${extractFunction(name)}; return ${name};`)(
        ...names.map((dependency) => dependencies[dependency]),
    );
}

const calls = [];
const sessionStorage = {
    value: null,
    setItem(key, value) {
        calls.push(`store:${key}`);
        this.value = value;
    },
};
const rememberMatchPreviewGame = compileFunction('rememberMatchPreviewGame', {
    sessionStorage,
    MATCH_PREVIEW_SESSION_KEY: 'bwedl_match_preview_game',
});
const normalizeClubAlias = compileFunction('normalizeClubAlias');
const clubAliasDistance = compileFunction('clubAliasDistance');
const resolveHomeClub = compileFunction('resolveHomeClub', {
    clubData,
    normalizeClubAlias,
    clubAliasDistance,
});
const gameAddress = compileFunction('gameAddress', { resolveHomeClub });
const gameCompetition = compileFunction('gameCompetition');
const calendarGame = compileFunction('calendarGame', { gameAddress, gameCompetition });
const gameShareText = compileFunction('gameShareText', { gameAddress, gameCompetition });
const bestShareRoute = compileFunction('bestShareRoute', { resolveHomeClub, clubData });
const buildGameActions = compileFunction('buildGameActions', {
    rememberMatchPreviewGame,
    navigateTo: (route) => calls.push(`navigate:${route}`),
    downloadGameCalendar: () => calls.push('calendar'),
    shareCurrentView: (text, route) => calls.push({ text, route }),
    buildMapsUrl: (game) => gameAddress(game)
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(gameAddress(game))}`
        : '',
    gameShareText,
    bestShareRoute,
    calendarGame,
    window: { BwedlAppUtils },
});

const completeGame = {
    leagueName: 'A-Klasse 2026/27',
    home: 'DC Heim',
    away: 'DC Gast',
    dateStr: '28.08.2026 20:00',
    address: 'Hauptstraße 1, Pforzheim',
};
const actions = buildGameActions(completeGame);
assert.deepEqual(actions.map((action) => action.key), ['preview', 'calendar', 'share', 'maps']);
assert.equal(actions.every((action) => action.label && action.ariaLabel), true);
assert.deepEqual(
    { target: actions[3].target, rel: actions[3].rel },
    { target: '_blank', rel: 'noopener noreferrer' },
);

actions[0].activate();
assert.deepEqual(calls.slice(0, 2), ['store:bwedl_match_preview_game', 'navigate:matchPreview']);
assert.deepEqual(JSON.parse(sessionStorage.value), completeGame);
actions[1].activate();
actions[2].activate();
assert.equal(calls.includes('calendar'), true);
assert.equal(calls.some((call) => call && call.text && call.text.includes('DC Heim gegen DC Gast')), true);

assert.deepEqual(
    buildGameActions({ home: 'DC Heim', away: 'DC Gast', dateStr: '28.08.2026' })
        .map((action) => action.key),
    ['preview', 'calendar', 'share'],
    'missing address only removes the maps action',
);
assert.deepEqual(
    buildGameActions({ home: 'DC Heim', away: 'DC Gast', address: 'Pforzheim' })
        .map((action) => action.key),
    ['preview', 'share', 'maps'],
    'missing date only removes the calendar action',
);

const realisticDashboardGame = {
    leagueKey: 'A-Klasse Gruppe 1 2026/27',
    home: "DC Underground Fool's 2",
    away: 'DC Gast',
    dateStr: '28.08.2026 20:00',
};
const realisticClubGame = {
    leagueName: 'B-Klasse Gruppe 2 2026/27',
    home: 'Alla Häeeehr',
    away: 'DC Gast',
    dateStr: '29.08.2026',
};
for (const [game, expectedCompetition] of [
    [realisticDashboardGame, realisticDashboardGame.leagueKey],
    [realisticClubGame, realisticClubGame.leagueName],
]) {
    const enriched = calendarGame(game);
    const ics = BwedlAppUtils.buildIcsContent(enriched);
    assert.equal(enriched.competition, expectedCompetition);
    assert.ok(enriched.location.includes('Pforzheim'));
    assert.match(ics, new RegExp(`DESCRIPTION:${expectedCompetition.replace('/', '\\/')}`));
    assert.match(ics, /LOCATION:/);
}

for (const alias of [
    "DC Underground Fool's 2",
    'Alla Häeeehr',
    'Heavy Weights Brötzingen',
    'DC Ligthning Arrows',
]) {
    const resolved = resolveHomeClub({ home: alias });
    assert.ok(resolved, `Expected current club data to resolve home alias: ${alias}`);
    assert.ok(gameAddress({ home: alias }).length > 10);
}
assert.equal(
    gameAddress({ home: 'Völlig unbekannter Heimclub', away: "DC Underground Fool's 2" }),
    '',
    'an away-club match must never borrow the guest address',
);

const detailedActions = buildGameActions(realisticDashboardGame);
detailedActions.find((action) => action.key === 'share').activate();
const shareCall = calls.findLast((call) => call && call.text);
assert.match(shareCall.text, /DC Underground Fool's 2 gegen DC Gast/);
assert.match(shareCall.text, /28\.08\.2026 20:00/);
assert.match(shareCall.text, /A-Klasse Gruppe 1 2026\/27/);
assert.match(shareCall.text, /Pforzheim/);
assert.deepEqual(shareCall.route, bestShareRoute(realisticDashboardGame));
assert.equal(shareCall.route.type, 'club');

const downloadEvents = [];
const queuedTimers = [];
const statuses = [];
const fakeLink = {
    click: () => downloadEvents.push('click'),
    parentElement: null,
};
const fakeDocument = {
    body: {
        appendChild: (link) => {
            downloadEvents.push('append');
            link.parentElement = fakeDocument.body;
        },
        removeChild: (link) => {
            downloadEvents.push('remove');
            link.parentElement = null;
        },
    },
    createElement: () => fakeLink,
};
const fakeUrl = {
    createObjectURL: () => {
        downloadEvents.push('create');
        return 'blob:calendar';
    },
    revokeObjectURL: (url) => downloadEvents.push(`revoke:${url}`),
};
const downloadGameCalendar = compileFunction('downloadGameCalendar', {
    window: { BwedlAppUtils },
    document: fakeDocument,
    URL: fakeUrl,
    Blob: class Blob {},
    calendarGame,
    calendarFilename: () => 'dc-heim-dc-gast-2026-08-28.ics',
    setAppStatus: (status) => statuses.push(status),
    setTimeout: (callback) => queuedTimers.push(callback),
});
assert.equal(downloadGameCalendar(completeGame), true);
assert.deepEqual(downloadEvents, ['create', 'append', 'click']);
assert.equal(queuedTimers.length, 1);
assert.match(statuses.at(-1), /erstellt/i);
queuedTimers.shift()();
assert.deepEqual(downloadEvents, ['create', 'append', 'click', 'remove', 'revoke:blob:calendar']);

const failedStatuses = [];
const failedDownload = compileFunction('downloadGameCalendar', {
    window: { BwedlAppUtils },
    document: { createElement: () => { throw new Error('blocked'); } },
    URL: fakeUrl,
    Blob: class Blob {},
    calendarGame,
    calendarFilename: () => 'game.ics',
    setAppStatus: (status) => failedStatuses.push(status),
    setTimeout: () => assert.fail('failed download must not schedule success cleanup'),
});
assert.equal(failedDownload(completeGame), false);
assert.match(failedStatuses.at(-1), /nicht/i);

const navigationEvents = [];
const cardListeners = {};
const card = {
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { cardListeners[name] = handler; },
};
const configureGameCardNavigation = compileFunction('configureGameCardNavigation', {
    navigateTo: (...args) => navigationEvents.push(args),
    gameShareText,
});
configureGameCardNavigation(card, realisticDashboardGame);
assert.equal(card.attributes.role, 'button');
assert.equal(card.attributes.tabindex, '0');
assert.match(card.attributes['aria-label'], /A-Klasse/);
for (const key of ['Enter', ' ']) {
    let prevented = false;
    cardListeners.keydown({ key, target: card, currentTarget: card, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
}
assert.deepEqual(navigationEvents, [
    ['league', realisticDashboardGame.leagueKey],
    ['league', realisticDashboardGame.leagueKey],
]);
cardListeners.keydown({ key: 'Enter', target: {}, currentTarget: card, preventDefault: () => {} });
assert.equal(navigationEvents.length, 2, 'nested controls must not trigger card keyboard navigation');
cardListeners.click({
    target: { closest: (selector) => selector === '.game-actions' ? {} : null },
    currentTarget: card,
});
assert.equal(navigationEvents.length, 2, 'nested action clicks must not trigger league navigation');
cardListeners.click({ target: card, currentTarget: card });
assert.equal(navigationEvents.length, 3);

assert.match(source, /BwedlAppUtils\.selectUpcomingGames\(mySchedule/);
assert.match(source, /BwedlAppUtils\.selectUpcomingGames\(upcomingLeagueMatches/);
assert.match(source, /BwedlAppUtils\.selectUpcomingGames\(upcomingLigapokalMatches/);
assert.doesNotMatch(source, /mySchedule\.filter\(g => g\.isPending/);
assert.match(source, /createGameActionsElement\(game\)/);
assert.match(source, /createGameActionsElement\(m\)/);
assert.match(source, /readMatchPreviewGame\(\)/);
assert.doesNotMatch(source, /nextCard\.onclick\s*=/);

async function verifyCanonicalSharePayload() {
    const payloads = [];
    const routeHash = compileFunction('routeHash');
    const shareCurrentView = compileFunction('shareCurrentView', {
        currentState: { type: 'dashboard', id: null },
        routeExists: (type, id) => type === 'dashboard' || (type === 'club' && id === 2),
        routeHash,
        window: {
            location: { href: 'https://stats.example.test/#dashboard', hash: '#dashboard' },
            BwedlAppUtils,
        },
        navigator: { share: async (payload) => payloads.push(payload) },
        document: { title: 'BWEDL Stats' },
        setAppStatus: () => {},
    });
    const summary = "DC Underground Fool's 2 gegen DC Gast · 28.08.2026 20:00 · A-Klasse · Pforzheim";
    assert.equal(await shareCurrentView(summary, { type: 'club', id: 2 }), true);
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].text, summary);
    assert.equal(payloads[0].url, 'https://stats.example.test/#club/2');
}

verifyCanonicalSharePayload()
    .then(() => console.log('personal match center: ok'))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
