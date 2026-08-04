const assert = require('node:assert/strict');
const path = require('node:path');

const {
    isByeOpponent,
    selectUpcomingGames,
    buildSeasonNotice,
    buildIcsContent,
    parseAppHash,
    diffVisitSnapshots,
} = require(path.join(__dirname, '..', 'app_utils.js'));

assert.equal(isByeOpponent('Spielfrei (DC Beispiel)'), true);
assert.equal(isByeOpponent('*** Freilos ***'), true);
assert.equal(isByeOpponent('DC Spielfreunde'), false);

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
assert.match(calendar, /DTSTART;TZID=Europe\/Berlin:20260828T200000\r\n/);
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

console.log('user value utilities: ok');
