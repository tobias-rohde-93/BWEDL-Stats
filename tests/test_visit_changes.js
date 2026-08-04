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
    buildTeamResultsFingerprint,
    renderVisitChangesCard,
    startVisitChangesLifecycle,
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
            sourceState: 'retained',
            sourceKey: 'rankings:2025/26',
        },
        team: {
            id: '040:1',
            name: 'DC Beispiel',
            resultCount: 4,
            resultFingerprint: 'liga|2026-08-01|DC Beispiel|DC Alt|8:8',
            sourceSeason: '2026/27',
            sourceState: 'current',
            sourceKey: 'leagues:2026/27',
        },
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
    'sourceState',
]);
assert.deepEqual(Object.keys(current.nextGame).sort(), ['date', 'key', 'location', 'opponent']);
assert.deepEqual(Object.keys(current.team).sort(), [
    'id', 'name', 'resultCount', 'resultFingerprint', 'sourceKey', 'sourceSeason', 'sourceState',
]);
assert.equal(JSON.stringify(current).includes('must-not-persist'), false);
assert.equal(JSON.stringify(current).includes('example.test'), false);

// First visits and corrupt/incompatible storage recover silently, then establish a baseline.
for (const raw of [
    null,
    '{broken',
    JSON.stringify({ version: 999, player: {} }),
    JSON.stringify({ ...current, version: 1 }),
]) {
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

const newerDataAndRank = snapshot({
    data: newerData.data,
    player: { ...current.player, rank: 7 },
});
assert.deepEqual(
    diffVisitSnapshots(current, newerDataAndRank),
    [{ type: 'rank', message: 'Dein Rang in der Saison 2025/26: 8 → 7.' }],
    'a specific personal change suppresses the generic data timestamp message',
);

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

const correctedTeamResult = snapshot({
    team: {
        ...current.team,
        resultFingerprint: 'liga|2026-08-01|DC Beispiel|DC Alt|9:7',
    },
});
assert.deepEqual(diffVisitSnapshots(current, correctedTeamResult), [{
    type: 'results',
    message: 'Ergebnisse für DC Beispiel wurden aktualisiert.',
}]);

const completedResults = [
    {
        leagueKey: 'A-Klasse 2026/27', round: 2, dateStr: '08.08.2026 20:00',
        home: 'DC Beispiel', away: 'DC Zwei', score: '9:7', isPending: false,
    },
    {
        leagueKey: 'A-Klasse 2026/27', round: 1, dateStr: '01.08.2026 20:00',
        home: 'DC Eins', away: 'DC Beispiel', score: '8:8', isPending: false,
    },
    {
        leagueKey: 'A-Klasse 2026/27', round: 3, dateStr: '15.08.2026 20:00',
        home: 'DC Beispiel', away: 'DC Offen', score: '---', isPending: true,
    },
];
const resultFingerprint = buildTeamResultsFingerprint(completedResults);
assert.equal(resultFingerprint, buildTeamResultsFingerprint([...completedResults].reverse()));
assert.equal(resultFingerprint.includes('DC Offen'), false, 'pending games are not fingerprinted');
assert.notEqual(
    resultFingerprint,
    buildTeamResultsFingerprint([{ ...completedResults[0], score: '8:8' }, completedResults[1]]),
    'same-count score corrections change the compact fingerprint',
);
const maximumSeasonFingerprint = buildTeamResultsFingerprint(Array.from({ length: 18 }, (_, index) => ({
    leagueKey: 'A-Klasse 2026/27',
    round: index + 1,
    dateStr: `${String(index + 1).padStart(2, '0')}.08.2026 20:00`,
    home: 'DC Beispiel',
    away: `DC Gegner ${index + 1}`,
    score: '9:7',
    isPending: false,
})));
assert.ok(
    Buffer.byteLength(JSON.stringify(snapshot({
        team: { ...current.team, resultCount: 18, resultFingerprint: maximumSeasonFingerprint },
    })), 'utf8') < 4096,
    'a full-season current snapshot remains compact',
);

const rescheduled = snapshot({
    nextGame: { ...current.nextGame, date: '2026-08-29T18:00:00.000Z', location: 'Neue Spielstätte' },
});
assert.deepEqual(diffVisitSnapshots(current, rescheduled), [{
    type: 'nextGame',
    message: 'Dein nächstes Spiel gegen DC Gast wurde neu terminiert.',
}]);

const gameScheduled = snapshot({ data: newerData.data });
assert.deepEqual(diffVisitSnapshots(snapshot({ nextGame: null }), gameScheduled), [{
    type: 'nextGame',
    message: 'Nächstes Spiel gegen DC Gast angesetzt.',
}]);
assert.deepEqual(diffVisitSnapshots(current, snapshot({ data: newerData.data, nextGame: null })), [{
    type: 'nextGame',
    message: 'Dein nächstes Spiel wurde abgesagt oder entfernt.',
}]);
assert.deepEqual(diffVisitSnapshots(snapshot({ nextGame: null }), snapshot({ nextGame: null })), []);

assert.deepEqual(diffVisitSnapshots(current, snapshot()), []);
assert.deepEqual(diffVisitSnapshots(snapshot(), current), [], 'diffs are deterministic across equal snapshots');

const newSeason = snapshot({
    player: {
        ...current.player,
        rank: 41,
        points: 4,
        sourceSeason: '2026/27',
        sourceState: 'published',
        sourceKey: 'rankings:2026/27',
    },
});
assert.deepEqual(
    diffVisitSnapshots(current, newSeason),
    [],
    'rank and points from a different source season are not presented as personal changes',
);

const changedRankingState = snapshot({
    data: newerData.data,
    player: { ...current.player, rank: 2, points: 150, sourceState: 'published' },
});
assert.deepEqual(
    diffVisitSnapshots(current, changedRankingState),
    [{ type: 'data', message: 'Neue Daten seit deinem letzten Besuch.' }],
    'rank and points are not compared when the retained/published source state changes',
);

const changedRankingClass = snapshot({
    data: newerData.data,
    player: { ...current.player, rank: 2, points: 150, rankingClass: 'Bezirksliga' },
});
assert.deepEqual(
    diffVisitSnapshots(current, changedRankingClass),
    [{ type: 'data', message: 'Neue Daten seit deinem letzten Besuch.' }],
    'rank and points are not compared after a ranking-class move',
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

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.attributes = {};
        this.listeners = {};
        this.parentElement = null;
        this.removed = false;
        this.textContent = '';
    }

    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    append(...children) { children.forEach((child) => this.appendChild(child)); }
    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }
    remove() {
        this.removed = true;
        if (this.parentElement) {
            this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
            this.parentElement = null;
        }
    }
}

