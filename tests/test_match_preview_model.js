'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Model = require('../match_preview_model.js');
const committedLeagueData = require('../league_data.json');

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
assert.equal(Model.normalizeLeagueClass('A Klasse 2026/2027'), 'A-Klasse');
assert.equal(Model.normalizeLeagueClass('B\u2011Klasse Gruppe B 2026/27'), 'B-Klasse');
assert.equal(Model.normalizeLeagueClass('C-Klasse Gruppe A2 26/27'), 'C-Klasse');
assert.equal(Model.normalizeLeagueClass('A-Klasse Gruppe Mixdorf'), 'A-Klasse');
assert.equal(Model.normalizeLeagueClass('B-Klasse Gruppe Cupertino'), 'B-Klasse');
assert.equal(Model.normalizeLeagueClass('A-Klasse Gruppe 2'), 'A-Klasse');
assert.equal(Model.normalizeLeagueClass('C-Klasse Gruppe C'), 'C-Klasse');
assert.equal(Model.normalizeLeagueClass('C-Klasse 20/22'), 'C-Klasse');
assert.equal(Model.normalizeLeagueClass('Bezirksliga 1999-00'), 'Bezirksliga');
assert.equal(Model.normalizeLeagueClass('A-Klasse 20/23'), null);
assert.equal(Model.normalizeLeagueClass('A-Klasse 20/19'), null);
assert.equal(Model.normalizeLeagueClass('Mix-Klasse Gruppe B'), null);
assert.equal(Model.normalizeLeagueClass('Ligapokal A-Klasse'), null);
assert.equal(Model.normalizeLeagueClass('ÄBezirksliga'), null, 'Unicode letters form a real boundary');
assert.equal(Model.normalizeLeagueClass('B-Klassenpokal'), null);
assert.equal(Model.normalizeLeagueClass('Oberliga'), null);
assert.equal(Model.normalizeLeagueClass('C\u2011Klasse Staffel Süd'), null);
assert.equal(Model.normalizeLeagueClass('A-Klasse Mixdorf'), null);
assert.equal(Model.normalizeLeagueClass('B-Klasse Cupertino'), null);
assert.equal(Model.normalizeLeagueClass('A/B'), null);
assert.equal(Model.normalizeLeagueClass('A-/B-Klasse'), null);
assert.equal(Model.normalizeLeagueClass('A-Klasse / B-Klasse'), null);
assert.equal(Model.normalizeLeagueClass('Bezirksliga A-Klasse'), null);
assert.equal(Model.normalizeLeagueClass('A / B-Klasse'), null);
assert.equal(Model.normalizeLeagueClass('A und B-Klasse'), null);
assert.equal(Model.normalizeLeagueClass('A- und B-Klasse'), null);
assert.equal(Model.normalizeLeagueClass('A & B-Klasse'), null);
assert.equal(Model.normalizeLeagueClass('A + B-Klasse'), null);
assert.equal(Model.normalizeLeagueClass('Bezirksliga / A'), null);
assert.equal(Model.normalizeLeagueClass('Pokalrunde A-Klasse'), null);
assert.equal(Model.normalizeLeagueClass('Cupfinale B-Klasse'), null);
assert.equal(Model.normalizeLeagueClass('Mixed C-Klasse'), null);
for (const label of [
    'Ligacup A-Klasse',
    'Supercup B-Klasse',
    'Mixgruppe C-Klasse',
    'Mixedklasse A-Klasse',
    'A bzw. B-Klasse',
    'A oder B-Klasse',
    'A,B-Klasse',
    'A|B-Klasse',
    'Oberliga A',
    'Pokalhalbfinale C-Klasse',
    'Ligapokalrunde A-Klasse',
    'A-Klasse; Freundschaft',
    'A-Klasse: Freundschaft',
    'A-Klasse \\ Freundschaft',
    'A-Klasse, Freundschaft',
    'A-Klasse gegen B-Klasse',
    'A-Klasse vs. B-Klasse',
    'A-Klasse u. B-Klasse',
    'A-Klasse Pokalspiel',
    'Ligapokalspiel A-Klasse',
    'Freundschaft A-Klasse',
    'A-Klasse Gruppe Süd',
]) {
    assert.equal(Model.normalizeLeagueClass(label), null, `${label} is not one regular class`);
}
assert.equal(Model.normalizeLeagueClass('A-Klasse 2025/2027'), 'A-Klasse');

