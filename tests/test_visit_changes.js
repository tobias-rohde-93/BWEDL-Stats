const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const {
    VISIT_SNAPSHOT_VERSION,
    buildVisitSnapshot,
    diffVisitSnapshots,
    readVisitSnapshot,
    persistVisitSnapshot,
} = require(path.join(ROOT, 'app_utils.js'));

function snapshot(overrides = {}) {
    return buildVisitSnapshot({
        data: {
            key: '2026-08-03T15:32:36Z|2026-06-10T03:04:09Z',
            updatedAt: '2026-08-03T15:32:36Z',
            timestamps: {
                leagues: '2026-08-03T15:32:36Z',
                rankings: '2026-06-10T03:04:09Z',
            },
        },
        player: {
            canonicalName: 'max mustermann',
            displayName: 'Max Mustermann',
            rank: 8,
            points: 102,
            rankingClass: 'A-Klasse',
            sourceSeason: '2025/26',
            sourceKey: 'rankings:2025/26:retained',
        },
        team: { id: '040:1', name: 'DC Beispiel', resultCount: 4 },
        nextGame: {
            key: 'A-Klasse:7:DC Beispiel:DC Gast',
            date: new Date('2026-08-28T18:00:00Z'),
            opponent: 'DC Gast',
            location: 'Vereinsheim',
            ignoredInternalField: 'not persisted',
        },
        ignoredFullDataset: [{ email: 'must-not-persist@example.test' }],
        ...overrides,
    });
}

function memoryStorage(initialValue = null) {
    return {
        value: initialValue,
        getItem() { return this.value; },
        setItem(_key, value) { this.value = value; },
    };
}

const current = snapshot();
assert.equal(current.version, VISIT_SNAPSHOT_VERSION);
assert.deepEqual(Object.keys(current).sort(), ['data', 'nextGame', 'player', 'team', 'version']);
assert.deepEqual(Object.keys(current.player).sort(), [
    'canonicalName', 'displayName', 'points', 'rank', 'rankingClass', 'sourceKey', 'sourceSeason',
]);
assert.deepEqual(Object.keys(current.nextGame).sort(), ['date', 'key', 'location', 'opponent']);
assert.equal(JSON.stringify(current).includes('must-not-persist'), false);
assert.equal(JSON.stringify(current).includes('example.test'), false);

// First visits and corrupt/incompatible storage recover silently, then establish a baseline.
for (const raw of [null, '{broken', JSON.stringify({ version: 999, player: {} })]) {
    const storage = memoryStorage(raw);
    assert.equal(readVisitSnapshot(storage), null);
    assert.deepEqual(diffVisitSnapshots(readVisitSnapshot(storage), current), []);
    assert.equal(persistVisitSnapshot(storage, current), true);
    assert.deepEqual(JSON.parse(storage.value), current);
}

const newerData = snapshot({
    data: { key: '2026-08-04T06:00:00Z|2026-06-10T03:04:09Z', updatedAt: '2026-08-04T06:00:00Z' },
});
assert.deepEqual(diffVisitSnapshots(current, newerData), [{
    type: 'data',
    message: 'Neue Daten seit deinem letzten Besuch.',
}]);

const newerRankingData = snapshot({
    data: {
        key: '2026-08-03T15:32:36Z|2026-06-11T03:04:09Z',
        updatedAt: '2026-08-03T15:32:36Z',
        timestamps: {
            leagues: '2026-08-03T15:32:36Z',
            rankings: '2026-06-11T03:04:09Z',
        },
    },
});
assert.deepEqual(diffVisitSnapshots(current, newerRankingData), [{
    type: 'data',
    message: 'Neue Daten seit deinem letzten Besuch.',
}]);

const rankChanged = snapshot({ player: { ...current.player, rank: 7 } });
assert.deepEqual(diffVisitSnapshots(current, rankChanged), [{
    type: 'rank',
    message: 'Dein Rang in der Saison 2025/26: 8 → 7.',
}]);

const pointsChanged = snapshot({ player: { ...current.player, points: 105 } });
assert.deepEqual(diffVisitSnapshots(current, pointsChanged), [{
    type: 'points',
    message: 'Deine Punkte in der Saison 2025/26: 102 → 105.',
}]);

const teamResultsChanged = snapshot({ team: { ...current.team, resultCount: 5 } });
assert.deepEqual(diffVisitSnapshots(current, teamResultsChanged), [{
    type: 'results',
    message: 'Für DC Beispiel liegt 1 neues Ergebnis vor.',
}]);

const rescheduled = snapshot({
    nextGame: { ...current.nextGame, date: '2026-08-29T18:00:00.000Z', location: 'Neue Spielstätte' },
});
assert.deepEqual(diffVisitSnapshots(current, rescheduled), [{
    type: 'nextGame',
    message: 'Dein nächstes Spiel gegen DC Gast wurde neu terminiert.',
}]);

assert.deepEqual(diffVisitSnapshots(current, snapshot()), []);
assert.deepEqual(diffVisitSnapshots(snapshot(), current), [], 'diffs are deterministic across equal snapshots');

const newSeason = snapshot({
    player: {
        ...current.player,
        rank: 41,
        points: 4,
        sourceSeason: '2026/27',
        sourceKey: 'rankings:2026/27:published',
    },
});
assert.deepEqual(
    diffVisitSnapshots(current, newSeason),
    [],
    'rank and points from a different source season are not presented as personal changes',
);

const differentProfile = snapshot({
    player: { ...current.player, canonicalName: 'erika musterfrau', displayName: 'Erika Musterfrau' },
});
assert.deepEqual(diffVisitSnapshots(current, differentProfile), []);
const differentTeam = snapshot({ team: { id: '041:1', name: 'DC Andere', resultCount: 9 } });
assert.deepEqual(diffVisitSnapshots(current, differentTeam), []);

const throwingStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('quota'); },
};
assert.equal(readVisitSnapshot(throwingStorage), null);
assert.equal(persistVisitSnapshot(throwingStorage, current), false);

const bundle = fs.readFileSync(path.join(ROOT, 'bundle_v31.js'), 'utf8');
assert.match(bundle, /const VISIT_SNAPSHOT_STORAGE_KEY = 'bwedl_visit_snapshot';/);
assert.match(bundle, /function buildCurrentVisitSnapshot\(/);
assert.match(bundle, /function refreshVisitSnapshotBaseline\(/);
assert.match(bundle, /function renderVisitChanges\(/);
assert.match(bundle, /BwedlAppUtils\.diffVisitSnapshots\(previousSnapshot, currentSnapshot\)/);
assert.match(bundle, /BwedlAppUtils\.persistVisitSnapshot\(localStorage, currentSnapshot/);
assert.match(bundle, /card\.className = 'visit-changes-card';/);
assert.match(bundle, /dismiss\.textContent = 'Schließen';/);
assert.match(bundle, /message\.textContent = change\.message;/);
assert.doesNotMatch(bundle, /alert\([^)]*(?:Besuch|Änderung|Profil gespeichert)/i);

const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
assert.match(css, /\.visit-changes-card\s*\{/);
assert.match(css, /\.visit-changes-card__dismiss\s*\{/);

console.log('visit changes: ok');
