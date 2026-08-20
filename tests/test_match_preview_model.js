'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Model = require('../match_preview_model.js');

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
}

function rounds(mean, appearances = 4) {
    return Object.fromEntries(
        Array.from({ length: appearances }, (_, index) => [`R${index + 1}`, mean]),
    );
}

function record({
    id,
    season,
    name,
    league,
    mean,
    appearances = 4,
    vNr = '001',
    totalsOnly = false,
}) {
    const result = {
        id: String(id),
        season,
        name,
        league,
        v_nr: vNr,
        points: mean * appearances,
    };
    if (!totalsOnly) {
        result.rounds = rounds(mean, appearances);
        result.appearances = appearances;
        result.points_per_appearance = appearances ? mean : 0;
    }
    return result;
}

function makeTransitionArchive({
    pairCount = 8,
    from = 'A-Klasse',
    fromMean = 5,
    to = 'B-Klasse',
    toMean = 6,
    fromSeason = '2024/2025',
    toSeason = '2025/2026',
    idStart = 1000,
} = {}) {
    const archive = {};
    for (let index = 0; index < pairCount; index += 1) {
        const id = String(idStart + index);
        archive[id] = [
            record({ id, season: fromSeason, name: `Spieler ${id}`, league: from, mean: fromMean }),
            record({ id, season: toSeason, name: `Spieler ${id}`, league: to, mean: toMean }),
        ];
    }
    return archive;
}

function mergeArchives(...archives) {
    return Object.assign({}, ...archives);
}

assert.equal(Object.isFrozen(Model), true, 'the public API is immutable');
assert.deepEqual(Model.CLASS_ORDER, ['Bezirksliga', 'A-Klasse', 'B-Klasse', 'C-Klasse']);
assert.equal(Model.PRIOR_APPEARANCES, 4);
assert.equal(Model.MIN_TRANSITIONS, 8);

const commonJsSentinel = Object.freeze({ owner: 'host' });
globalThis.BwedlMatchPreviewModel = commonJsSentinel;
delete require.cache[require.resolve('../match_preview_model.js')];
const reloadedCommonJsModel = require('../match_preview_model.js');
assert.equal(Object.isFrozen(reloadedCommonJsModel), true);
assert.equal(globalThis.BwedlMatchPreviewModel, commonJsSentinel,
    'CommonJS loading never creates or overwrites the browser global');
delete globalThis.BwedlMatchPreviewModel;

const browserSource = fs.readFileSync(path.join(__dirname, '..', 'match_preview_model.js'), 'utf8');
const browserContext = vm.createContext({});
vm.runInContext(browserSource, browserContext, { filename: 'match_preview_model.js' });
assert.equal(Object.isFrozen(browserContext.BwedlMatchPreviewModel), true);
assert.equal(browserContext.BwedlMatchPreviewModel.normalizeLeagueClass('A-Klasse'), 'A-Klasse');

assert.equal(Model.normalizeLeagueClass('B-Klasse Gruppe 2 2026-2027'), 'B-Klasse');
assert.equal(Model.normalizeLeagueClass('  BEZIRKSLIGA / Saison 2025/26  '), 'Bezirksliga');
assert.equal(Model.normalizeLeagueClass('C\u2011Klasse Staffel Süd'), 'C-Klasse');
assert.equal(Model.normalizeLeagueClass('Mix-Klasse Gruppe B'), null);
assert.equal(Model.normalizeLeagueClass('Ligapokal A-Klasse'), null);
assert.equal(Model.normalizeLeagueClass('ÄBezirksliga'), null, 'Unicode letters form a real boundary');
assert.equal(Model.normalizeLeagueClass('B-Klassenpokal'), null);
assert.equal(Model.normalizeLeagueClass('Oberliga'), null);
assert.equal(Model.normalizeLeagueClass('A-Klasse Mixdorf'), 'A-Klasse');
assert.equal(Model.normalizeLeagueClass('B-Klasse Cupertino'), 'B-Klasse');
assert.equal(Model.normalizeLeagueClass('A/B'), null);
assert.equal(Model.normalizeLeagueClass('A-/B-Klasse'), null);
assert.equal(Model.normalizeLeagueClass('A-Klasse / B-Klasse'), null);
assert.equal(Model.normalizeLeagueClass('Bezirksliga A-Klasse'), null);
assert.equal(Model.canonicalSeason('20/22'), '2020/22');
assert.equal(Model.canonicalSeason('22/23'), '2022/23');
assert.equal(Model.canonicalSeason('1999/00'), '1999/00');
assert.equal(Model.canonicalSeason('99/00'), '1999/00');