const reservedCompetitionGroups = [
    'mix', 'mixed', 'mixklasse', 'mixgruppe', 'mixedklasse', 'mixedgruppe',
    'cup', 'cuprunde', 'cupfinale', 'cuphalbfinale', 'cupspiel',
    'pokal', 'pokalrunde', 'pokalfinale', 'pokalhalbfinale', 'pokalspiel',
    'ligapokal', 'ligapokalrunde', 'ligapokalfinale', 'ligapokalhalbfinale', 'ligapokalspiel',
    'ligacup', 'ligacuprunde', 'ligacupfinale', 'ligacuphalbfinale', 'ligacupspiel',
    'supercup', 'supercuprunde', 'supercupfinale', 'supercuphalbfinale', 'supercupspiel',
    'worldcup', 'worldcuprunde', 'worldcupfinale', 'worldcuphalbfinale', 'worldcupspiel',
    'eurocup', 'eurocuprunde', 'eurocupfinale', 'eurocuphalbfinale', 'eurocupspiel',
    'freundschaft',
];
for (const group of reservedCompetitionGroups) {
    assert.equal(Model.normalizeLeagueClass(`A-Klasse Gruppe ${group}`), null);
    assert.equal(Model.normalizeLeagueClass(`B-Klasse Gruppe ${group.toUpperCase()} 2026/27`), null);
}
assert.equal(Model.normalizeLeagueClass('C-Klasse Gruppe ＭＩＸ 2026-2027'), null,
    'reserved group names are rejected after NFKC normalization');

for (const label of Object.keys(committedLeagueData.leagues)) {
    let expectedClass = null;
    if (/^Bezirksliga 20[0-9]{2}-20[0-9]{2}$/u.test(label)) {
        expectedClass = 'Bezirksliga';
    } else {
        const regularMatch = /^([ABC])-Klasse Gruppe [A-Za-z0-9]+ 20[0-9]{2}-20[0-9]{2}$/u.exec(label);
        if (regularMatch) expectedClass = `${regularMatch[1]}-Klasse`;
    }
    assert.equal(
        Model.normalizeLeagueClass(label),
        expectedClass,
        `${label} follows the closed-world committed-label contract`,
    );
}

const compactSeparators = [
    ' / ', ',', ' , ', ' | ', ' & ', ' + ', ' und ', ' oder ', ' bzw. ', ' bzw ',
    '; ', ': ', ' \\ ', ' gegen ', ' vs. ', ' u. ',
];
for (const left of ['A', 'B', 'C']) {
    for (const right of ['A', 'B', 'C']) {
        if (left === right) continue;
        for (const separator of compactSeparators) {
            assert.equal(
                Model.normalizeLeagueClass(`${left}${separator}${right}-Klasse`),
                null,
                `${left}${separator}${right}-Klasse stays fail-closed`,
            );
        }
    }
}
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

let recordOwnKeysCalls = 0;
const trappedRecord = new Proxy(record({
    id: '7010', season: '2024/2025', name: 'Trapped Record', league: 'A-Klasse', mean: 5,
}), {
    ownKeys() {
        recordOwnKeysCalls += 1;
        throw new Error('record ownKeys failure');
    },
});
let extraGetterCalls = 0;
const accessorExtraRecord = record({
    id: '7011', season: '2024/2025', name: 'Accessor Extra', league: 'A-Klasse', mean: 5,
});
Object.defineProperty(accessorExtraRecord, 'extra', {
    enumerable: true,
    get() { extraGetterCalls += 1; throw new Error('extra getter must not run'); },
});
const trappedExtraValue = new Proxy({}, {
    ownKeys() { throw new Error('nested ownKeys failure'); },
});
const trappedExtraRecord = {
    ...record({ id: '7012', season: '2024/2025', name: 'Trapped Extra', league: 'A-Klasse', mean: 5 }),
    extra: trappedExtraValue,
};
const revokedRoundsHandle = Proxy.revocable({ R1: 5, R2: 5, R3: 5, R4: 5 }, {});
const revokedRoundsRecord = record({
    id: '7013', season: '2024/2025', name: 'Revoked Rounds', league: 'A-Klasse', mean: 5,
});
revokedRoundsRecord.rounds = revokedRoundsHandle.proxy;
revokedRoundsHandle.revoke();
const unsafeCloneIndex = Model.buildArchiveIndex({
    7010: [trappedRecord],
    7011: [accessorExtraRecord],
    7012: [trappedExtraRecord],
    7013: [revokedRoundsRecord],
});
assert.deepEqual(unsafeCloneIndex.unusablePlayerIds, ['7010', '7011', '7012', '7013']);
assert.equal(recordOwnKeysCalls > 0, true);
assert.equal(extraGetterCalls, 0);

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
let nestedMeanGetterCalls = 0;
const accessorMean = {};
Object.defineProperty(accessorMean, 'mean', {
    enumerable: true,
    get() { nestedMeanGetterCalls += 1; throw new Error('mean getter must not run'); },
});
assert.equal(Model.stabilizeSeasonRecord(shrinkIndex.histories['8100'][0], {
    'A-Klasse|2025/26': accessorMean,
}), null);
assert.equal(nestedMeanGetterCalls, 0);
const revokedMeanHandle = Proxy.revocable({ mean: 7.5 }, {});
revokedMeanHandle.revoke();
assert.equal(Model.stabilizeSeasonRecord(shrinkIndex.histories['8100'][0], {
    'A-Klasse|2025/26': revokedMeanHandle.proxy,
}), null);

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