const fakeDocument = { createElement: (tagName) => new FakeElement(tagName) };

// Exercise the real lifecycle: build after data init, compare, render, then persist exactly once.
const lifecycleEvents = [];
let dataInitialized = false;
const lifecycleStorage = {
    value: JSON.stringify(current),
    getItem() { lifecycleEvents.push('get'); return this.value; },
    setItem(_key, value) { lifecycleEvents.push('set'); this.value = value; },
};
dataInitialized = true;
const lifecycle = startVisitChangesLifecycle({
    storage: lifecycleStorage,
    buildCurrentSnapshot: () => {
        assert.equal(dataInitialized, true);
        lifecycleEvents.push('build');
        return rankChanged;
    },
});
const dashboard = new FakeElement('main');
const retainedDashboardContent = new FakeElement('div');
dashboard.appendChild(retainedDashboardContent);
const originalAppend = dashboard.appendChild.bind(dashboard);
dashboard.appendChild = (child) => {
    lifecycleEvents.push('render');
    return originalAppend(child);
};
const card = lifecycle.render(fakeDocument, dashboard);
assert.deepEqual(lifecycleEvents, ['build', 'get', 'render']);
assert.equal(card.children[0].children[0].textContent, 'Seit deinem letzten Besuch');
assert.equal(card.children[1].children[0].textContent, 'Dein Rang in der Saison 2025/26: 8 → 7.');
assert.equal(lifecycle.confirmVisible(false), false, 'a detached dashboard cannot advance the baseline');
assert.equal(lifecycleStorage.value, JSON.stringify(current));
const contentArea = new FakeElement('div');
contentArea.appendChild(dashboard);
assert.equal(lifecycle.confirmVisible(dashboard.parentElement === contentArea), true);
assert.deepEqual(lifecycleEvents, ['build', 'get', 'render', 'set']);
assert.equal(lifecycle.render(fakeDocument, dashboard), null, 'one lifecycle never renders twice');
assert.equal(lifecycle.confirmVisible(true), false, 'one lifecycle never persists twice');
const storedAfterRender = lifecycleStorage.value;
card.children[0].children[1].listeners.click();
assert.equal(card.removed, true);
assert.deepEqual(dashboard.children, [retainedDashboardContent], 'dismiss only removes the change card');
assert.equal(lifecycleStorage.value, storedAfterRender, 'dismiss does not mutate the persisted baseline');