assert.deepEqual(Model.roundStats({ R2: 4, R1: '6', R3: 'x', R4: '', note: 99 }), {
    values: [6, 4],
    points: 10,
    appearances: 2,
    mean: 5,
});
assert.deepEqual(
    Model.roundStats({ R1: 0, R2: '0', R3: '01', R4: true, R5: -1, R6: 1.5, R7: 2 ** 53 }),
    { values: [0, 0], points: 0, appearances: 2, mean: 0 },
    'only canonical ASCII strings and nonnegative safe integer numbers count',
);
assert.deepEqual(Model.roundStats({ R1: Number.MAX_SAFE_INTEGER, R2: 1 }), {
    values: [], points: 0, appearances: 0, mean: 0,
}, 'an unsafe aggregate fails closed');
assert.deepEqual(Model.roundStats({ R1: 'x', R2: '' }), {
    values: [], points: 0, appearances: 0, mean: 0,
});
const negativeZeroStats = Model.roundStats({ R1: -0 });
assert.equal(Object.is(negativeZeroStats.values[0], -0), false);
assert.equal(Object.is(negativeZeroStats.points, -0), false);

let roundGetterCalls = 0;
const inheritedRounds = Object.create({ R1: 99 });
Object.defineProperty(inheritedRounds, 'R2', {
    enumerable: true,
    get() { roundGetterCalls += 1; return 88; },
});
Object.defineProperty(inheritedRounds, 'R3', { enumerable: true, value: 7 });
assert.deepEqual(Model.roundStats(inheritedRounds), { values: [7], points: 7, appearances: 1, mean: 7 });
assert.equal(roundGetterCalls, 0, 'round accessors are never invoked');

const sortableArchive = deepFreeze({
    '0042': [
        record({ id: '0042', season: '24-25', name: ' José   Mu\u0308ller ', league: 'A-Klasse', mean: 4 }),
        record({ id: '0042', season: '2023/24', name: 'JOSÉ Müller', league: 'A-Klasse', mean: 3 }),
        record({ id: '0042', season: '2025/2026', name: 'José Müller', league: 'B-Klasse', mean: 5 }),
    ],
});
const sortableBefore = JSON.stringify(sortableArchive);
const sortableIndex = Model.buildArchiveIndex(sortableArchive);
assert.deepEqual(sortableIndex.histories['0042'].map((item) => item.season), [
    '2025/26', '2024/25', '2023/24',
]);
assert.deepEqual(sortableIndex.unusablePlayerIds, []);
assert.notEqual(sortableIndex.histories['0042'][0], sortableArchive['0042'][2]);
assert.notEqual(sortableIndex.histories['0042'][0].rounds, sortableArchive['0042'][2].rounds);
assert.equal(JSON.stringify(sortableArchive), sortableBefore, 'indexing never mutates input');

const legacySeasonIndex = Model.buildArchiveIndex({
    43: [
        record({ id: '43', season: '1999/00', name: 'Legacy Player', league: 'A-Klasse', mean: 2, totalsOnly: true }),
        record({ id: '43', season: '20/22', name: 'Legacy Player', league: 'A-Klasse', mean: 3, totalsOnly: true }),
        record({ id: '43', season: '22/23', name: 'Legacy Player', league: 'B-Klasse', mean: 4, totalsOnly: true }),
    ],
});
assert.deepEqual(legacySeasonIndex.histories['43'].map((item) => [
    item.season, item.seasonStart, item.seasonEnd,
]), [
    ['2022/23', 2022, 2023],
    ['2020/22', 2020, 2022],
    ['1999/00', 1999, 2000],
]);