function makeWeightedOutlierArchive({ lowOutlier = false } = {}) {
    const archive = makeTransitionArchive();
    archive['1007'] = [
        record({
            id: '1007', season: '2024/2025', name: 'Spieler 1007', league: 'A-Klasse',
            mean: lowOutlier ? 105 : 5, appearances: 99,
        }),
        record({
            id: '1007', season: '2025/2026', name: 'Spieler 1007', league: 'B-Klasse',
            mean: lowOutlier ? 6 : 106, appearances: 99,
        }),
    ];
    return archive;
}

for (const weightedOutlierArchive of [
    makeWeightedOutlierArchive(),
    makeWeightedOutlierArchive({ lowOutlier: true }),
]) {
    const before = JSON.stringify(weightedOutlierArchive);
    const weightedOutlierCalibration = Model.buildClassCalibration(weightedOutlierArchive);
    const transition = weightedOutlierCalibration.transitions['A-Klasse>B-Klasse'];
    const diagnostics = weightedOutlierCalibration.diagnostics.edges['A-Klasse>B-Klasse'];
    assert.equal(transition.offset, 1);
    assert.equal(transition.rawTotalWeight, 127);
    assert.equal(transition.totalWeight, 36);
    assert.equal(transition.weightMedian, 4);
    assert.equal(transition.weightCap, 8);
    assert.equal(transition.cappedWeightCount, 1);
    assert.equal(transition.weightMedianRule, 'lower-unweighted-raw-weight');
    assert.equal(diagnostics.observations.filter((item) => item.rawWeight === 99).length, 1);
    assert.equal(diagnostics.observations.filter((item) => item.effectiveWeight === 8).length, 1);
    assert.equal(JSON.stringify(weightedOutlierArchive), before);

    const reversedArchive = Object.fromEntries(
        Object.entries(weightedOutlierArchive).reverse().map(([id, history]) => [id, history.slice().reverse()]),
    );
    assert.equal(
        Model.buildClassCalibration(reversedArchive).transitions['A-Klasse>B-Klasse'].offset,
        1,
        'input and history ordering do not affect capped weighted calibration',
    );
}

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

// Task 4: historical priors use only the two newest eligible completed seasons.
const priorArchive = mergeArchives(makeTransitionArchive(), {
    7: [
        record({ id: '7', season: '2023/2024', name: 'Prior Seven', league: 'A-Klasse', mean: 2, appearances: 8, vNr: '035' }),
        record({ id: '7', season: '2024/2025', name: 'Prior Seven', league: 'A-Klasse', mean: 4, appearances: 8, vNr: '035' }),
        record({ id: '7', season: '2025/2026', name: 'Prior Seven', league: 'B-Klasse', mean: 7, appearances: 8, vNr: '035' }),
    ],
});
const priorIndex = Model.buildArchiveIndex(priorArchive);
const priorCalibration = Model.buildClassCalibration(priorArchive);
const prior = Model.buildHistoricalPrior({
    playerId: '7',
    targetClass: 'B-Klasse',
    archiveIndex: priorIndex,
    calibration: priorCalibration,
});
assert.deepEqual(prior.seasons.map((item) => item.season), ['2025/26', '2024/25']);
assert.deepEqual(prior.seasons.map((item) => item.weight), [0.7, 0.3]);
assert.equal(prior.seasons[0].raw, 7);
assert.equal(prior.seasons[0].classCalibrated, true);
assert.deepEqual(prior.sourceSeasons, ['2025/26', '2024/25']);
assert.equal(prior.provenance, 'historical-two-season');
assert.equal(Object.isFrozen(prior), true);
assert.equal(Object.isFrozen(prior.seasons), true);
assert.notEqual(prior.seasons[0], priorIndex.histories['7'][0]);

