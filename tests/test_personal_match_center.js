const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'bundle_v31.js'), 'utf8');
const clubData = require('../club_data.json');
const leagueData = require('../league_data.json');
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
const clubNameAliases = compileFunction('clubNameAliases', { normalizeClubAlias });
const resolveHomeClub = compileFunction('resolveHomeClub', {
    clubData,
    normalizeClubAlias,
    clubNameAliases,
});
const gameAddress = compileFunction('gameAddress', { resolveHomeClub });
const gameCompetition = compileFunction('gameCompetition');
const gameShareText = compileFunction('gameShareText', { gameAddress, gameCompetition });
const bestShareRoute = compileFunction('bestShareRoute', { resolveHomeClub, clubData });
const buildGameActions = compileFunction('buildGameActions', {
    rememberMatchPreviewGame,
    navigateTo: (route) => calls.push(`navigate:${route}`),
    shareCurrentView: (text, route) => calls.push({ text, route }),
    buildMapsUrl: (game) => gameAddress(game)
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(gameAddress(game))}`
        : '',
    gameShareText,
    bestShareRoute,
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
assert.deepEqual(actions.map((action) => action.key), ['league', 'preview', 'share', 'maps']);
assert.equal(actions.every((action) => action.label && action.ariaLabel), true);
assert.deepEqual(
    { target: actions[3].target, rel: actions[3].rel },
    { target: '_blank', rel: 'noopener noreferrer' },
);

actions[0].activate();
assert.equal(calls.at(-1), 'navigate:league');
actions[1].activate();
assert.deepEqual(calls.slice(-2), ['store:bwedl_match_preview_game', 'navigate:matchPreview']);
assert.deepEqual(JSON.parse(sessionStorage.value), completeGame);
actions[2].activate();
assert.equal(calls.some((call) => call && call.text && call.text.includes('DC Heim gegen DC Gast')), true);

assert.deepEqual(
    buildGameActions({ leagueName: 'A-Klasse', home: 'DC Heim', away: 'DC Gast', dateStr: '28.08.2026' })
        .map((action) => action.key),
    ['league', 'preview', 'share'],
    'missing address only removes the maps action',
);
assert.deepEqual(
    buildGameActions({ leagueName: 'A-Klasse', home: 'DC Heim', away: 'DC Gast', address: 'Pforzheim' })
        .map((action) => action.key),
    ['league', 'preview', 'share', 'maps'],
    'missing date keeps the non-calendar actions available',
);
assert.equal(
    buildGameActions({ home: 'DC Heim', away: 'DC Gast' }).some((action) => action.key === 'league'),
    false,
    'a game without a league does not render a dead league control',
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
assert.equal(normalizeClubAlias('DC Irish 26 e.V. 2'), 'dc irish 26 2');
assert.equal(normalizeClubAlias('DC Texas Team 2'), 'dc texas team 2');
assert.equal(normalizeClubAlias('ESV DC 25'), 'esv dc 25');
for (const alias of [
    'DC Irish 26 e.V. 2',
    'DC Irish 26 e.V. 3',
    'DC Irish 26 e.V. 4',
    'DC Irish 26 e.V. 5',
    'DC Texas Team 2',
    'DC Texas Team 3',
    'DC Texas Team 4',
    'ESV DC 25 2',
]) {
    const resolved = resolveHomeClub({ home: alias });
    assert.ok(resolved, `Expected squad marker after full club name to resolve: ${alias}`);
}
for (const alias of [
    "DC Mephisto's",
    'DC Strikers',
    'DC Strikers 2',
    'DC Underground Fools',
    'DC Underground Fools 2',
    'DC Underground Fools 4',
]) {
    assert.ok(resolveHomeClub({ home: alias }), `Expected explicit current-data alias to resolve: ${alias}`);
}

const auditedHomeTeams = [];
Object.values(leagueData.leagues || {}).forEach((league) => {
    Object.values(league.match_days || {}).forEach((matchDay) => {
        String(matchDay).split('\n').forEach((line) => {
            if (!/---\s*$/.test(line)) return;
            const match = line.match(
                /^(?:[A-Za-z]{2}\.\s*)?\d{1,2}\.\s*\d{1,2}\.\s*\d{4}(?:\s+\d{1,2}:\d{2})?\s+(.+?)\s+-\s+/,
            );
            if (match && !/spielfrei/i.test(match[1])) auditedHomeTeams.push(match[1].trim());
        });
    });
});
const unresolvedHomeTeams = auditedHomeTeams.filter((home) => !resolveHomeClub({ home }));
assert.ok(auditedHomeTeams.length > 1000, 'expected the current-data audit to cover the full schedule');
assert.deepEqual([...new Set(unresolvedHomeTeams)].sort(), []);

const longestMatchResolver = compileFunction('resolveHomeClub', {
    clubData: { clubs: [{ name: 'DC Texas' }, { name: 'DC Texas Team' }] },
    normalizeClubAlias,
    clubNameAliases,
});
assert.equal(longestMatchResolver({ home: 'DC Texas Team 2' }).club.name, 'DC Texas Team');
const ambiguousResolver = compileFunction('resolveHomeClub', {
    clubData: { clubs: [{ name: 'DC Doppel' }, { name: 'DC Doppel' }] },
    normalizeClubAlias,
    clubNameAliases,
});
assert.equal(ambiguousResolver({ home: 'DC Doppel 2' }), null);
assert.equal(resolveHomeClub({ home: 'DC Lightnang Arrows' }), null, 'unknown typos must not fuzzy-match');
assert.equal(resolveHomeClub({ home: 'ESV DC 252' }), null, 'fixed club numbers must remain meaningful');
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

assert.match(source, /BwedlAppUtils\.selectUpcomingGames\(mySchedule/);
assert.match(source, /BwedlAppUtils\.selectUpcomingGames\(upcomingLeagueMatches/);
assert.match(source, /BwedlAppUtils\.selectUpcomingGames\(upcomingLigapokalMatches/);
assert.doesNotMatch(source, /mySchedule\.filter\(g => g\.isPending/);
assert.match(source, /createGameActionsElement\(game\)/);
assert.match(source, /createClubMatchCard\(m, 'upcoming'\)/);
assert.match(source, /createGameActionsElement\(match\)/);
assert.match(source, /readMatchPreviewGame\(\)/);
assert.doesNotMatch(source, /nextCard\.onclick\s*=/);
assert.doesNotMatch(source, /function configureGameCardNavigation/);
assert.doesNotMatch(source, /nextCard\.setAttribute\(['"](?:role|tabindex)['"]/);
assert.match(source, /key: 'league'[\s\S]*label: 'Liga öffnen'/);

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