let archiveGetterCalls = 0;
const guardedArchive = Object.create({
    7000: [record({ id: '7000', season: '2024/2025', name: 'Inherited', league: 'A-Klasse', mean: 5 })],
});
Object.defineProperty(guardedArchive, '7001', {
    enumerable: true,
    get() { archiveGetterCalls += 1; return []; },
});
const guardedRecord = record({ id: '7002', season: '2024/2025', name: 'Safe', league: 'A-Klasse', mean: 5 });
Object.defineProperty(guardedRecord, 'name', {
    enumerable: true,
    get() { archiveGetterCalls += 1; return 'Unsafe'; },
});
guardedArchive['7002'] = [guardedRecord];
const guardedIndex = Model.buildArchiveIndex(guardedArchive);
assert.deepEqual(Object.keys(guardedIndex.histories), []);
assert.deepEqual(guardedIndex.unusablePlayerIds, ['7001', '7002']);
assert.equal(archiveGetterCalls, 0, 'archive and record accessors are never invoked');

const revokedArchiveHandle = Proxy.revocable({}, {});
revokedArchiveHandle.revoke();
const revokedArchiveIndex = Model.buildArchiveIndex(revokedArchiveHandle.proxy);
assert.deepEqual(Object.keys(revokedArchiveIndex.histories), []);
assert.equal(revokedArchiveIndex.diagnostics.invalidArchive, true);

let spoofedHistoryTrapCalls = 0;
const spoofedIndex = {
    kind: 'archive-index-v1',
    histories: new Proxy({}, {
        ownKeys() {
            spoofedHistoryTrapCalls += 1;
            throw new Error('spoofed histories must not be trusted');
        },
    }),
};
assert.deepEqual(Model.buildClassSeasonMeans(spoofedIndex), {});
assert.deepEqual(Model.buildClassCalibration(spoofedIndex).transitions, {});
assert.equal(spoofedHistoryTrapCalls, 0, 'only closure-branded indexes bypass raw archive validation');

const zeroId = '8000';
const zeroArchive = {
    [zeroId]: [{
        id: zeroId,
        season: '2025/2026',
        name: 'Ohne Einsatz',
        league: 'A-Klasse',
        v_nr: '001',
        points: 0,
        rounds: { R1: 'x', R2: '' },
        appearances: 0,
        points_per_appearance: 0,
    }],
};
const zeroIndex = Model.buildArchiveIndex(zeroArchive);
assert.equal(zeroIndex.histories[zeroId][0].completeEvidence, true);
assert.equal(zeroIndex.histories[zeroId][0].previewEligible, false);
assert.equal(Model.seasonalPerformance(zeroIndex.histories[zeroId][0]), null);

const shrinkArchive = {
    8100: [record({ id: '8100', season: '2025/2026', name: 'Small', league: 'A-Klasse', mean: 3 })],
    8101: [record({ id: '8101', season: '2025/2026', name: 'Large', league: 'A-Klasse', mean: 12 })],
};
const shrinkIndex = Model.buildArchiveIndex(shrinkArchive);
const shrinkMeans = Model.buildClassSeasonMeans(shrinkIndex);
assert.deepEqual(shrinkMeans['A-Klasse|2025/26'], {
    points: 60, appearances: 8, playerRecords: 2, mean: 7.5,
});
assert.equal(Model.stabilizeSeasonRecord(shrinkIndex.histories['8100'][0], shrinkMeans), 5.25);
let stabilizeGetterCalls = 0;
const spoofedStableRecord = {
    previewEligible: true,
    points: 12,
    appearances: 4,
    season: '2025/26',
};
Object.defineProperty(spoofedStableRecord, 'leagueClass', {
    enumerable: true,
    get() { stabilizeGetterCalls += 1; throw new Error('stable getter must not run'); },
});
assert.equal(Model.stabilizeSeasonRecord(spoofedStableRecord, shrinkMeans), null);
assert.equal(stabilizeGetterCalls, 0);

const overflowRecord = (id, value) => ({
    id,
    season: '2025/2026',
    name: `Overflow ${id}`,
    league: 'A-Klasse',
    v_nr: '001',
    points: value,
    rounds: { R1: value },
    appearances: 1,
    points_per_appearance: value,
});
const overflowFirst = {
    '09000': [overflowRecord('09000', Number.MAX_SAFE_INTEGER)],
    '09001': [overflowRecord('09001', 1)],
};
const overflowLast = {
    '09001': [overflowRecord('09001', 1)],
    '09000': [overflowRecord('09000', Number.MAX_SAFE_INTEGER)],
};
for (const archiveOrder of [overflowFirst, overflowLast]) {
    const mean = Model.buildClassSeasonMeans(archiveOrder)['A-Klasse|2025/26'];
    assert.equal(mean.mean, 4503599627370496);
    assert.equal(mean.points, '9007199254740992');
    assert.equal(mean.appearances, 2);
}