const oneSeasonPrior = Model.buildHistoricalPrior({
    playerId: '7', targetClass: 'B-Klasse', archiveIndex: priorIndex,
    calibration: priorCalibration, beforeSeason: '2025/26',
});
assert.deepEqual(oneSeasonPrior.sourceSeasons, ['2024/25', '2023/24']);
assert.deepEqual(oneSeasonPrior.seasons.map((item) => item.weight), [0.7, 0.3]);
assert.equal(oneSeasonPrior.sourceSeasons.includes('2025/26'), false, 'target season never leaks');

const singleArchive = {
    70: [record({ id: '70', season: '2024/2025', name: 'Single', league: 'B-Klasse', mean: 4, vNr: '035' })],
};
const singleIndex = Model.buildArchiveIndex(singleArchive);
const singleCalibration = Model.buildClassCalibration(singleArchive);
const singlePrior = Model.buildHistoricalPrior({
    playerId: '70', targetClass: 'B-Klasse', archiveIndex: singleIndex,
    calibration: singleCalibration,
});
assert.equal(singlePrior.seasons.length, 1);
assert.equal(singlePrior.seasons[0].weight, 1);
assert.equal(singlePrior.confidence, 'provisional');

const neutralPrior = Model.buildHistoricalPrior({
    playerId: '999', targetClass: 'B-Klasse', archiveIndex: singleIndex,
    calibration: singleCalibration, classMean: 5.25,
});
assert.equal(neutralPrior.rating, 5.25);
assert.equal(neutralPrior.neutralMean, 5.25);
assert.equal(neutralPrior.provenance, 'neutral-target-class-mean');
assert.equal(neutralPrior.confidence, 'very-low');
assert.deepEqual(neutralPrior.seasons, []);

const uncalibratedArchive = {
    71: [record({ id: '71', season: '2024/2025', name: 'Uncalibrated', league: 'A-Klasse', mean: 4, vNr: '035' })],
    72: [record({ id: '72', season: '2024/2025', name: 'Class Peer', league: 'A-Klasse', mean: 8, vNr: '036' })],
};
const uncalibratedIndex = Model.buildArchiveIndex(uncalibratedArchive);
const uncalibratedCalibration = Model.buildClassCalibration(uncalibratedArchive);
const uncalibratedPrior = Model.buildHistoricalPrior({
    playerId: '71', targetClass: 'B-Klasse', archiveIndex: uncalibratedIndex,
    calibration: uncalibratedCalibration, classMean: 5,
});
assert.equal(uncalibratedPrior.seasons[0].stable, 5);
assert.equal(uncalibratedPrior.seasons[0].converted, 5,
    'missing calibration never invents a factor');
assert.equal(uncalibratedPrior.classCalibrated, false);
assert.equal(uncalibratedPrior.confidence, 'very-low');

let priorOptionGetterCalls = 0;
const unsafePriorOptions = { targetClass: 'B-Klasse', archiveIndex: priorIndex };
Object.defineProperty(unsafePriorOptions, 'playerId', {
    enumerable: true,
    get() { priorOptionGetterCalls += 1; throw new Error('prior getter must not run'); },
});
assert.equal(Model.buildHistoricalPrior(unsafePriorOptions).provenance, 'neutral-target-class-mean');
assert.equal(priorOptionGetterCalls, 0);

