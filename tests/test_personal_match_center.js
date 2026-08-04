const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'bundle_v31.js'), 'utf8');

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
const buildGameActions = compileFunction('buildGameActions', {
    rememberMatchPreviewGame,
    navigateTo: (route) => calls.push(`navigate:${route}`),
    downloadGameCalendar: () => calls.push('calendar'),
    shareCurrentView: (text) => calls.push(`share:${text}`),
    buildMapsUrl: (game) => game.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(game.address)}` : '',
    gameShareText: (game) => `${game.home} gegen ${game.away}`,
    window: { BwedlAppUtils: { buildIcsContent: (game) => game.dateStr ? 'BEGIN:VCALENDAR' : '' } },
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
assert.equal(calls.includes('share:DC Heim gegen DC Gast'), true);

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

const downloadEvents = [];
const fakeDocument = {
    body: {
        appendChild: () => downloadEvents.push('append'),
        removeChild: () => downloadEvents.push('remove'),
    },
    createElement: () => ({
        click: () => downloadEvents.push('click'),
    }),
};
const fakeUrl = {
    createObjectURL: () => {
        downloadEvents.push('create');
        return 'blob:calendar';
    },
    revokeObjectURL: (url) => downloadEvents.push(`revoke:${url}`),
};
const downloadGameCalendar = compileFunction('downloadGameCalendar', {
    window: { BwedlAppUtils: { buildIcsContent: () => 'BEGIN:VCALENDAR' } },
    document: fakeDocument,
    URL: fakeUrl,
    Blob: class Blob {},
    calendarFilename: () => 'dc-heim-dc-gast-2026-08-28.ics',
    setAppStatus: () => {},
});
assert.equal(downloadGameCalendar(completeGame), true);
assert.deepEqual(downloadEvents, ['create', 'append', 'click', 'remove', 'revoke:blob:calendar']);

assert.match(source, /BwedlAppUtils\.selectUpcomingGames\(mySchedule/);
assert.match(source, /BwedlAppUtils\.selectUpcomingGames\(upcomingLeagueMatches/);
assert.match(source, /BwedlAppUtils\.selectUpcomingGames\(upcomingLigapokalMatches/);
assert.doesNotMatch(source, /mySchedule\.filter\(g => g\.isPending/);
assert.match(source, /createGameActionsElement\(game\)/);
assert.match(source, /createGameActionsElement\(m\)/);
assert.match(source, /readMatchPreviewGame\(\)/);

console.log('personal match center: ok');
