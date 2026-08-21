const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    isByeOpponent,
    selectUpcomingGames,
    buildSeasonNotice,
    buildIcsContent,
    parseAppHash,
    diffVisitSnapshots,
    normalizeCalendarTeamName,
    resolveCalendarFeed,
    buildCalendarSubscriptionUrls,
} = require(path.join(__dirname, '..', 'app_utils.js'));

const reviewFailures = [];
function reviewCheck(name, check) {
    try {
        check();
    } catch (error) {
        reviewFailures.push(`${name}: ${error.message.split('\n')[0]}`);
    }
}

assert.equal(isByeOpponent('Spielfrei (DC Beispiel)'), true);
assert.equal(isByeOpponent('*** Freilos ***'), true);
assert.equal(isByeOpponent('DC Spielfreunde'), false);

assert.equal(normalizeCalendarTeamName('  DĆ  Straße!  '), 'dc strasse');
assert.equal(normalizeCalendarTeamName('ẞtraße'), 'sstrasse');
assert.equal(normalizeCalendarTeamName('AB\uFE0FCD'), 'abcd');
assert.equal(normalizeCalendarTeamName('AŁBøC'), 'a b c');
assert.equal(normalizeCalendarTeamName('  DC---Team\t\n2  '), 'dc team 2');
assert.equal(normalizeCalendarTeamName(null), '');
assert.equal(normalizeCalendarTeamName({ value: 'DC Team' }), '');

const publishedCalendarIndex = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'calendar_index.json'), 'utf8'),
);
const publishedCalendarEntries = Object.entries(publishedCalendarIndex.teams);
assert.ok(publishedCalendarEntries.length > 100, 'current generated index contains the published team catalog');
for (const [key, entry] of publishedCalendarEntries) {
    assert.equal(key, normalizeCalendarTeamName(key), `published key ${key} is canonical`);
    assert.deepEqual(resolveCalendarFeed(publishedCalendarIndex, key), {
        name: entry.name,
        path: entry.path,
    });
    assert.equal(resolveCalendarFeed(publishedCalendarIndex, entry.name).path, entry.path);
}

const calendarIndex = {
    schema_version: 1,
    teams: {
        'dc schomberg': {
            name: 'DC Schömberg',
            path: 'calendars/club-010-team-2.ics',
        },
        'dc schomberg 2': {
            name: 'DC Schömberg 2',
            path: 'calendars/club-010-team-2.ics',
        },
    },
};
assert.deepEqual(resolveCalendarFeed(calendarIndex, 'DC Schömberg'), {
    name: 'DC Schömberg',
    path: 'calendars/club-010-team-2.ics',
});
assert.deepEqual(resolveCalendarFeed(calendarIndex, 'DC Schömberg 2'), {
    name: 'DC Schömberg 2',
    path: 'calendars/club-010-team-2.ics',
});
const resolvedFeed = resolveCalendarFeed(calendarIndex, 'DC Schömberg');
resolvedFeed.name = 'mutated';
assert.equal(resolveCalendarFeed(calendarIndex, 'DC Schömberg').name, 'DC Schömberg');
assert.equal(resolveCalendarFeed({ schema_version: 2, teams: calendarIndex.teams }, 'DC Schömberg'), null);
assert.equal(resolveCalendarFeed({ schema_version: 1, teams: [] }, 'DC Schömberg'), null);
assert.equal(resolveCalendarFeed({ schema_version: 1, teams: { 'dc schomberg': { name: '', path: 'calendars/club-010-team-2.ics' } } }, 'DC Schömberg'), null);
for (const unsafePath of [
    'calendars/club-10-team-2.ics/extra',
    'calendars/club-10-team-2.ics?query',
    'calendars/club-10-team-2.ics#fragment',
    'calendars\\club-10-team-2.ics',
    'calendars/../club-10-team-2.ics',
    'calendars/club-%31-team-2.ics',
    'calendars/club-10-team-2.ics\n',
]) {
    assert.equal(resolveCalendarFeed({ schema_version: 1, teams: { safe: { name: 'Safe', path: unsafePath } } }, 'safe'), null);
}
const inheritedTeams = Object.create({ inherited: { name: 'Inherited', path: 'calendars/club-010-team-2.ics' } });
assert.equal(resolveCalendarFeed({ schema_version: 1, teams: inheritedTeams }, 'inherited'), null);
assert.deepEqual(
    resolveCalendarFeed(Object.freeze({
        schema_version: 1,
        teams: Object.freeze({
            'dc frozen': Object.freeze({ name: 'DC Frozen', path: 'calendars/club-010-team-2.ics' }),
        }),
    }), 'DC Frozen'),
    { name: 'DC Frozen', path: 'calendars/club-010-team-2.ics' },
);
assert.deepEqual(
    resolveCalendarFeed(JSON.parse(JSON.stringify(calendarIndex)), 'DC Schömberg'),
    { name: 'DC Schömberg', path: 'calendars/club-010-team-2.ics' },
);