const negativeZeroIndex = Model.buildArchiveIndex({
    9002: [{
        id: '9002', season: '2025/2026', name: 'Negative Zero', league: 'A-Klasse', v_nr: '001',
        points: -0, rounds: { R1: -0 }, appearances: 1, points_per_appearance: -0,
    }],
});
const negativeZeroRecord = negativeZeroIndex.histories['9002'][0];
assert.equal(Object.is(negativeZeroRecord.points, -0), false);
assert.equal(Object.is(negativeZeroRecord.rounds.R1, -0), false);
assert.equal(Object.is(negativeZeroRecord.points_per_appearance, -0), false);

const baseArchive = deepFreeze(makeTransitionArchive());
const baseBefore = JSON.stringify(baseArchive);
const calibration = Model.buildClassCalibration(baseArchive);
assert.equal(calibration.transitions['A-Klasse>B-Klasse'].count, 8);
assert.equal(calibration.transitions['A-Klasse>B-Klasse'].offset, 1);
assert.equal(calibration.transitions['A-Klasse>B-Klasse'].totalWeight, 32);
assert.equal(calibration.transitions['A-Klasse>B-Klasse'].medianRule, 'lower-weighted');
assert.equal(calibration.diagnostics.excluded.invalidPerformance, 0);
assert.deepEqual(Model.convertClassRating(5.5, 'A-Klasse', 'B-Klasse', calibration), {
    rating: 6.5, calibrated: true, path: ['A-Klasse>B-Klasse'],
});
assert.equal(JSON.stringify(baseArchive), baseBefore, 'calibration never mutates input');

const insufficient = Model.buildClassCalibration(makeTransitionArchive({ pairCount: 7 }));
assert.equal(insufficient.transitions['A-Klasse>B-Klasse'], undefined);
assert.equal(insufficient.diagnostics.edges['A-Klasse>B-Klasse'].count, 7);
assert.deepEqual(Model.convertClassRating(5.5, 'A-Klasse', 'B-Klasse', insufficient), {
    rating: 5.5, calibrated: false, path: [],
});

const reverseCalibration = Model.buildClassCalibration(makeTransitionArchive({
    from: 'B-Klasse', fromMean: 6, to: 'A-Klasse', toMean: 5,
}));
assert.equal(reverseCalibration.transitions['A-Klasse>B-Klasse'].offset, 1);
assert.deepEqual(Model.convertClassRating(6.5, 'B-Klasse', 'A-Klasse', reverseCalibration), {
    rating: 5.5, calibrated: true, path: ['A-Klasse>B-Klasse'],
});

const joinedLegacySpanCalibration = Model.buildClassCalibration(makeTransitionArchive({
    fromSeason: '20/22',
    toSeason: '22/23',
}));
assert.equal(joinedLegacySpanCalibration.transitions['A-Klasse>B-Klasse'].count, 8,
    'a legacy two-year season can transition when its end meets the next start');

const chainedCalibration = Model.buildClassCalibration(mergeArchives(
    makeTransitionArchive({
        from: 'Bezirksliga', fromMean: 4, to: 'A-Klasse', toMean: 5, idStart: 2000,
    }),
    makeTransitionArchive({
        from: 'A-Klasse', fromMean: 5, to: 'B-Klasse', toMean: 7, idStart: 3000,
    }),
));
assert.deepEqual(Model.convertClassRating(5.5, 'Bezirksliga', 'B-Klasse', chainedCalibration), {
    rating: 8.5,
    calibrated: true,
    path: ['Bezirksliga>A-Klasse', 'A-Klasse>B-Klasse'],
});
assert.deepEqual(Model.convertClassRating(8.5, 'B-Klasse', 'Bezirksliga', chainedCalibration), {
    rating: 5.5,
    calibrated: true,
    path: ['A-Klasse>B-Klasse', 'Bezirksliga>A-Klasse'],
});