const interruptedStorage = memoryStorage(JSON.stringify(current));
const interruptedLifecycle = startVisitChangesLifecycle({
    storage: interruptedStorage,
    buildCurrentSnapshot: () => rankChanged,
});
interruptedLifecycle.render(fakeDocument, new FakeElement('main'));
assert.throws(() => { throw new Error('later dashboard renderer failed'); });
assert.equal(
    interruptedStorage.value,
    JSON.stringify(current),
    'a later render exception before attachment leaves the old baseline intact',
);

// A subsequent start sees the persisted baseline and does not duplicate the card.
const nextLifecycle = startVisitChangesLifecycle({
    storage: lifecycleStorage,
    buildCurrentSnapshot: () => rankChanged,
});
assert.equal(nextLifecycle.render(fakeDocument, dashboard), null);
assert.equal(nextLifecycle.confirmVisible(true), true);

// First/corrupt visits stay silent while still persisting after the render decision.
for (const raw of [null, '{broken']) {
    const events = [];
    const storage = {
        value: raw,
        getItem() { events.push('get'); return this.value; },
        setItem(_key, value) { events.push('set'); this.value = value; },
    };
    const firstLifecycle = startVisitChangesLifecycle({
        storage,
        buildCurrentSnapshot: () => { events.push('build'); return current; },
    });
    assert.equal(firstLifecycle.render(fakeDocument, new FakeElement('main')), null);
    assert.deepEqual(events, ['build', 'get']);
    assert.equal(firstLifecycle.confirmVisible(true), true);
    assert.deepEqual(events, ['build', 'get', 'set']);
}

// Storage security/quota failures are nonfatal on both read and write.
for (const storage of [
    { getItem() { throw new Error('security'); }, setItem() {} },
    { getItem() { return JSON.stringify(current); }, setItem() { throw new Error('quota'); } },
]) {
    const failedStorageLifecycle = startVisitChangesLifecycle({
        storage,
        buildCurrentSnapshot: () => rankChanged,
    });
    assert.doesNotThrow(() => {
        failedStorageLifecycle.render(fakeDocument, new FakeElement('main'));
        failedStorageLifecycle.confirmVisible(true);
    });
}

// Profile save/clear/team changes replace the baseline without comparing identities.
const baselineEvents = [];
const profileStorage = {
    value: JSON.stringify(current),
    getItem() { baselineEvents.push('get'); return this.value; },
    setItem(_key, value) { baselineEvents.push('set'); this.value = value; },
};
for (const changedSelection of [
    snapshot({
        player: { ...current.player, canonicalName: 'erika musterfrau', displayName: 'Erika Musterfrau' },
    }),
    snapshot({ player: null, team: null, nextGame: null }),
    snapshot({ team: { id: '041:1', name: 'DC Andere', resultCount: 9 } }),
]) {
    baselineEvents.length = 0;
    profileStorage.value = JSON.stringify(current);
    const baselineRefresh = startVisitChangesLifecycle({
        storage: profileStorage,
        buildCurrentSnapshot: () => { baselineEvents.push('build'); return changedSelection; },
        comparePrevious: false,
    });
    assert.equal(baselineRefresh.render(fakeDocument, new FakeElement('main')), null);
    assert.equal(baselineRefresh.confirmVisible(true), true);
    assert.deepEqual(baselineEvents, ['build', 'set']);
    const afterSelectionLifecycle = startVisitChangesLifecycle({
        storage: profileStorage,
        buildCurrentSnapshot: () => changedSelection,
    });
    assert.equal(afterSelectionLifecycle.render(fakeDocument, new FakeElement('main')), null);
    assert.equal(afterSelectionLifecycle.confirmVisible(true), true);
}

assert.equal(typeof renderVisitChangesCard, 'function');

const bundle = fs.readFileSync(path.join(ROOT, 'bundle_v31.js'), 'utf8');
assert.match(bundle, /const VISIT_SNAPSHOT_STORAGE_KEY = 'bwedl_visit_snapshot';/);
assert.match(bundle, /function buildCurrentVisitSnapshot\(/);
assert.match(bundle, /function refreshVisitSnapshotBaseline\(/);
assert.match(bundle, /BwedlAppUtils\.startVisitChangesLifecycle\(/);
assert.match(bundle, /visitChangesLifecycle\.render\(document, container\)/);
assert.match(bundle, /visitChangesLifecycle\.confirmVisible\(container\.parentElement === contentArea\)/);
assert.doesNotMatch(bundle, /alert\([^)]*(?:Besuch|Änderung|Profil gespeichert)/i);

const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
assert.match(css, /\.visit-changes-card\s*\{/);
assert.match(css, /\.visit-changes-card__dismiss\s*\{/);

console.log('visit changes: ok');