// Current affiliation is globally authoritative, then exact historical club seasons fill gaps.
const rosterArchive = mergeArchives(priorArchive, {
    8: [record({ id: '8', season: '2025/2026', name: 'Eight Current', league: 'B-Klasse', mean: 6, appearances: 8, vNr: '035' })],
    9: [record({ id: '9', season: '2025/2026', name: 'Moved Player', league: 'B-Klasse', mean: 9, vNr: '035' })],
    11: [
        record({ id: '11', season: '2024/2025', name: 'Historic Latest', league: 'A-Klasse', mean: 5, appearances: 8, vNr: '035' }),
        record({ id: '11', season: '2025/2026', name: 'Historic Latest', league: 'B-Klasse', mean: 6, appearances: 8, vNr: '035' }),
    ],
    12: [record({ id: '12', season: '2025/2026', name: 'Same Name', league: 'B-Klasse', mean: 5, vNr: '035' })],
    13: [record({ id: '13', season: '2024/2025', name: 'Historic Fallback', league: 'B-Klasse', mean: 4, vNr: '035' })],
    14: [record({ id: '14', season: '2025/2026', name: 'Same Name', league: 'B-Klasse', mean: 4, vNr: '035' })],
});
const rosterCalibration = Model.buildClassCalibration(rosterArchive);
const currentPlayers = deepFreeze([
    { id: '7', name: 'Prior Seven', v_nr: '035', company: 'Team Exact', league: 'B-Klasse Gruppe 2 2026-2027', rounds: { R1: 8, R2: 6 } },
    { id: '8', name: 'Eight Current', v_nr: '035', company: 'Team Exact', league: 'B-Klasse Gruppe 2 2026-2027', rounds: rounds(7, 8) },
    { id: '9', name: 'Moved Player', v_nr: '999', company: 'Other Team', league: 'B-Klasse Gruppe 2 2026-2027', rounds: { R1: 10 } },
    { id: '', name: 'No Stable ID', v_nr: '035', company: 'Team Exact', league: 'B-Klasse Gruppe 2 2026-2027', rounds: { R1: 12 } },
]);
const currentBefore = JSON.stringify(currentPlayers);
const rosterBefore = JSON.stringify(rosterArchive);
const roster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Team Exact',
    targetLeague: 'B-Klasse Gruppe 2 2026-2027',
    currentPlayers, archiveData: rosterArchive, calibration: rosterCalibration,
});
assert.equal(roster.players.find((player) => player.id === '9'), undefined);
assert.equal(roster.players.find((player) => player.id === '7').evidence, 'current+history');
assert.equal(roster.players.find((player) => player.id === '11').rosterUnconfirmed, true);
assert.equal(roster.players.find((player) => player.id === '12').name, 'Same Name');
assert.equal(roster.players.find((player) => player.id === '14').name, 'Same Name',
    'same names with different stable IDs stay separate');
assert.equal(roster.players.some((player) => player.id === ''), false);
const blended = roster.players.find((player) => player.id === '8');
assert.equal(blended.currentAppearances, 8);
assert.equal(blended.currentWeight, 8 / 12);
assert.equal(blended.rating, (56 + 4 * blended.historicalPrior.rating) / 12);
assert.equal(blended.confidence, 'high');
assert.equal(JSON.stringify(currentPlayers), currentBefore);
assert.equal(JSON.stringify(rosterArchive), rosterBefore);
assert.equal(roster.players.find((player) => player.id === '13'), undefined,
    'preceding-season candidates are unnecessary once four identifiable candidates exist');

const fallbackRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse', currentPlayers: [],
    archiveData: {
        21: [record({ id: '21', season: '2025/2026', name: 'Latest One', league: 'B-Klasse', mean: 7, vNr: '035' })],
        22: [record({ id: '22', season: '2024/2025', name: 'Second One', league: 'B-Klasse', mean: 6, vNr: '035' })],
        23: [record({ id: '23', season: '2024/2025', name: 'Second Two', league: 'B-Klasse', mean: 5, vNr: '035' })],
        24: [record({ id: '24', season: '2024/2025', name: 'Second Three', league: 'B-Klasse', mean: 4, vNr: '035' })],
        25: [record({ id: '25', season: '2024/2025', name: 'Second Four', league: 'B-Klasse', mean: 3, vNr: '035' })],
    },
});
assert.deepEqual(fallbackRoster.players.map((player) => player.id), ['21', '22', '23', '24']);
assert.equal(fallbackRoster.players[0].evidence, 'historical');
assert.equal(fallbackRoster.players.slice(1).every((player) => (
    player.evidence === 'historical-fallback' && player.confidence === 'very-low'
)), true);

const historicalTransferRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse', currentPlayers: [],
    archiveData: {
        26: [
            record({ id: '26', season: '2024/2025', name: 'Historical Transfer', league: 'B-Klasse', mean: 7, vNr: '035' }),
            record({ id: '26', season: '2025/2026', name: 'Historical Transfer', league: 'B-Klasse', mean: 7, vNr: '036' }),
        ],
        27: [record({ id: '27', season: '2025/2026', name: 'Latest Home', league: 'B-Klasse', mean: 6, vNr: '035' })],
    },
});
assert.equal(historicalTransferRoster.players.some((player) => player.id === '26'), false,
    'latest historical club affiliation overrides the preceding-season fallback');

const currentWithoutHistory = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse', classMean: 5,
    currentPlayers: [{ id: '80', name: 'New Current', v_nr: '035', league: 'B-Klasse', rounds: { R1: 9, R2: 7 } }],
    archiveData: {},
});
assert.equal(currentWithoutHistory.players[0].historicalPrior.rating, 5);
assert.equal(currentWithoutHistory.players[0].rating, (16 + 4 * 5) / 6);
assert.equal(currentWithoutHistory.players[0].evidence, 'current');

const ambiguousRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse', archiveData: rosterArchive,
    currentPlayers: [
        { id: '90', name: 'Ambiguous', v_nr: '035', company: 'Team One', league: 'B-Klasse', rounds: { R1: 8 } },
        { id: '91', name: 'Other Team', v_nr: '035', company: 'Team Two', league: 'B-Klasse', rounds: { R1: 7 } },
    ],
});
assert.deepEqual(ambiguousRoster.players, []);
assert.equal(ambiguousRoster.diagnostics.ambiguousTeam, true);

let rosterGetterCalls = 0;
const guardedCurrent = [{ id: '100', name: 'Guarded', v_nr: '035', league: 'B-Klasse', rounds: { R1: 5 } }];
Object.defineProperty(guardedCurrent[0], 'company', {
    enumerable: true,
    get() { rosterGetterCalls += 1; throw new Error('company getter must not run'); },
});
assert.doesNotThrow(() => Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse', currentPlayers: guardedCurrent, archiveData: {},
}));
assert.equal(rosterGetterCalls, 0);

// Every forecast lineup has exactly four cloned, evidence-first slots.
const autoKnown = [
    { id: 'a', name: 'Rating First', adjustedRating: 9, rating: 9, evidence: 'historical', confidence: 'provisional' },
    { id: 'b', name: 'Evidence First', adjustedRating: 5, rating: 5, evidence: 'current', confidence: 'medium' },
];
const lineup = Model.completeLineup(autoKnown, { targetClass: 'B-Klasse', classMean: 5.25, size: 4 });
assert.equal(lineup.length, 4);
assert.equal(lineup[0].id, 'b');
assert.equal(lineup.filter((slot) => slot.evidence === 'neutral').length, 2);
assert.equal(lineup.every((slot) => slot.adjustedRating > 0), true);
assert.equal(lineup[2].name, 'Unbekannter Spieler (Klassenwert)');
assert.equal(lineup.teamConfidence, 'very-low');
assert.notEqual(lineup[0], autoKnown[1]);
const manualLineup = Model.completeLineup(autoKnown, {
    targetClass: 'B-Klasse', classMean: 5.25, size: 4, manual: true,
});
assert.deepEqual(manualLineup.slice(0, 2).map((slot) => slot.id), ['a', 'b']);
const trimmedLineup = Model.completeLineup([...autoKnown, ...autoKnown, ...autoKnown], {
    targetClass: 'B-Klasse', classMean: 5.25, size: 4, manual: true,
});
assert.equal(trimmedLineup.length, 4);

// Outcome reconstruction is exact, chronological, and deterministic.
function makeOutcomeArchive() {
    const archive = {};
    for (let index = 0; index < 8; index += 1) {
        const id = String(200 + index);
        const vNr = index < 4 ? '035' : '036';
        archive[id] = [
            record({ id, season: '2024/2025', name: `Outcome ${id}`, league: 'A-Klasse', mean: index < 4 ? 7 : 5, vNr }),
            record({ id, season: '2025/2026', name: `Outcome ${id}`, league: 'A-Klasse', mean: index < 4 ? 8 : 4, vNr }),
        ];
    }
    return archive;
}
const outcomeArchive = deepFreeze(makeOutcomeArchive());
const archiveTables = deepFreeze([{
    season: '2025/2026', league: 'A-Klasse', rows: [
        { round: 1, home: 'Alpha', away: 'Bravo', result: '9:7', matchId: 'm1' },
        { round: 1, home: 'Alpha', away: 'Bravo', result: '9:7', matchId: 'm1-duplicate' },
        { round: 2, home: 'Alpha', away: 'Unknown', homeScore: 8, awayScore: 8 },
        { round: 3, home: 'Alpha', away: 'Bravo', result: 'not-a-score' },
    ],
}]);
const outcomeClubs = deepFreeze([
    { number: '035', name: 'Alpha' },
    { number: '036', name: 'Bravo' },
]);
const training = Model.buildOutcomeTrainingExamples({
    archiveTables, archiveData: outcomeArchive, clubs: outcomeClubs,
});
assert.equal(training.length, 1);
assert.equal(training[0].outcome, 'home');
assert.equal(training[0].sourceSeasons.every((season) => season < '2025/26'), true);
assert.equal(training.diagnostics.accepted, 1);
assert.equal(training.diagnostics.excluded.duplicate, 1);
assert.equal(training.diagnostics.excluded.teamMapping, 1);
assert.equal(training.diagnostics.excluded.malformed, 1);
assert.equal(JSON.stringify(outcomeArchive), JSON.stringify(makeOutcomeArchive()));
assert.equal(JSON.stringify(training), JSON.stringify(Model.buildOutcomeTrainingExamples({
    archiveTables, archiveData: outcomeArchive, clubs: outcomeClubs,
})));