function assertCalendarAccessorIsNeverRead(stage, throws) {
    const index = {
        schema_version: 1,
        teams: {
            'dc schomberg': { name: 'DC Schömberg', path: 'calendars/club-010-team-2.ics' },
        },
    };
    const entry = index.teams['dc schomberg'];
    const targets = {
        version: [index, 'schema_version', 1],
        teams: [index, 'teams', index.teams],
        team: [index.teams, 'dc schomberg', entry],
        name: [entry, 'name', 'DC Schömberg'],
        path: [entry, 'path', 'calendars/club-010-team-2.ics'],
    };
    const [target, key, result] = targets[stage];
    let calls = 0;
    delete target[key];
    Object.defineProperty(target, key, {
        enumerable: true,
        get() {
            calls += 1;
            if (throws) throw new Error(`${stage} getter ran`);
            return result;
        },
    });
    assert.equal(resolveCalendarFeed(index, 'DC Schömberg'), null, `${stage} accessor is rejected`);
    assert.equal(calls, 0, `${stage} getter is never executed`);
}

for (const stage of ['version', 'teams', 'team', 'name', 'path']) {
    assertCalendarAccessorIsNeverRead(stage, false);
    assertCalendarAccessorIsNeverRead(stage, true);
}
assert.equal(
    resolveCalendarFeed(new Proxy(calendarIndex, {
        getOwnPropertyDescriptor() { throw new Error('proxy descriptor trap'); },
    }), 'DC Schömberg'),
    null,
);

assert.deepEqual(
    buildCalendarSubscriptionUrls('calendars/club-010-team-2.ics', 'https://tobias-rohde-93.github.io/BWEDL-Stats/#profile'),
    {
        https: 'https://tobias-rohde-93.github.io/BWEDL-Stats/calendars/club-010-team-2.ics',
        webcal: 'webcal://tobias-rohde-93.github.io/BWEDL-Stats/calendars/club-010-team-2.ics',
    },
);
assert.deepEqual(
    buildCalendarSubscriptionUrls('calendars/club-010-team-2.ics', 'https://tobias-rohde-93.github.io/BWEDL-Stats/index.html?x=1#profile'),
    {
        https: 'https://tobias-rohde-93.github.io/BWEDL-Stats/calendars/club-010-team-2.ics',
        webcal: 'webcal://tobias-rohde-93.github.io/BWEDL-Stats/calendars/club-010-team-2.ics',
    },
);
for (const baseUri of [
    'http://tobias-rohde-93.github.io/BWEDL-Stats/',
    'file:///BWEDL-Stats/',
    'javascript:alert(1)',
    'data:text/plain,calendar',
    'https://user:pass@tobias-rohde-93.github.io/BWEDL-Stats/',
    'https://tobias-rohde-93.github.io/BWEDL-Stats',
    'not a URL',
]) {
    assert.equal(buildCalendarSubscriptionUrls('calendars/club-010-team-2.ics', baseUri), null);
}
assert.equal(buildCalendarSubscriptionUrls('calendars/../club-010-team-2.ics', 'https://tobias-rohde-93.github.io/BWEDL-Stats/'), null);

const schedule = [
    { id: 'open', opponent: 'DC Offen', isPending: true, date: null },
    { id: 'late', opponent: 'DC Spät', isPending: true, date: new Date(2026, 7, 28, 20, 0) },
    { id: 'bye', opponent: 'Spielfrei', isPending: true, date: new Date(2026, 7, 24) },
    { id: 'date-only', home: 'DC Heim', away: 'DC Tag', played: false, dateStr: '25.08.2026' },
    { id: 'early', home: 'DC Heim', away: 'DC Früh', played: false, dateStr: '25.08.2026 19:30' },
    { id: 'freilos', home: 'DC Heim', away: 'Freilos 1', played: false, dateStr: '26.08.2026' },
    { id: 'past', opponent: 'DC Gestern', isPending: true, date: new Date(2026, 7, 23, 20, 0) },
    { id: 'played', opponent: 'DC Erledigt', isPending: false, date: new Date(2026, 7, 27, 20, 0) },
];