const partialCalibration = Model.buildClassCalibration(makeTransitionArchive({
    from: 'Bezirksliga', fromMean: 4, to: 'A-Klasse', toMean: 5,
}));
assert.deepEqual(Model.convertClassRating(5.5, 'Bezirksliga', 'B-Klasse', partialCalibration), {
    rating: 5.5, calibrated: false, path: [],
}, 'a chain is all-or-nothing');
assert.deepEqual(Model.convertClassRating(5.5, 'A-Klasse', 'A-Klasse', calibration), {
    rating: 5.5, calibrated: true, path: [],
});
assert.deepEqual(Model.convertClassRating(Infinity, 'A-Klasse', 'B-Klasse', calibration), {
    rating: Infinity, calibrated: false, path: [],
});
assert.deepEqual(Model.convertClassRating(5.5, 'Mix-Klasse', 'B-Klasse', calibration), {
    rating: 5.5, calibrated: false, path: [],
});

const outlierArchive = makeTransitionArchive();
outlierArchive['1007'][1] = record({
    id: '1007', season: '2025/2026', name: 'Spieler 1007', league: 'B-Klasse', mean: 106,
});
const outlierCalibration = Model.buildClassCalibration(outlierArchive);
assert.equal(outlierCalibration.transitions['A-Klasse>B-Klasse'].offset, 1);
assert.deepEqual(outlierCalibration.diagnostics.edges['A-Klasse>B-Klasse'].observationRange, [1, 101]);

const tieArchive = makeTransitionArchive();
for (let index = 4; index < 8; index += 1) {
    const id = String(1000 + index);
    tieArchive[id][1] = record({
        id, season: '2025/2026', name: `Spieler ${id}`, league: 'B-Klasse', mean: 8,
    });
}
const tieCalibration = Model.buildClassCalibration(tieArchive);
assert.deepEqual(tieCalibration.diagnostics.edges['A-Klasse>B-Klasse'].observationRange, [1, 3]);
assert.equal(tieCalibration.transitions['A-Klasse>B-Klasse'].offset, 1,
    'an exact half-weight boundary selects the lower observation');

const badIdentityArchive = mergeArchives(makeTransitionArchive(), {
    4000: [
        record({ id: '4000', season: '2024/2025', name: 'Duplicate Season', league: 'A-Klasse', mean: 5 }),
        record({ id: '4000', season: '2024-2025', name: 'Duplicate Season', league: 'B-Klasse', mean: 6 }),
    ],
    4001: [
        record({ id: '4001', season: '2024/2025', name: 'Name One', league: 'A-Klasse', mean: 5 }),
        record({ id: '4001', season: '2025/2026', name: 'Name Two', league: 'B-Klasse', mean: 6 }),
    ],
    4002: [record({ id: '9999', season: '2024/2025', name: 'Inner Mismatch', league: 'A-Klasse', mean: 5 })],
    4005: [{
        id: '9998',
        season: 'not-a-season',
        name: 'Malformed Inner Mismatch',
        league: 'A-Klasse',
        points: 5,
    }],
    4003: [record({ id: '4003', season: '2024/2025', name: 'Shared Identity', league: 'A-Klasse', mean: 5 })],
    4004: [record({ id: '4004', season: '2025/2026', name: ' shared   identity ', league: 'B-Klasse', mean: 6 })],
    4006: [
        record({ id: '4006', season: '2024/2025', name: 'Duplicate Invalid', league: 'A-Klasse', mean: 5 }),
        { ...record({ id: '4006', season: '2024-2025', name: 'Duplicate Invalid', league: 'B-Klasse', mean: 6 }), points: -1 },
    ],
    4007: [
        record({ id: '4007', season: '2024/2025', name: 'Valid Name', league: 'A-Klasse', mean: 5 }),
        { ...record({ id: '4007', season: '2025/2026', name: 'Contradictory Name', league: 'B-Klasse', mean: 6 }), points: -1 },
    ],
});
const accessorIdentityRecord = record({
    id: '4008', season: '2024/2025', name: 'Accessor Identity', league: 'A-Klasse', mean: 5,
});
Object.defineProperty(accessorIdentityRecord, 'id', {
    enumerable: true,
    get() { throw new Error('identity getter must not run'); },
});
badIdentityArchive['4008'] = [accessorIdentityRecord];
const revokedRecordHandle = Proxy.revocable(record({
    id: '4009', season: '2024/2025', name: 'Revoked Record', league: 'A-Klasse', mean: 5,
}), {});
revokedRecordHandle.revoke();
badIdentityArchive['4009'] = [revokedRecordHandle.proxy];
const revokedHistoryHandle = Proxy.revocable([], {});
revokedHistoryHandle.revoke();
badIdentityArchive['4010'] = revokedHistoryHandle.proxy;
const badIdentityIndex = Model.buildArchiveIndex(badIdentityArchive);
assert.deepEqual(badIdentityIndex.unusablePlayerIds, [
    '4000', '4001', '4002', '4005', '4006', '4007', '4008', '4009', '4010',
]);
assert.equal(badIdentityIndex.histories['1000'].length, 2, 'valid players remain available');
assert.equal(badIdentityIndex.histories['4000'], undefined);
assert.equal(badIdentityIndex.histories['4003'].length, 1);
assert.equal(badIdentityIndex.histories['4004'].length, 1,
    'equal names under distinct stable IDs remain distinct usable people');