const ambiguousTraining = Model.buildOutcomeTrainingExamples({
    archiveTables: [{ season: '2025/2026', league: 'A-Klasse', rows: [
        { round: 1, home: 'Alpha', away: 'Bravo', result: '9:7' },
    ] }],
    archiveData: outcomeArchive,
    clubs: [...outcomeClubs, { number: '099', name: 'Alpha' }],
});
assert.equal(ambiguousTraining.length, 0);
assert.equal(ambiguousTraining.diagnostics.excluded.teamMapping, 1);

function makeOutcomeExamples({ wins = 20, draws = 10, losses = 20 } = {}) {
    const examples = [];
    for (let index = 0; index < wins; index += 1) {
        examples.push({ key: `h-${index}`, season: `20${10 + Math.floor(index / 10)}/11`, homeRating: 8, awayRating: 4, outcome: 'home' });
    }
    for (let index = 0; index < draws; index += 1) {
        examples.push({ key: `d-${index}`, season: `20${10 + Math.floor(index / 10)}/11`, homeRating: 6, awayRating: 6, outcome: 'draw' });
    }
    for (let index = 0; index < losses; index += 1) {
        examples.push({ key: `a-${index}`, season: `20${10 + Math.floor(index / 10)}/11`, homeRating: 4, awayRating: 8, outcome: 'away' });
    }
    return examples;
}

const outcomeExamples = deepFreeze(makeOutcomeExamples());
const outcomeExamplesBefore = JSON.stringify(outcomeExamples);
const outcomeModel = Model.calibrateOutcomeModel(outcomeExamples);
assert.equal(outcomeModel.calibrated, true);
assert.equal(Object.isFrozen(outcomeModel), true);
assert.equal(JSON.stringify(outcomeExamples), outcomeExamplesBefore);
assert.deepEqual(Model.calibrateOutcomeModel(outcomeExamples).params, outcomeModel.params,
    'grid-search tie resolution is deterministic');
assert.deepEqual(outcomeModel.parameterGrid, {
    scale: [0.5, 1, 2, 4],
    homeAdvantage: [0, 0.25, 0.5],
    drawPeak: [0.25, 0.5, 1],
    drawDecay: [0.25, 0.5, 1],
});

const homeLineup = Model.completeLineup(Array.from({ length: 4 }, (_, index) => ({
    id: `home-${index}`, name: `Home ${index}`, adjustedRating: 8, rating: 8,
    evidence: 'current', confidence: 'high',
})), { classMean: 5, manual: true });
const awayLineup = Model.completeLineup(Array.from({ length: 4 }, (_, index) => ({
    id: `away-${index}`, name: `Away ${index}`, adjustedRating: 4, rating: 4,
    evidence: 'current', confidence: 'high',
})), { classMean: 5, manual: true });
const forecast = Model.forecastMatch(homeLineup, awayLineup, { outcomeModel, home: true });
assert.equal(forecast.mode, 'probability');
assert.ok(Math.abs(forecast.home + forecast.draw + forecast.away - 1) < 1e-12);
for (const outcome of ['home', 'draw', 'away']) {
    assert.ok(forecast.low[outcome] <= forecast[outcome] && forecast[outcome] <= forecast.high[outcome]);
}
assert.equal(forecast.homeScore, 8);
assert.equal(forecast.awayScore, 4);

const fallback = Model.forecastMatch(homeLineup, awayLineup, {
    outcomeModel: Model.calibrateOutcomeModel(outcomeExamples.slice(0, 12)), home: true,
});
assert.equal(fallback.mode, 'relative');
assert.equal('home' in fallback, false);
assert.equal('draw' in fallback, false);
assert.equal('away' in fallback, false);
assert.equal(typeof fallback.uncertaintyText, 'string');

const placeholderLineup = Model.completeLineup(homeLineup.slice(0, 2), {
    classMean: 5, manual: true,
});
const placeholderForecast = Model.forecastMatch(placeholderLineup, awayLineup, { outcomeModel });
assert.ok(
    placeholderForecast.high.home - placeholderForecast.low.home
    > forecast.high.home - forecast.low.home,
    'neutral slots widen plausible probability ranges',
);