const upcoming = selectUpcomingGames(schedule, new Date(2026, 7, 24, 12, 0));
assert.deepEqual(upcoming.map((game) => game.id), ['early', 'date-only', 'late', 'open']);
assert.equal(upcoming[1].dateStr, '25.08.2026', 'date-only games stay on their calendar day');

assert.deepEqual(
    buildSeasonNotice({ season: '2025/26', state: 'retained' }),
    {
        state: 'retained',
        season: '2025/26',
        title: 'Vorjahresstand 2025/26',
        message: 'Vorjahresstand 2025/26 – die neue Rangliste wird erst nach vollständigem Saisonstart aktiviert.',
    },
);
assert.deepEqual(
    buildSeasonNotice({ season: '2026/27', state: 'published' }),
    {
        state: 'published',
        season: '2026/27',
        title: 'Saison 2026/27',
        message: 'Aktueller Stand 2026/27.',
    },
);

const calendar = buildIcsContent({
    uid: 'spiel-42',
    dateStr: '28.08.2026 20:00',
    home: 'DC Heim, 1',
    away: 'DC Gast; 2',
    competition: 'A-Klasse\nStaffel 1',
    location: 'Vereinsheim; Hauptstraße 1',
});
assert.match(calendar, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
assert.match(calendar, /UID:spiel-42@bwedl-stats\r\n/);
reviewCheck('timed ICS values use unambiguous UTC', () => {
    assert.doesNotMatch(calendar, /TZID=Europe\/Berlin/);
    assert.match(calendar, /DTSTART:20260828T180000Z\r\n/);
    assert.match(calendar, /DTEND:20260828T210000Z\r\n/);
});
assert.match(calendar, /SUMMARY:DC Heim\\, 1 - DC Gast\\; 2\r\n/);
assert.match(calendar, /DESCRIPTION:A-Klasse\\nStaffel 1\r\n/);
assert.match(calendar, /LOCATION:Vereinsheim\\; Hauptstraße 1\r\n/);
assert.match(calendar, /END:VCALENDAR\r\n$/);

const calendarWithUnsafeUid = buildIcsContent({
    uid: 'id,semi;slash\\\r\nX-EVIL:true',
    dateStr: '28.08.2026 20:00',
    home: 'DC Heim',
    away: 'DC Gast',
});
const uidLines = calendarWithUnsafeUid
    .split('\r\n')
    .filter((line) => line.startsWith('UID:'));
assert.deepEqual(
    uidLines,
    [String.raw`UID:id\,semi\;slash\\\nX-EVIL:true@bwedl-stats`],
    'provided UIDs are escaped as one RFC5545 TEXT property line',
);
assert.equal(calendarWithUnsafeUid.includes('\r\nX-EVIL:true'), false);

const allDayCalendar = buildIcsContent({
    dateStr: '28.08.2026',
    home: 'DC Heim',
    away: 'DC Gast',
});
assert.match(allDayCalendar, /DTSTART;VALUE=DATE:20260828\r\n/);
assert.match(allDayCalendar, /DTEND;VALUE=DATE:20260829\r\n/);

reviewCheck('ambiguous browser date strings stay open', () => {
    const deterministicOrder = selectUpcomingGames(
        [
            { id: 'ambiguous', opponent: 'DC Offen', isPending: true, date: '03/04/2027' },
            { id: 'dated', opponent: 'DC Fix', isPending: true, dateStr: '05.04.2027 20:00' },
        ],
        new Date('2027-04-01T12:00:00Z'),
    );
    assert.deepEqual(deterministicOrder.map((game) => game.id), ['dated', 'ambiguous']);
});

reviewCheck('ICS lines fold at 75 UTF-8 octets', () => {
    const longHome = `DC ${'Ä'.repeat(45)}`;
    const longLocation = `Vereinsstätte ${'ü'.repeat(50)}, Hauptstraße 123`;
    const longCalendar = buildIcsContent({
        dateStr: '28.08.2026 20:00',
        home: longHome,
        away: 'DC Gäste',
        location: longLocation,
    });
    const physicalLines = longCalendar.split('\r\n').filter(Boolean);
    assert.equal(
        physicalLines.every((line) => Buffer.byteLength(line, 'utf8') <= 75),
        true,
    );
    assert.equal(physicalLines.some((line) => line.startsWith(' ')), true);
    const unfolded = longCalendar.replace(/\r\n[ \t]/g, '');
    assert.equal(unfolded.includes(`SUMMARY:${longHome} - DC Gäste`), true);
    assert.equal(
        unfolded.includes(`LOCATION:${longLocation.replace(',', '\\,')}`),
        true,
    );
});

const existingRoutes = new Set([
    'dashboard:',
    'ranking:Bezirksliga 2026/27',
]);
const routeExists = (type, id) => existingRoutes.has(`${type}:${id || ''}`);
assert.deepEqual(
    parseAppHash('#ranking/Bezirksliga%202026%2F27', routeExists),
    { type: 'ranking', id: 'Bezirksliga 2026/27' },
);
assert.deepEqual(parseAppHash('#ranking/%E0%A4%A', routeExists), { type: 'dashboard', id: null });
assert.deepEqual(parseAppHash('#unknown/value', routeExists), { type: 'dashboard', id: null });

assert.deepEqual(
    diffVisitSnapshots(
        {
            updatedAt: '2026-08-03T06:00:00Z',
            rank: 8,
            points: 102,
            resultCounts: { liga: 4, pokal: 1 },
            nextGame: { opponent: 'DC Alt', date: '2026-08-28T20:00:00' },
        },
        {
            updatedAt: '2026-08-04T06:00:00Z',
            rank: 7,
            points: 105,
            resultCounts: { liga: 5, pokal: 1 },
            nextGame: { opponent: 'DC Neu', date: '2026-09-01T19:30:00' },
        },
    ),
    [
        { type: 'rank', previous: 8, current: 7 },
        { type: 'points', previous: 102, current: 105 },
        { type: 'results', key: 'liga', previous: 4, current: 5 },
        {
            type: 'nextGame',
            previous: { opponent: 'DC Alt', date: '2026-08-28T20:00:00' },
            current: { opponent: 'DC Neu', date: '2026-09-01T19:30:00' },
        },
        {
            type: 'data',
            previous: '2026-08-03T06:00:00Z',
            current: '2026-08-04T06:00:00Z',
        },
    ],
);
assert.deepEqual(diffVisitSnapshots({ rank: 1 }, { rank: 1 }), []);
assert.deepEqual(diffVisitSnapshots(null, { rank: 1 }), []);

reviewCheck('snapshot diffs clone next-game values', () => {
    const previous = { nextGame: { opponent: 'DC Alt', details: { round: 3 } } };
    const current = { nextGame: { opponent: 'DC Neu', details: { round: 4 } } };
    const change = diffVisitSnapshots(previous, current).find((item) => item.type === 'nextGame');
    assert.notStrictEqual(change.previous, previous.nextGame);
    assert.notStrictEqual(change.current, current.nextGame);
    assert.notStrictEqual(change.current.details, current.nextGame.details);
    change.previous.opponent = 'Mutiert';
    change.current.details.round = 99;
    assert.equal(previous.nextGame.opponent, 'DC Alt');
    assert.equal(current.nextGame.details.round, 4);
});

reviewCheck('service worker cache contract is exact', () => {
    const worker = fs.readFileSync(path.join(__dirname, '..', 'sw_v31.js'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const appUtilsUrl = html.match(/<script src="(app_utils\.js\?v=[^"]+)"><\/script>/);
    assert.ok(appUtilsUrl, 'index uses a versioned app_utils request');
    assert.match(worker, /^const CACHE_NAME = 'bwedl-dashboard-v43';$/m);
    assert.doesNotMatch(worker, /bwedl-dashboard-v40/);
    assert.match(worker, new RegExp(`^\\s*'\\./${appUtilsUrl[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}',$`, 'm'));
});

if (reviewFailures.length > 0) {
    assert.fail(`quality review regressions:\n- ${reviewFailures.join('\n- ')}`);
}

console.log('user value utilities: ok');