const identityCalibration = Model.buildClassCalibration(badIdentityArchive);
assert.equal(identityCalibration.transitions['A-Klasse>B-Klasse'].count, 8,
    'bad identities do not block the archive and name-only records are never joined');

const totalsOnlyArchive = mergeArchives(makeTransitionArchive({ pairCount: 7 }), {
    5000: [
        record({ id: '5000', season: '2024/2025', name: 'Career Only', league: 'A-Klasse', mean: 5, totalsOnly: true }),
        record({ id: '5000', season: '2025/2026', name: 'Career Only', league: 'B-Klasse', mean: 6, totalsOnly: true }),
    ],
});
const totalsOnlyIndex = Model.buildArchiveIndex(totalsOnlyArchive);
assert.equal(totalsOnlyIndex.histories['5000'].length, 2, 'career-only records remain indexed');
assert.equal(totalsOnlyIndex.histories['5000'][0].completeEvidence, false);
assert.equal(totalsOnlyIndex.histories['5000'][0].previewEligible, false);
const totalsOnlyCalibration = Model.buildClassCalibration(totalsOnlyArchive);
assert.equal(totalsOnlyCalibration.transitions['A-Klasse>B-Klasse'], undefined);
assert.equal(totalsOnlyCalibration.diagnostics.edges['A-Klasse>B-Klasse'].count, 7);

const gapArchive = mergeArchives(
    makeTransitionArchive({ pairCount: 7 }),
    makeTransitionArchive({
        pairCount: 1,
        fromSeason: '2023/2024',
        toSeason: '2025/2026',
        idStart: 6000,
    }),
);
const gapCalibration = Model.buildClassCalibration(gapArchive);
assert.equal(gapCalibration.transitions['A-Klasse>B-Klasse'], undefined,
    'nonconsecutive seasons do not satisfy the threshold');
assert.equal(gapCalibration.diagnostics.excluded.nonconsecutive, 1);

const excludedPairArchive = mergeArchives(makeTransitionArchive({ pairCount: 7 }), {
    6100: [
        record({ id: '6100', season: '2024/2025', name: 'Same Class', league: 'A-Klasse', mean: 5 }),
        record({ id: '6100', season: '2025/2026', name: 'Same Class', league: 'A-Klasse', mean: 6 }),
    ],
    6101: [
        record({ id: '6101', season: '2024/2025', name: 'Too Few', league: 'A-Klasse', mean: 5, appearances: 3 }),
        record({ id: '6101', season: '2025/2026', name: 'Too Few', league: 'B-Klasse', mean: 6, appearances: 3 }),
    ],
});
const excludedPairCalibration = Model.buildClassCalibration(excludedPairArchive);
assert.equal(excludedPairCalibration.transitions['A-Klasse>B-Klasse'], undefined);
assert.equal(excludedPairCalibration.diagnostics.excluded.sameClass, 1);
assert.equal(excludedPairCalibration.diagnostics.excluded.insufficientAppearances, 1);

console.log('historical match preview model: ok');