const symmetricExamples = deepFreeze(makeOutcomeExamples({ wins: 20, draws: 10, losses: 20 }));
const symmetricModel = Model.calibrateOutcomeModel(symmetricExamples);
assert.equal(symmetricModel.params.homeAdvantage, 0);
const forward = Model.forecastMatch(homeLineup, awayLineup, { outcomeModel: symmetricModel });
const reversed = Model.forecastMatch(awayLineup, homeLineup, { outcomeModel: symmetricModel });
assert.ok(Math.abs(forward.home - reversed.away) < 1e-12);
assert.ok(Math.abs(forward.away - reversed.home) < 1e-12);
assert.ok(Math.abs(forward.draw - reversed.draw) < 1e-12);

const duplicateExamples = [...makeOutcomeExamples(), makeOutcomeExamples()[0]];
assert.equal(Model.calibrateOutcomeModel(duplicateExamples).diagnostics.excludedDuplicate, 1,
    'exact match keys cannot be hidden in training twice');

let unsafeExampleGetterCalls = 0;
const unsafeExample = { key: 'unsafe' };
Object.defineProperty(unsafeExample, 'homeRating', {
    enumerable: true,
    get() { unsafeExampleGetterCalls += 1; throw new Error('example getter must not run'); },
});
const guardedModel = Model.calibrateOutcomeModel([...makeOutcomeExamples(), unsafeExample]);
assert.equal(guardedModel.calibrated, true);
assert.equal(guardedModel.diagnostics.excludedUnsafe, 1);
assert.equal(unsafeExampleGetterCalls, 0);
const extremeNumericModel = Model.calibrateOutcomeModel([
    ...makeOutcomeExamples(),
    { key: 'extreme', homeRating: Number.MAX_VALUE, awayRating: 1, outcome: 'home' },
]);
assert.equal(extremeNumericModel.diagnostics.excludedUnsafe, 1,
    'ratings beyond safe model arithmetic are excluded');

const keylessSyntheticExamples = makeOutcomeExamples().map(({ key: _key, ...example }) => example);
assert.equal(Model.calibrateOutcomeModel(keylessSyntheticExamples).calibrated, true,
    'independent synthetic examples do not need archive match keys');

const duplicateCurrentRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse', archiveData: {},
    currentPlayers: [
        { id: '300', name: 'Duplicate Current', v_nr: '035', league: 'B-Klasse', rounds: { R1: 5 } },
        { id: '300', name: 'Duplicate Current', v_nr: '035', league: 'B-Klasse', rounds: { R1: 5 } },
    ],
});
assert.equal(duplicateCurrentRoster.players.length, 1,
    'duplicate current rows never duplicate a stable player identity');

const explicitAmbiguousRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse', currentPlayers: [],
    archiveData: { 301: [record({ id: '301', season: '2025/2026', name: 'Guessed', league: 'B-Klasse', mean: 6, vNr: '035' })] },
    teamMappings: { '035': ['Team One', 'Team Two'] },
});
assert.deepEqual(explicitAmbiguousRoster.players, []);
assert.equal(explicitAmbiguousRoster.diagnostics.ambiguousTeam, true);

const revokedCurrentPlayers = Proxy.revocable([], {});
revokedCurrentPlayers.revoke();
assert.doesNotThrow(() => Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse', currentPlayers: revokedCurrentPlayers.proxy,
    archiveData: {},
}));

const revokedOutcomeRow = Proxy.revocable({}, {});
revokedOutcomeRow.revoke();
assert.doesNotThrow(() => Model.buildOutcomeTrainingExamples({
    archiveTables: [{ season: '2025/2026', league: 'A-Klasse', rows: [revokedOutcomeRow.proxy] }],
    archiveData: {}, clubs: outcomeClubs,
}));

let spoofGetterCalls = 0;
const spoofedOutcomeModel = { calibrated: true };
Object.defineProperty(spoofedOutcomeModel, 'params', {
    enumerable: true,
    get() { spoofGetterCalls += 1; throw new Error('spoof getter must not run'); },
});
assert.equal(Model.forecastMatch(homeLineup, awayLineup, {
    outcomeModel: spoofedOutcomeModel,
}).mode, 'relative');
assert.equal(spoofGetterCalls, 0);
const revokedLineupHandle = Proxy.revocable([], {});
revokedLineupHandle.revoke();
assert.doesNotThrow(() => Model.forecastMatch(revokedLineupHandle.proxy, awayLineup, {
    outcomeModel,
}));

console.log('historical match preview model: ok');
