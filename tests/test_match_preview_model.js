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

const strictWindowArchive = {
    73: [
        record({ id: '73', season: '2023/2024', name: 'Strict Window', league: 'B-Klasse', mean: 9, vNr: '035' }),
        record({ id: '73', season: '2024/2025', name: 'Strict Window', league: 'B-Klasse', mean: 5, vNr: '035' }),
        record({ id: '73', season: '2025/2026', name: 'Strict Window', league: 'B-Klasse', mean: 0, appearances: 0, vNr: '035', totalsOnly: true }),
    ],
    74: [record({ id: '74', season: '2024/2025', name: 'Window Peer', league: 'B-Klasse', mean: 5, vNr: '036' })],
};
const strictWindowIndex = Model.buildArchiveIndex(strictWindowArchive);
const strictWindowPrior = Model.buildHistoricalPrior({
    playerId: '73', targetClass: 'B-Klasse', archiveIndex: strictWindowIndex,
    calibration: Model.buildClassCalibration(strictWindowIndex), beforeSeason: '2026/2027',
});
assert.deepEqual(strictWindowPrior.sourceSeasons, ['2024/25'],
    'the third completed season never replaces an unusable newest season');
assert.equal(strictWindowPrior.seasons[0].weight, 1);

const invalidCutoffPrior = Model.buildHistoricalPrior({
    playerId: '73', targetClass: 'B-Klasse', archiveIndex: strictWindowIndex,
    calibration: Model.buildClassCalibration(strictWindowIndex), beforeSeason: 'not-a-season',
    classMean: 5,
});
assert.deepEqual(invalidCutoffPrior.sourceSeasons, []);
assert.equal(invalidCutoffPrior.provenance, 'neutral-target-class-mean');
assert.equal(invalidCutoffPrior.diagnostics.invalidBeforeSeason, true);

const globalMeanArchive = {
    75: [record({ id: '75', season: '2024/2025', name: 'Global Mean', league: 'A-Klasse', mean: 6, vNr: '035' })],
};
const globalMeanIndex = Model.buildArchiveIndex(globalMeanArchive);
const globalNeutralPrior = Model.buildHistoricalPrior({
    playerId: '999', targetClass: 'B-Klasse', archiveIndex: globalMeanIndex,
    calibration: Model.buildClassCalibration(globalMeanIndex), beforeSeason: '2025/2026',
});
assert.equal(globalNeutralPrior.rating, Model.NEUTRAL_FALLBACK_RATING);
assert.equal(globalNeutralPrior.classMeanSource, 'fallback');
assert.equal(globalNeutralPrior.classMeanAvailable, false,
    'another class cannot invent a target-class neutral mean');
assert.equal(globalNeutralPrior.confidence, 'very-low');

const missingMeanPrior = Model.buildHistoricalPrior({
    playerId: '999', targetClass: 'B-Klasse', archiveIndex: Model.buildArchiveIndex({}),
    calibration: Model.buildClassCalibration({}), beforeSeason: '2025/2026',
});
assert.equal(missingMeanPrior.rating, Model.NEUTRAL_FALLBACK_RATING);
assert.equal(missingMeanPrior.classMeanSource, 'fallback');
assert.equal(missingMeanPrior.classMeanAvailable, false);
assert.equal(missingMeanPrior.confidence, 'very-low');

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
    { id: '7', name: 'Prior Seven', v_nr: '035', company: 'Team Exact', league: 'B-Klasse Gruppe 2 2026-2027', season: '2026/2027', rounds: { R1: 8, R2: 6 } },
    { id: '8', name: 'Eight Current', v_nr: '035', company: 'Team Exact', league: 'B-Klasse Gruppe 2 2026-2027', season: '2026/2027', rounds: rounds(7, 8) },
    { id: '9', name: 'Moved Player', v_nr: '999', company: 'Other Team', league: 'B-Klasse Gruppe 2 2026-2027', season: '2026/2027', rounds: { R1: 10 } },
    { id: '', name: 'No Stable ID', v_nr: '035', company: 'Team Exact', league: 'B-Klasse Gruppe 2 2026-2027', season: '2026/2027', rounds: { R1: 12 } },
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
    teamId: '035', targetLeague: 'B-Klasse', currentDatasetSeason: '2026/2027', classMean: 5,
    currentPlayers: [{ id: '80', name: 'New Current', v_nr: '035', league: 'B-Klasse', rounds: { R1: 9, R2: 7 } }],
    archiveData: {},
});
assert.equal(currentWithoutHistory.players[0].historicalPrior.rating, 5);
assert.equal(currentWithoutHistory.players[0].rating, (16 + 4 * 5) / 6);
assert.equal(currentWithoutHistory.players[0].evidence, 'current');

const ambiguousRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse', currentDatasetSeason: '2026/2027', archiveData: rosterArchive,
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
    teamId: '035', targetLeague: 'B-Klasse', currentDatasetSeason: '2026/2027', currentPlayers: guardedCurrent, archiveData: {},
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
for (const requestedSize of [1, 3, 5, 32]) {
    assert.equal(Model.completeLineup([], { classMean: 5, size: requestedSize }).length, 4,
        `size ${requestedSize} cannot change the four-player model`);
}
for (const unsafeMean of [0, -1, Number.MAX_VALUE, Infinity, NaN, undefined]) {
    const safeLineup = Model.completeLineup([], { classMean: unsafeMean });
    assert.equal(safeLineup.length, 4);
    assert.equal(safeLineup.every((slot) => (
        Number.isFinite(slot.adjustedRating)
        && slot.adjustedRating > 0
        && slot.adjustedRating <= Model.MAX_MODEL_RATING
    )), true);
    assert.equal(safeLineup.classMeanAvailable, false);
}
const unsafeKnownLineup = Model.completeLineup([
    { id: 'unsafe-zero', name: 'Unsafe Zero', rating: 0, adjustedRating: 0, evidence: 'current', confidence: 'high' },
    { id: 'unsafe-huge', name: 'Unsafe Huge', rating: Number.MAX_SAFE_INTEGER, adjustedRating: Number.MAX_SAFE_INTEGER, evidence: 'current', confidence: 'high' },
], { classMean: 5 });
assert.equal(unsafeKnownLineup.length, 4);
assert.equal(unsafeKnownLineup.every((slot) => (
    slot.adjustedRating > 0 && slot.adjustedRating <= Model.MAX_MODEL_RATING
)), true, 'known unsafe ratings are replaced by bounded positive neutral slots');

const overflowBlendRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse', currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
    currentPlayers: [{
        id: '319', name: 'Overflow Blend', v_nr: '035', league: 'B-Klasse',
        rounds: { R1: Number.MAX_SAFE_INTEGER },
    }],
});
assert.equal(overflowBlendRoster.players[0].adjustedRating, 5,
    'unsafe current blending fails closed to the positive class mean');
assert.equal(overflowBlendRoster.players[0].confidence, 'very-low');

const rankingContext = vm.createContext({ window: {} });
vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'ranking_data.js'), 'utf8'),
    rankingContext,
    { filename: 'ranking_data.js' },
);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'archive_data.js'), 'utf8'),
    rankingContext,
    { filename: 'archive_data.js' },
);
vm.runInContext(
    `window.DATA_STATUS = ${fs.readFileSync(path.join(__dirname, '..', 'data_status.json'), 'utf8')};`,
    rankingContext,
    { filename: 'data_status.json' },
);
const committedCurrentPlayers = rankingContext.window.RANKING_DATA.players;
const committedArchiveData = rankingContext.window.ARCHIVE_DATA;
const committedRankingSeason = rankingContext.window.DATA_STATUS.domains.rankings.season;
assert.equal(committedCurrentPlayers.length, 773);
assert.equal(committedCurrentPlayers.every((player) => (
    !Object.prototype.hasOwnProperty.call(player, 'season')
    && !Object.prototype.hasOwnProperty.call(player, 'company')
    && !/\d{2,4}\s*[\/-]\s*\d{2,4}/u.test(player.league)
)), true, 'the committed ranking dataset exposes class-only explicitly-current rows');
const missingDatasetSeasonRoster = Model.buildTeamRoster({
    teamId: '040', targetLeague: 'Bezirksliga 2025/2026',
    currentPlayers: committedCurrentPlayers, archiveData: committedArchiveData,
});
assert.equal(missingDatasetSeasonRoster.players.some((player) => player.id === '425'), false,
    'seasonless rows never inherit targetSeason without explicit currentDatasetSeason');
const staleCurrentRoster = Model.buildTeamRoster({
    teamId: '040', targetLeague: 'Bezirksliga 2026/2027',
    currentDatasetSeason: committedRankingSeason,
    currentPlayers: committedCurrentPlayers, archiveData: committedArchiveData,
});
assert.equal(staleCurrentRoster.players.some((player) => (
    player.id === '425' || player.evidence === 'current' || player.evidence === 'current+history'
)), false, 'retained 2025/26 rankings are not current for the 2026/27 target');
const realCurrentRoster = Model.buildTeamRoster({
    teamId: '040', targetLeague: 'Bezirksliga 2025/2026',
    currentDatasetSeason: committedRankingSeason,
    currentPlayers: committedCurrentPlayers, archiveData: committedArchiveData,
});
const realCurrent425 = realCurrentRoster.players.find((player) => player.id === '425');
assert.ok(realCurrent425, 'real current player 425 binds to the explicit current dataset season');
assert.equal(realCurrent425.currentPoints, 172);
assert.equal(realCurrent425.currentAppearances, 18);
assert.equal(realCurrent425.adjustedRating, 8);
assert.equal(realCurrent425.currentWeight, 18 / 22);

for (const [id, league] of [
    ['386', 'B-Klasse Gruppe 2'],
    ['387', 'B-Klasse Gruppe 12'],
    ['388', 'B-Klasse Gruppe A2'],
]) {
    const groupedLeagueRoster = Model.buildTeamRoster({
        teamId: '035', targetLeague: `${league} 2026/2027`,
        currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
        currentPlayers: [{
            id, name: `Numeric Group ${id}`, v_nr: '035', league, rounds: { R1: 5 },
        }],
    });
    assert.deepEqual(groupedLeagueRoster.players.map((player) => player.id), [id],
        'numeric group tokens are class identity, not season signals');
    assert.deepEqual(groupedLeagueRoster.diagnostics.ambiguousCurrentIds, []);
}

const invalidNumericClassRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
    currentPlayers: [{
        id: '389', name: 'Invalid Numeric Class', v_nr: '035',
        league: 'B-Klasse 2', rounds: { R1: 5 },
    }],
});
assert.deepEqual(invalidNumericClassRoster.diagnostics.ambiguousCurrentIds, [],
    'a bare group-like digit is not misdiagnosed as a season signal');

const malformedSeasonSubstringRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
    currentPlayers: [{
        id: '390', name: 'Malformed Season Substring', v_nr: '035',
        league: 'B-Klasse 2025/2027', rounds: { R1: 5 },
    }],
});
assert.deepEqual(malformedSeasonSubstringRoster.diagnostics.ambiguousCurrentIds, ['390'],
    'a genuine but noncanonical season substring remains fail-closed');

const staleVetoArchive = {
    370: [record({
        id: '370', season: '2025/2026', name: 'Stale Ranking History',
        league: 'B-Klasse', mean: 6, vNr: '035',
    })],
};
const historicalWithoutCurrent = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse 2026/2027',
    currentPlayers: [], archiveData: staleVetoArchive,
});
const historicalWithStaleCurrent = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2025/2026',
    currentPlayers: [{
        id: '370', name: 'Stale Ranking History', v_nr: '999',
        league: 'B-Klasse', rounds: { R1: 9 },
    }],
    archiveData: staleVetoArchive,
});
assert.deepEqual(historicalWithoutCurrent.players.map((player) => player.id), ['370']);
assert.deepEqual(historicalWithStaleCurrent.players.map((player) => player.id), ['370'],
    'an irrelevant stale current row cannot veto the same historical player ID');
assert.equal(historicalWithStaleCurrent.players[0].evidence, 'historical');
assert.deepEqual(historicalWithStaleCurrent.diagnostics.irrelevantCurrentIds, ['370']);
assert.deepEqual(historicalWithStaleCurrent.diagnostics.ambiguousCurrentIds, []);

const consistentExplicitStaleRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2025/2026',
    currentPlayers: [{
        id: '372', name: 'Consistent Explicit Stale', v_nr: '999',
        league: 'B-Klasse', season: '2025/2026', rounds: { R1: 9 },
    }],
    archiveData: {
        372: [record({
            id: '372', season: '2025/2026', name: 'Consistent Explicit Stale',
            league: 'B-Klasse', mean: 6, vNr: '035',
        })],
    },
});
assert.deepEqual(consistentExplicitStaleRoster.players.map((player) => player.id), ['372']);
assert.deepEqual(consistentExplicitStaleRoster.diagnostics.irrelevantCurrentIds, ['372']);
assert.deepEqual(consistentExplicitStaleRoster.diagnostics.ambiguousCurrentIds, []);

for (const conflictingStaleRow of [
    {
        id: '373', name: 'Target Row Conflicts Dataset', v_nr: '999',
        league: 'B-Klasse', season: '2026/2027', rounds: { R1: 9 },
    },
    {
        id: '374', name: 'Invalid Explicit Season', v_nr: '999',
        league: 'B-Klasse', season: 'invalid', rounds: { R1: 9 },
    },
    {
        id: '375', name: 'Target League Conflicts Dataset', v_nr: '999',
        league: 'B-Klasse 2026/2027', rounds: { R1: 9 },
    },
]) {
    const identityConflictRoster = Model.buildTeamRoster({
        teamId: '035', targetLeague: 'B-Klasse 2026/2027',
        currentDatasetSeason: '2025/2026', currentPlayers: [conflictingStaleRow],
        archiveData: {
            [conflictingStaleRow.id]: [record({
                id: conflictingStaleRow.id, season: '2025/2026', name: conflictingStaleRow.name,
                league: 'B-Klasse', mean: 6, vNr: '035',
            })],
        },
    });
    assert.deepEqual(identityConflictRoster.players, [],
        'invalid or dataset-conflicting row season signals veto historical identity');
    assert.deepEqual(identityConflictRoster.diagnostics.ambiguousCurrentIds, [conflictingStaleRow.id]);
    assert.deepEqual(identityConflictRoster.diagnostics.irrelevantCurrentIds, []);
}

const targetSeasonDedupRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse 2025/2026',
    currentDatasetSeason: '2025/2026',
    currentPlayers: [{
        id: '371', name: 'Current Once', v_nr: '035', league: 'B-Klasse', rounds: { R1: 8 },
    }],
    archiveData: {
        371: [record({
            id: '371', season: '2024/2025', name: 'Current Once',
            league: 'B-Klasse', mean: 6, vNr: '035',
        })],
    },
});
assert.equal(targetSeasonDedupRoster.players.filter((player) => player.id === '371').length, 1);
assert.equal(targetSeasonDedupRoster.players[0].evidence, 'current+history');

for (const invalidSeasonPlayer of [
    { id: '330', name: 'Invalid Explicit', v_nr: '035', league: 'B-Klasse', season: 'invalid', rounds: { R1: 4 } },
    { id: '331', name: 'Wrong Explicit', v_nr: '035', league: 'B-Klasse', season: '2025/2026', rounds: { R1: 4 } },
    { id: '332', name: 'Wrong League', v_nr: '035', league: 'B-Klasse 2025/2026', rounds: { R1: 4 } },
    { id: '333', name: 'Internal Conflict', v_nr: '035', league: 'B-Klasse 2026/2027', season: '2025/2026', rounds: { R1: 4 } },
]) {
    const invalidSeasonRoster = Model.buildTeamRoster({
        teamId: '035', targetLeague: 'B-Klasse 2026/2027',
        currentPlayers: [invalidSeasonPlayer], archiveData: {}, classMean: 5,
    });
    assert.deepEqual(invalidSeasonRoster.players, []);
    assert.deepEqual(invalidSeasonRoster.diagnostics.excludedCurrentIds, [invalidSeasonPlayer.id]);
}

const explicitDatasetSeasonRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse', currentDatasetSeason: '2026/2027',
    currentPlayers: [{ id: '334', name: 'Explicit Dataset', v_nr: '035', league: 'B-Klasse', rounds: { R1: 4 } }],
    archiveData: {}, classMean: 5,
});
assert.equal(explicitDatasetSeasonRoster.players[0].id, '334');

const authoritativeLeagueTeams = [
    { clubNumber: '035', teamName: 'Alpha One', teamId: 'one', league: 'B-Klasse', season: '2026/2027' },
    { clubNumber: '035', teamName: 'Alpha Two', teamId: 'two', league: 'B-Klasse', season: '2026/2027' },
    { clubNumber: '035', teamName: 'Alpha A', league: 'A-Klasse', season: '2026/2027' },
    { clubNumber: '035', teamName: 'Alpha Old', league: 'B-Klasse', season: '2025/2026' },
];
const ambiguousMappedCurrent = [
    { id: '340', name: 'No Team Identity', v_nr: '035', league: 'B-Klasse', rounds: { R1: 4 } },
    { id: '341', name: 'Exact Alpha One', v_nr: '035', team: 'Alpha One', league: 'B-Klasse', rounds: { R1: 5 } },
    { id: '342', name: 'Wrong Alpha Two', v_nr: '035', team: 'Alpha Two', league: 'B-Klasse', rounds: { R1: 6 } },
];
const conflictingTeamAliasRoster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Alpha One', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
    leagueTeams: authoritativeLeagueTeams,
    currentPlayers: [{
        id: '343', name: 'Alias Conflict', v_nr: '035', league: 'B-Klasse',
        team: 'Alpha One', company: 'Alpha Two', rounds: { R1: 5 },
    }],
});
assert.deepEqual(conflictingTeamAliasRoster.players, []);
assert.deepEqual(conflictingTeamAliasRoster.diagnostics.ambiguousPlayerIds, ['343']);

const equivalentTeamAliasRoster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Alpha One', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
    leagueTeams: authoritativeLeagueTeams,
    currentPlayers: [{
        id: '344', name: 'Alias Equivalent', v_nr: '035', league: 'B-Klasse',
        team: 'Alpha One', teamName: ' alpha  one ', company: 'Alpha One',
        team_id: 'one', teamId: 'one', rounds: { R1: 5 },
    }],
});
assert.deepEqual(equivalentTeamAliasRoster.players.map((player) => player.id), ['344']);

const conflictingCrossTypeAliasRoster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Alpha One', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
    leagueTeams: [
        { clubNumber: '035', teamName: 'Alpha One', teamId: 'one', league: 'B-Klasse', season: '2026/2027' },
        { clubNumber: '035', teamName: 'Alpha Two', teamId: 'two', league: 'B-Klasse', season: '2026/2027' },
    ],
    currentPlayers: [{
        id: '346', name: 'Cross Alias Conflict', v_nr: '035', league: 'B-Klasse',
        team: 'Alpha One', team_id: 'two', rounds: { R1: 5 },
    }],
});
assert.deepEqual(conflictingCrossTypeAliasRoster.players, [],
    'a selected team label cannot conceal an authoritative different team ID');

const unresolvedLabelOnlyIdRoster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Alpha One', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
    leagueTeams: [
        { clubNumber: '035', teamName: 'Alpha One', league: 'B-Klasse', season: '2026/2027' },
        { clubNumber: '035', teamName: 'Alpha Two', league: 'B-Klasse', season: '2026/2027' },
    ],
    currentPlayers: [{
        id: '347', name: 'Unresolved Team ID', v_nr: '035', league: 'B-Klasse',
        team: 'Alpha One', team_id: 'one', rounds: { R1: 5 },
    }],
});
assert.deepEqual(unresolvedLabelOnlyIdRoster.players, [],
    'a label-only mapping cannot resolve a present team ID even when the label matches');

const uniqueResolutionRoster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Alpha One', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
    leagueTeams: [
        { clubNumber: '035', teamName: 'Alpha One', league: 'B-Klasse', season: '2026/2027' },
    ],
    currentPlayers: [
        { id: '348', name: 'Unique No Alias', v_nr: '035', league: 'B-Klasse', rounds: { R1: 5 } },
        { id: '349', name: 'Unique Exact Label', v_nr: '035', league: 'B-Klasse', team: 'Alpha One', rounds: { R1: 5 } },
        { id: '354', name: 'Unique Wrong Label', v_nr: '035', league: 'B-Klasse', team: 'Bravo', rounds: { R1: 5 } },
        { id: '355', name: 'Unique Unknown ID', v_nr: '035', league: 'B-Klasse', team_id: 'one', rounds: { R1: 5 } },
    ],
});
assert.deepEqual(uniqueResolutionRoster.players.map((player) => player.id), ['348', '349'],
    'unique v_nr fallback applies only when identity is absent; explicit identity must resolve');

const unnamedUniqueResolutionRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
    leagueTeams: [
        { clubNumber: '035', teamName: 'Alpha One', league: 'B-Klasse', season: '2026/2027' },
    ],
    currentPlayers: [
        { id: '359', name: 'Unnamed Unique No Alias', v_nr: '035', league: 'B-Klasse', rounds: { R1: 5 } },
        { id: '360', name: 'Unnamed Unique Wrong Alias', v_nr: '035', league: 'B-Klasse', team: 'Bravo', rounds: { R1: 5 } },
    ],
});
assert.deepEqual(unnamedUniqueResolutionRoster.players.map((player) => player.id), ['359'],
    'a unique authoritative mapping also validates explicit identity without teamName input');

const sharedLabelMapping = [
    { clubNumber: '035', teamName: 'Shared Alpha', teamId: 'one', league: 'B-Klasse', season: '2026/2027' },
    { clubNumber: '035', teamName: 'Shared Alpha', teamId: 'two', league: 'B-Klasse', season: '2026/2027' },
];
const sharedLabelSelectedRoster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Shared Alpha', team_id: 'one',
    targetLeague: 'B-Klasse 2026/2027', currentDatasetSeason: '2026/2027',
    classMean: 5, archiveData: {}, leagueTeams: sharedLabelMapping,
    currentPlayers: [
        { id: '376', name: 'Exact Published ID', v_nr: '035', league: 'B-Klasse', team_id: 'one', rounds: { R1: 5 } },
        { id: '377', name: 'Other Published ID', v_nr: '035', league: 'B-Klasse', team_id: 'two', rounds: { R1: 5 } },
        { id: '378', name: 'No Identity Shared Label', v_nr: '035', league: 'B-Klasse', rounds: { R1: 5 } },
        { id: '379', name: 'Exact Label And ID', v_nr: '035', league: 'B-Klasse', team: 'Shared Alpha', team_id: 'one', rounds: { R1: 5 } },
        { id: '380', name: 'Label Cannot Link ID', v_nr: '035', league: 'B-Klasse', team: 'Shared Alpha', rounds: { R1: 5 } },
    ],
});
assert.deepEqual(sharedLabelSelectedRoster.players.map((player) => player.id), ['376', '379'],
    'same label with different IDs is ambiguous; selected and player IDs must resolve one entry');

const sharedLabelWithoutSelectedId = Model.buildTeamRoster({
    teamId: '035', teamName: 'Shared Alpha',
    targetLeague: 'B-Klasse 2026/2027', currentDatasetSeason: '2026/2027',
    classMean: 5, archiveData: {}, leagueTeams: sharedLabelMapping,
    currentPlayers: [{
        id: '381', name: 'Label Selection Is Not Unique', v_nr: '035',
        league: 'B-Klasse', team_id: 'one', rounds: { R1: 5 },
    }],
});
assert.deepEqual(sharedLabelWithoutSelectedId.players, [],
    'selected label alone cannot choose between two canonical mapping identities');

const idOnlyMapping = [
    { clubNumber: '035', teamId: 'one', league: 'B-Klasse', season: '2026/2027' },
    { clubNumber: '035', teamId: 'two', league: 'B-Klasse', season: '2026/2027' },
];
const idOnlySelectedRoster = Model.buildTeamRoster({
    teamId: '035', team_id: 'one', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
    leagueTeams: idOnlyMapping,
    currentPlayers: [
        { id: '382', name: 'Exact ID Only', v_nr: '035', league: 'B-Klasse', team_id: 'one', rounds: { R1: 5 } },
        { id: '383', name: 'Other ID Only', v_nr: '035', league: 'B-Klasse', team_id: 'two', rounds: { R1: 5 } },
        { id: '384', name: 'No ID For ID Mapping', v_nr: '035', league: 'B-Klasse', rounds: { R1: 5 } },
    ],
});
assert.deepEqual(idOnlySelectedRoster.players.map((player) => player.id), ['382'],
    'ID-only entries are authoritative and ambiguous until selected and player IDs agree');

const duplicateCanonicalMappingRoster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Alpha One', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
    clubs: [
        { number: '035', name: 'Alpha Club', teams: ['Alpha One'] },
        { number: '035', name: ' alpha  club ', teams: [' alpha  one '] },
    ],
    currentPlayers: [{
        id: '385', name: 'Canonical Duplicate', v_nr: '035', league: 'B-Klasse', rounds: { R1: 5 },
    }],
});
assert.deepEqual(duplicateCanonicalMappingRoster.players.map((player) => player.id), ['385'],
    'semantically duplicate records form one canonical mapping identity');

for (const conflictingClubs of [
    [
        { number: '035', name: 'Alpha Club' },
        { number: '035', name: 'Different Club' },
    ],
    [
        { number: '035', clubId: '036', name: 'Contradictory Club' },
    ],
]) {
    const conflictingClubRoster = Model.buildTeamRoster({
        teamId: '035', targetLeague: 'B-Klasse 2026/2027',
        currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
        clubs: conflictingClubs,
        currentPlayers: [{
            id: '391', name: 'Club Identity Conflict', v_nr: '035',
            league: 'B-Klasse', rounds: { R1: 5 },
        }],
    });
    assert.deepEqual(conflictingClubRoster.players, [],
        'different or contradictory identities under the target club number fail closed');
    assert.equal(conflictingClubRoster.diagnostics.invalidMapping, true);
}

const uniqueClubFallbackRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
    clubs: [{ number: '035', name: 'Unique Club' }],
    currentPlayers: [{
        id: '392', name: 'Unique Club Fallback', v_nr: '035',
        league: 'B-Klasse', rounds: { R1: 5 },
    }],
});
assert.deepEqual(uniqueClubFallbackRoster.players.map((player) => player.id), ['392']);

let unsafeClubNumberReads = 0;
const unsafeTargetClub = { name: 'Unsafe Club' };
Object.defineProperty(unsafeTargetClub, 'number', {
    enumerable: true,
    get() { unsafeClubNumberReads += 1; throw new Error('club number getter must not run'); },
});
const unsafeClubFallbackRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
    clubs: [unsafeTargetClub],
    currentPlayers: [{
        id: '398', name: 'Unsafe Club Fallback', v_nr: '035',
        league: 'B-Klasse', rounds: { R1: 5 },
    }],
});
assert.deepEqual(unsafeClubFallbackRoster.players, []);
assert.equal(unsafeClubFallbackRoster.diagnostics.invalidMapping, true);
assert.equal(unsafeClubNumberReads, 0);

const objectTeamClubs = [{
    number: '035', name: 'Alpha Club', teams: [
        { id: 'one', name: 'Alpha One' },
        { id: 'two', name: 'Alpha Two' },
        { id: ' one ', name: ' alpha  one ' },
    ],
}];
const objectTeamRoster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Alpha One', selectedTeamId: 'one',
    targetLeague: 'B-Klasse 2026/2027', currentDatasetSeason: '2026/2027',
    classMean: 5, archiveData: {}, clubs: objectTeamClubs,
    currentPlayers: [
        { id: '393', name: 'Exact Object Team', v_nr: '035', league: 'B-Klasse', team: 'Alpha One', team_id: 'one', rounds: { R1: 5 } },
        { id: '394', name: 'Missing Object Team ID', v_nr: '035', league: 'B-Klasse', team: 'Alpha One', rounds: { R1: 5 } },
        { id: '395', name: 'Wrong Object Team ID', v_nr: '035', league: 'B-Klasse', team: 'Alpha One', team_id: 'two', rounds: { R1: 5 } },
        { id: '396', name: 'No Object Team Identity', v_nr: '035', league: 'B-Klasse', rounds: { R1: 5 } },
    ],
});
assert.deepEqual(objectTeamRoster.players.map((player) => player.id), ['393'],
    'object teams preserve label and published ID; multi-team players must match both');
const objectTeamRosterWithoutSelectedId = Model.buildTeamRoster({
    teamId: '035', teamName: 'Alpha One',
    targetLeague: 'B-Klasse 2026/2027', currentDatasetSeason: '2026/2027',
    classMean: 5, archiveData: {}, clubs: objectTeamClubs,
    currentPlayers: [{
        id: '397', name: 'Selection Missing Object ID', v_nr: '035', league: 'B-Klasse',
        team: 'Alpha One', team_id: 'one', rounds: { R1: 5 },
    }],
});
assert.deepEqual(objectTeamRosterWithoutSelectedId.players, [],
    'a selected label alone cannot resolve one of several ID-publishing object teams');

let currentTeamAliasGetterCalls = 0;
const accessorTeamAliasPlayer = {
    id: '345', name: 'Alias Accessor', v_nr: '035', league: 'B-Klasse',
    team: 'Alpha One', rounds: { R1: 5 },
};
Object.defineProperty(accessorTeamAliasPlayer, 'company', {
    enumerable: true,
    get() { currentTeamAliasGetterCalls += 1; throw new Error('team alias getter must not run'); },
});
const accessorTeamAliasRoster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Alpha One', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
    leagueTeams: authoritativeLeagueTeams, currentPlayers: [accessorTeamAliasPlayer],
});
assert.deepEqual(accessorTeamAliasRoster.players, []);
assert.deepEqual(accessorTeamAliasRoster.diagnostics.ambiguousPlayerIds, ['345']);
assert.equal(currentTeamAliasGetterCalls, 0);

const keyedMappingRoster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Alpha One', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
    currentPlayers: [ambiguousMappedCurrent[0]],
    teamMappings: { '035': [
        { clubNumber: '035', teamName: 'Alpha One', league: 'B-Klasse 2026/2027', season: '2026/2027' },
        { clubNumber: '035', teamName: 'Other Class', league: 'A-Klasse', season: '2026/2027' },
        { clubNumber: '035', teamName: 'Older Team', league: 'B-Klasse', season: '2025/2026' },
    ] },
});
assert.deepEqual(keyedMappingRoster.players.map((player) => player.id), ['340'],
    'keyed mapping objects inherit the key and use the same class/season validation as flat records');
const ambiguousMappedRoster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Alpha One', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027',
    currentPlayers: ambiguousMappedCurrent, archiveData: {}, classMean: 5,
    leagueTeams: authoritativeLeagueTeams,
});
assert.deepEqual(ambiguousMappedRoster.players.map((player) => player.id), ['341'],
    'an ambiguous target-league club requires exact own team identity');

const uniqueMappedRoster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Alpha One', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027',
    currentPlayers: [ambiguousMappedCurrent[0]], archiveData: {}, classMean: 5,
    leagueTeams: authoritativeLeagueTeams.filter((mapping) => mapping.teamName !== 'Alpha Two'),
    clubs: [{ number: '035', name: 'Alpha Club', teams: ['Alpha One', 'Alpha A'] }],
});
assert.deepEqual(uniqueMappedRoster.players.map((player) => player.id), ['340'],
    'a team in another class or season does not make the target league-season ambiguous');

let mappingGetterCalls = 0;
const unsafeLeagueTeam = {
    clubNumber: '035', league: 'B-Klasse', season: '2026/2027',
};
Object.defineProperty(unsafeLeagueTeam, 'teamName', {
    enumerable: true,
    get() { mappingGetterCalls += 1; throw new Error('mapping getter must not run'); },
});
const unsafeMappedRoster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Alpha One', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027',
    currentPlayers: [ambiguousMappedCurrent[0]], archiveData: {}, classMean: 5,
    leagueTeams: [authoritativeLeagueTeams[0], unsafeLeagueTeam],
});
assert.deepEqual(unsafeMappedRoster.players, [],
    'unsafe authoritative mappings cannot conceal a second target team');
assert.equal(mappingGetterCalls, 0);

for (const malformedTargetMapping of [
    {
        teamMappings: { '035': {
            clubNumber: '035', teamName: 'Alpha One',
            league: 'B-Klasse', season: '2026/2027',
        } },
    },
    {
        teamMappings: { '035': [{
            clubNumber: '035', v_nr: '036', teamName: 'Alpha One',
            league: 'B-Klasse', season: '2026/2027',
        }] },
    },
    {
        teamMappings: [{
            clubNumber: '035', teamName: 'Alpha One',
            league: 'B-Klasse', season: 'invalid',
        }],
    },
    {
        leagueTeams: [{
            clubNumber: '035', teamName: 'Alpha One',
            league: 'B-Klasse 2025/2026', season: '2026/2027',
        }],
    },
]) {
    const malformedMappingRoster = Model.buildTeamRoster({
        teamId: '035', teamName: 'Alpha One', targetLeague: 'B-Klasse 2026/2027',
        currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
        currentPlayers: [{
            id: '356', name: 'Mapping Must Resolve', v_nr: '035',
            league: 'B-Klasse', rounds: { R1: 5 },
        }],
        ...malformedTargetMapping,
    });
    assert.deepEqual(malformedMappingRoster.players, [],
        'malformed target-club mappings cannot silently restore v_nr-only fallback');
    assert.equal(malformedMappingRoster.diagnostics.invalidMapping, true);
}
const unsafeDirectMappedRoster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Alpha One', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027',
    currentPlayers: [ambiguousMappedCurrent[0]], archiveData: {}, classMean: 5,
    teamMappings: { '035': ['Alpha One', unsafeLeagueTeam] },
});
assert.deepEqual(unsafeDirectMappedRoster.players, []);
assert.equal(mappingGetterCalls, 0);

const mappedHistoricalArchive = {
    350: [record({ id: '350', season: '2025/2026', name: 'Historical No Team', league: 'B-Klasse', mean: 5, vNr: '035' })],
    351: [{
        ...record({ id: '351', season: '2025/2026', name: 'Historical Exact', league: 'B-Klasse', mean: 6, vNr: '035' }),
        team: 'Alpha One',
    }],
    352: [{
        ...record({ id: '352', season: '2025/2026', name: 'Historical Wrong', league: 'B-Klasse', mean: 7, vNr: '035' }),
        team: 'Alpha Two',
    }],
    353: [{
        ...record({ id: '353', season: '2025/2026', name: 'Historical Alias Conflict', league: 'B-Klasse', mean: 8, vNr: '035' }),
        team: 'Alpha One', company: 'Alpha Two',
    }],
};
const mappedHistoricalRoster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Alpha One', targetLeague: 'B-Klasse 2026/2027',
    currentPlayers: [], archiveData: mappedHistoricalArchive,
    leagueTeams: authoritativeLeagueTeams,
});
assert.deepEqual(mappedHistoricalRoster.players.map((player) => player.id), ['351'],
    'the same authoritative ambiguity rule applies to historical roster membership');

for (const currentAffiliationRow of [
    {
        id: '357', name: 'Known Other Team', v_nr: '035', league: 'B-Klasse',
        team: 'Alpha Two', team_id: 'two', rounds: { R1: 5 },
    },
    {
        id: '358', name: 'Ambiguous Current Team', v_nr: '035', league: 'B-Klasse',
        rounds: { R1: 5 },
    },
]) {
    const affiliationVetoRoster = Model.buildTeamRoster({
        teamId: '035', teamName: 'Alpha One', targetLeague: 'B-Klasse 2026/2027',
        currentDatasetSeason: '2026/2027', leagueTeams: authoritativeLeagueTeams,
        currentPlayers: [currentAffiliationRow],
        archiveData: {
            [currentAffiliationRow.id]: [{
                ...record({
                    id: currentAffiliationRow.id, season: '2025/2026',
                    name: currentAffiliationRow.name, league: 'B-Klasse', mean: 7, vNr: '035',
                }),
                team: 'Alpha One', team_id: 'one',
            }],
        },
    });
    assert.deepEqual(affiliationVetoRoster.players, [],
        'known other-team and unresolved target-current affiliations both veto old roster membership');
}

const explicitAmbiguousClubRoster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Alpha One', targetLeague: 'B-Klasse 2026/2027',
    currentDatasetSeason: '2026/2027',
    currentPlayers: ambiguousMappedCurrent.slice(0, 2), archiveData: {}, classMean: 5,
    ambiguousClubNumbers: ['035'],
});
assert.deepEqual(explicitAmbiguousClubRoster.players, [],
    'an ambiguity flag without canonical mapping entries cannot be resolved by label coincidence');

const totalsMembershipArchive = {
    360: [
        record({ id: '360', season: '2025/2026', name: 'Totals Member', league: 'B-Klasse', mean: 0, appearances: 0, vNr: '035', totalsOnly: true }),
        record({ id: '360', season: '2024/2025', name: 'Totals Member', league: 'B-Klasse', mean: 6, vNr: '035' }),
        record({ id: '360', season: '2023/2024', name: 'Totals Member', league: 'B-Klasse', mean: 9, vNr: '035' }),
    ],
    361: [
        record({ id: '361', season: '2025/2026', name: 'Moved Member', league: 'B-Klasse', mean: 0, appearances: 0, vNr: '999', totalsOnly: true }),
        record({ id: '361', season: '2024/2025', name: 'Moved Member', league: 'B-Klasse', mean: 7, vNr: '035' }),
    ],
    362: [record({ id: '362', season: '2023/2024', name: 'Third Season', league: 'B-Klasse', mean: 8, vNr: '035' })],
};
const totalsMembershipRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse 2026/2027', currentPlayers: [],
    archiveData: totalsMembershipArchive,
});
const totalsMember = totalsMembershipRoster.players.find((player) => player.id === '360');
assert.ok(totalsMember, 'totals-only latest membership can select a historical roster candidate');
assert.deepEqual(totalsMember.sourceSeasons, ['2024/25']);
assert.equal(totalsMember.historicalPrior.seasons[0].weight, 1);
assert.equal(totalsMember.confidence, 'provisional');
assert.equal(totalsMembershipRoster.players.some((player) => player.id === '361'), false,
    'latest totals-only transfer excludes the old historical club');
assert.equal(totalsMembershipRoster.players.some((player) => player.id === '362'), false,
    'a third roster season is never pulled into the candidate list');

const confidenceRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse', currentDatasetSeason: '2026/2027', classMean: 5, archiveData: {},
    currentPlayers: [{
        id: '310', name: 'Only Current', v_nr: '035', league: 'B-Klasse', rounds: rounds(7, 8),
    }],
});
assert.equal(confidenceRoster.players[0].confidence, 'high');
assert.equal(confidenceRoster.teamConfidence, 'very-low',
    'three implicit neutral slots cap the roster team confidence');

const cappedHistoricalRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse', currentPlayers: [], archiveData: priorArchive,
});
assert.equal(cappedHistoricalRoster.players.find((player) => player.id === '7').confidence, 'provisional',
    'unconfirmed historical candidates never exceed provisional confidence');

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
const duplicateOutcomeClubs = deepFreeze([
    { number: '035', name: 'Alpha' },
    { number: '035', name: ' alpha ' },
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
assert.equal(Model.buildOutcomeTrainingExamples({
    archiveTables, archiveData: outcomeArchive, clubs: duplicateOutcomeClubs,
}).length, 1, 'semantically duplicate outcome mappings form one canonical identity');

const conflictingOutcomeClubIdentity = Model.buildOutcomeTrainingExamples({
    archiveTables, archiveData: outcomeArchive, clubs: [
        { number: '035', name: 'Alpha', teams: ['Alpha'] },
        { number: '035', name: 'Different Alpha', teams: [{ id: 'two', name: 'Alpha Two' }] },
        { number: '036', name: 'Bravo' },
    ],
});
assert.equal(conflictingOutcomeClubIdentity.length, 0,
    'different canonical club names under one number suppress all string/object team mappings');
assert.deepEqual(conflictingOutcomeClubIdentity.diagnostics.clubMapping, {
    globalInvalid: false,
    invalidClubIds: ['035'],
    reason: 'invalidClubIdentity',
});

let outcomeClubNameGetterCalls = 0;
const accessorOutcomeClub = { number: '035' };
Object.defineProperty(accessorOutcomeClub, 'name', {
    enumerable: true,
    get() { outcomeClubNameGetterCalls += 1; throw new Error('outcome club name getter must not run'); },
});
const accessorOutcomeClubIdentity = Model.buildOutcomeTrainingExamples({
    archiveTables, archiveData: outcomeArchive, clubs: [
        { number: '035', name: 'Alpha' }, accessorOutcomeClub,
        { number: '036', name: 'Bravo' },
    ],
});
assert.equal(accessorOutcomeClubIdentity.length, 0,
    'a malformed duplicate invalidates the readable club number despite a valid record');
assert.deepEqual(accessorOutcomeClubIdentity.diagnostics.clubMapping.invalidClubIds, ['035']);
assert.equal(accessorOutcomeClubIdentity.diagnostics.clubMapping.reason, 'invalidClubIdentity');
assert.equal(outcomeClubNameGetterCalls, 0);

const unrelatedInvalidOutcomeClub = Model.buildOutcomeTrainingExamples({
    archiveTables, archiveData: outcomeArchive,
    clubs: [...outcomeClubs, { number: '099', name: '   ' }],
});
assert.equal(unrelatedInvalidOutcomeClub.length, 1,
    'a readable invalid club identity suppresses only that club number');
assert.deepEqual(unrelatedInvalidOutcomeClub.diagnostics.clubMapping.invalidClubIds, ['099']);

const globallyUnreadableOutcomeClub = Model.buildOutcomeTrainingExamples({
    archiveTables, archiveData: outcomeArchive, clubs: [...outcomeClubs, 42],
});
assert.equal(globallyUnreadableOutcomeClub.length, 0,
    'a nonobject club identity makes the complete outcome mapping fail closed');
assert.deepEqual(globallyUnreadableOutcomeClub.diagnostics.clubMapping, {
    globalInvalid: true,
    invalidClubIds: [],
    reason: 'unreadableClubIdentity',
});

const trappedOutcomeClub = new Proxy({}, {
    getOwnPropertyDescriptor() { throw new Error('unreadable outcome club proxy'); },
});
const proxyUnreadableOutcomeClub = Model.buildOutcomeTrainingExamples({
    archiveTables, archiveData: outcomeArchive, clubs: [...outcomeClubs, trappedOutcomeClub],
});
assert.equal(proxyUnreadableOutcomeClub.length, 0);
assert.equal(proxyUnreadableOutcomeClub.diagnostics.clubMapping.globalInvalid, true);
assert.equal(proxyUnreadableOutcomeClub.diagnostics.clubMapping.reason, 'unreadableClubIdentity');

const ambiguousTraining = Model.buildOutcomeTrainingExamples({
    archiveTables: [{ season: '2025/2026', league: 'A-Klasse', rows: [
        { round: 1, home: 'Alpha', away: 'Bravo', result: '9:7' },
    ] }],
    archiveData: outcomeArchive,
    clubs: [...outcomeClubs, { number: '099', name: 'Alpha' }],
});
assert.equal(ambiguousTraining.length, 0);
assert.equal(ambiguousTraining.diagnostics.excluded.teamMapping, 1);

const multiTeamClubs = [
    { number: '035', name: 'Club Alpha', teams: ['Alpha'] },
    { number: '035', name: ' club  alpha ', teams: ['Alpha Two'] },
    { number: '036', name: 'Bravo' },
];
const multiTeamRows = [{ season: '2025/2026', league: 'A-Klasse', rows: [
    { round: 1, home: 'Alpha', away: 'Bravo', result: '9:7' },
] }];
const ambiguousParticipantTraining = Model.buildOutcomeTrainingExamples({
    archiveTables: multiTeamRows, archiveData: outcomeArchive, clubs: multiTeamClubs,
});
assert.equal(ambiguousParticipantTraining.length, 0);
assert.equal(ambiguousParticipantTraining.diagnostics.excluded.participants, 1,
    'v_nr alone cannot assign a player inside a multi-team club');

const exactTeamOutcomeArchive = makeOutcomeArchive();
for (let index = 0; index < 4; index += 1) {
    exactTeamOutcomeArchive[String(200 + index)][1].team = 'Alpha';
}
const exactParticipantTraining = Model.buildOutcomeTrainingExamples({
    archiveTables: multiTeamRows, archiveData: exactTeamOutcomeArchive, clubs: multiTeamClubs,
});
assert.equal(exactParticipantTraining.length, 1,
    'every multi-team participant may be assigned only by exact own team identity');

const conflictingParticipantArchive = makeOutcomeArchive();
for (let index = 0; index < 4; index += 1) {
    conflictingParticipantArchive[String(200 + index)][1].team = 'Alpha';
}
conflictingParticipantArchive['200'][1].company = 'Alpha Two';
const conflictingParticipantTraining = Model.buildOutcomeTrainingExamples({
    archiveTables: multiTeamRows, archiveData: conflictingParticipantArchive, clubs: multiTeamClubs,
});
assert.equal(conflictingParticipantTraining.length, 0,
    'conflicting participant team aliases cannot be hidden by alias priority');

const equivalentParticipantArchive = makeOutcomeArchive();
for (let index = 0; index < 4; index += 1) {
    equivalentParticipantArchive[String(200 + index)][1].team = 'Alpha';
    equivalentParticipantArchive[String(200 + index)][1].company = ' alpha ';
}
assert.equal(Model.buildOutcomeTrainingExamples({
    archiveTables: multiTeamRows, archiveData: equivalentParticipantArchive, clubs: multiTeamClubs,
}).length, 1, 'equivalent participant aliases coalesce deterministically');

const crossTypeParticipantArchive = makeOutcomeArchive();
for (let index = 0; index < 4; index += 1) {
    crossTypeParticipantArchive[String(200 + index)][1].team = 'Alpha';
}
crossTypeParticipantArchive['200'][1].team_id = 'Alpha Two';
assert.equal(Model.buildOutcomeTrainingExamples({
    archiveTables: multiTeamRows, archiveData: crossTypeParticipantArchive, clubs: multiTeamClubs,
}).length, 0, 'a participant team label cannot conceal a different exact team ID');

const unresolvedParticipantIdArchive = makeOutcomeArchive();
for (let index = 0; index < 4; index += 1) {
    unresolvedParticipantIdArchive[String(200 + index)][1].team = 'Alpha';
    unresolvedParticipantIdArchive[String(200 + index)][1].team_id = 'Alpha';
}
assert.equal(Model.buildOutcomeTrainingExamples({
    archiveTables: multiTeamRows, archiveData: unresolvedParticipantIdArchive, clubs: multiTeamClubs,
}).length, 0, 'label-only club mappings cannot resolve explicit participant team IDs');

const publishedIdClubs = [
    { number: '035', name: 'Club Alpha', teams: [
        { id: 'one', name: 'Alpha' }, { id: 'two', name: 'Alpha Two' },
    ] },
    { number: '036', name: 'Bravo' },
];
const publishedParticipantIdArchive = makeOutcomeArchive();
for (let index = 0; index < 4; index += 1) {
    publishedParticipantIdArchive[String(200 + index)][1].team = 'Alpha';
    publishedParticipantIdArchive[String(200 + index)][1].team_id = 'one';
}
assert.equal(Model.buildOutcomeTrainingExamples({
    archiveTables: multiTeamRows, archiveData: publishedParticipantIdArchive, clubs: publishedIdClubs,
}).length, 1, 'matching participant IDs resolve only when the mapping publishes that ID');

const publishedAliasParticipantClubs = [
    { number: '035', name: 'Club Alpha', teams: [
        { teamId: 'one', teamName: 'Alpha' },
        { teamId: 'two', teamName: 'Alpha Two' },
    ] },
    { number: '036', name: 'Bravo' },
];
assert.equal(Model.buildOutcomeTrainingExamples({
    archiveTables: multiTeamRows,
    archiveData: publishedParticipantIdArchive,
    clubs: publishedAliasParticipantClubs,
}).length, 1, 'participant mappings parse object aliases identically to roster mappings');

const missingPublishedParticipantIdArchive = makeOutcomeArchive();
for (let index = 0; index < 4; index += 1) {
    missingPublishedParticipantIdArchive[String(200 + index)][1].team = 'Alpha';
}
assert.equal(Model.buildOutcomeTrainingExamples({
    archiveTables: multiTeamRows,
    archiveData: missingPublishedParticipantIdArchive,
    clubs: publishedIdClubs,
}).length, 0, 'multi-team participants cannot omit a published team ID');

const duplicatePublishedIdClubs = [
    { number: '035', name: 'Club Alpha', teams: [
        { id: 'one', name: 'Alpha' }, { id: ' one ', name: ' alpha ' },
    ] },
    { number: '036', name: 'Bravo' },
];
assert.equal(Model.buildOutcomeTrainingExamples({
    archiveTables: multiTeamRows,
    archiveData: publishedParticipantIdArchive,
    clubs: duplicatePublishedIdClubs,
}).length, 1, 'semantically duplicate object teams form one participant mapping identity');

const sharedParticipantIdClubs = [
    { number: '035', name: 'Club Alpha', teams: [
        { id: 'shared', name: 'Alpha' }, { id: 'shared', name: 'Alpha Two' },
    ] },
    { number: '036', name: 'Bravo' },
];
const ambiguousSharedParticipantIdArchive = makeOutcomeArchive();
for (let index = 0; index < 4; index += 1) {
    ambiguousSharedParticipantIdArchive[String(200 + index)][1].team_id = 'shared';
}
assert.equal(Model.buildOutcomeTrainingExamples({
    archiveTables: multiTeamRows,
    archiveData: ambiguousSharedParticipantIdArchive,
    clubs: sharedParticipantIdClubs,
}).length, 0, 'a participant ID shared by two mapping identities cannot select either entry');

const exactSharedParticipantIdArchive = makeOutcomeArchive();
for (let index = 0; index < 4; index += 1) {
    exactSharedParticipantIdArchive[String(200 + index)][1].team = 'Alpha';
    exactSharedParticipantIdArchive[String(200 + index)][1].team_id = 'shared';
}
assert.equal(Model.buildOutcomeTrainingExamples({
    archiveTables: multiTeamRows,
    archiveData: exactSharedParticipantIdArchive,
    clubs: sharedParticipantIdClubs,
}).length, 1, 'participant label and ID together resolve exactly one canonical mapping entry');

const wrongUniqueParticipantArchive = makeOutcomeArchive();
wrongUniqueParticipantArchive['200'][1].team = 'Bravo';
assert.equal(Model.buildOutcomeTrainingExamples({
    archiveTables, archiveData: wrongUniqueParticipantArchive, clubs: outcomeClubs,
}).length, 0, 'explicit wrong participant identity is rejected even for a unique club mapping');

for (const inconsistentScoreRow of [
    { round: 1, home: 'Alpha', away: 'Bravo', result: 'invalid', homeScore: 9, awayScore: 7 },
    { round: 1, home: 'Alpha', away: 'Bravo', result: '9:7', homeScore: 9, awayScore: 8 },
    { round: 1, home: 'Alpha', away: 'Bravo', result: '9:7', score: '7:9' },
    { round: 1, home: 'Alpha', away: 'Bravo', result: '9:7', homeScore: 9, home_score: 8, awayScore: 7 },
]) {
    const inconsistentScore = Model.buildOutcomeTrainingExamples({
        archiveTables: [{ season: '2025/2026', league: 'A-Klasse', rows: [inconsistentScoreRow] }],
        archiveData: outcomeArchive, clubs: outcomeClubs,
    });
    assert.equal(inconsistentScore.length, 0);
    assert.equal(inconsistentScore.diagnostics.excluded.malformed, 1);
}

let scoreAliasGetterCalls = 0;
const accessorScoreAlias = { round: 1, home: 'Alpha', away: 'Bravo', result: '9:7' };
Object.defineProperty(accessorScoreAlias, 'score', {
    enumerable: true,
    get() { scoreAliasGetterCalls += 1; throw new Error('score alias getter must not run'); },
});
const accessorScoreTraining = Model.buildOutcomeTrainingExamples({
    archiveTables: [{ season: '2025/2026', league: 'A-Klasse', rows: [accessorScoreAlias] }],
    archiveData: outcomeArchive, clubs: outcomeClubs,
});
assert.equal(accessorScoreTraining.length, 0);
assert.equal(accessorScoreTraining.diagnostics.excluded.malformed, 1);
assert.equal(scoreAliasGetterCalls, 0);

const conflictingDuplicateTraining = Model.buildOutcomeTrainingExamples({
    archiveTables: [{ season: '2025/2026', league: 'A-Klasse', rows: [
        { round: 1, home: 'Alpha', away: 'Bravo', result: '9:7' },
        { round: 1, home: 'Alpha', away: 'Bravo', result: '7:9' },
        { round: 2, home: 'Alpha', away: 'Bravo', result: '8:8' },
        { round: 2, home: 'Alpha', away: 'Bravo', homeScore: 8, awayScore: 8 },
    ] }],
    archiveData: outcomeArchive, clubs: outcomeClubs,
});
assert.equal(conflictingDuplicateTraining.length, 1,
    'a conflicting match identity removes all of its rows while an exact repeat remains once');
assert.equal(conflictingDuplicateTraining[0].round, 2);
assert.equal(conflictingDuplicateTraining.diagnostics.excluded.conflictingDuplicate, 1);
assert.equal(conflictingDuplicateTraining.diagnostics.excluded.duplicate, 1);

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
const outcomeModel = Model.calibrateOutcomeModel(outcomeExamples, { synthetic: true });
assert.equal(outcomeModel.calibrated, true);
assert.equal(Object.isFrozen(outcomeModel), true);
assert.equal(JSON.stringify(outcomeExamples), outcomeExamplesBefore);
assert.deepEqual(Model.calibrateOutcomeModel(outcomeExamples, { synthetic: true }).params, outcomeModel.params,
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
    outcomeModel: Model.calibrateOutcomeModel(outcomeExamples.slice(0, 12), { synthetic: true }), home: true,
});
assert.equal(fallback.mode, 'relative');
assert.equal('home' in fallback, false);
assert.equal('draw' in fallback, false);
assert.equal('away' in fallback, false);
assert.equal(typeof fallback.uncertaintyText, 'string');

for (const unsafeDirectRating of [0, -1, Model.MAX_MODEL_RATING + 1, Number.MAX_SAFE_INTEGER, Infinity, NaN]) {
    const unsafeDirectLineup = Array.from({ length: 4 }, (_, index) => ({
        id: `unsafe-direct-${index}`,
        name: `Unsafe Direct ${index}`,
        adjustedRating: index === 0 ? unsafeDirectRating : 8,
        rating: index === 0 ? unsafeDirectRating : 8,
        evidence: 'current', confidence: 'high',
    }));
    const unsafeDirectForecast = Model.forecastMatch(
        unsafeDirectLineup, awayLineup, { outcomeModel },
    );
    assert.equal(unsafeDirectForecast.mode, 'relative');
    assert.equal(unsafeDirectForecast.homeScore, Model.NEUTRAL_FALLBACK_RATING);
    assert.equal(unsafeDirectForecast.homeConfidence, 'very-low');
    assert.equal('home' in unsafeDirectForecast, false);
    assert.equal(Number.isFinite(unsafeDirectForecast.relative.homeShare), true);
}

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
const symmetricModel = Model.calibrateOutcomeModel(symmetricExamples, { synthetic: true });
assert.equal(symmetricModel.params.homeAdvantage, 0);
const forward = Model.forecastMatch(homeLineup, awayLineup, { outcomeModel: symmetricModel });
const reversed = Model.forecastMatch(awayLineup, homeLineup, { outcomeModel: symmetricModel });
assert.ok(Math.abs(forward.home - reversed.away) < 1e-12);
assert.ok(Math.abs(forward.away - reversed.home) < 1e-12);
assert.ok(Math.abs(forward.draw - reversed.draw) < 1e-12);

const duplicateExamples = [...makeOutcomeExamples(), makeOutcomeExamples()[0]];
assert.equal(Model.calibrateOutcomeModel(duplicateExamples, { synthetic: true }).diagnostics.excludedDuplicate, 1,
    'exact match keys cannot be hidden in training twice');

let unsafeExampleGetterCalls = 0;
const unsafeExample = { key: 'unsafe' };
Object.defineProperty(unsafeExample, 'homeRating', {
    enumerable: true,
    get() { unsafeExampleGetterCalls += 1; throw new Error('example getter must not run'); },
});
const guardedModel = Model.calibrateOutcomeModel([...makeOutcomeExamples(), unsafeExample], { synthetic: true });
assert.equal(guardedModel.calibrated, true);
assert.equal(guardedModel.diagnostics.excludedUnsafe, 1);
assert.equal(unsafeExampleGetterCalls, 0);
const extremeNumericModel = Model.calibrateOutcomeModel([
    ...makeOutcomeExamples(),
    { key: 'extreme', homeRating: Number.MAX_VALUE, awayRating: 1, outcome: 'home' },
], { synthetic: true });
assert.equal(extremeNumericModel.diagnostics.excludedUnsafe, 1,
    'ratings beyond safe model arithmetic are excluded');

const keylessSyntheticExamples = makeOutcomeExamples().map(({ key: _key, ...example }) => example);
assert.equal(Model.calibrateOutcomeModel(keylessSyntheticExamples, { synthetic: true }).calibrated, true,
    'independent synthetic examples do not need archive match keys');

const unbrandedOutcomeModel = Model.calibrateOutcomeModel(outcomeExamples);
assert.equal(unbrandedOutcomeModel.calibrated, false);
assert.equal(unbrandedOutcomeModel.diagnostics.unbrandedProductionInput, true);
assert.equal(Model.calibrateOutcomeModel(training).diagnostics.received, 1,
    'internally branded production examples are accepted without synthetic mode');
assert.equal(Model.calibrateOutcomeModel([...training]).diagnostics.unbrandedProductionInput, true,
    'cloning production examples cannot spoof the internal brand');

const cutoffExamples = makeOutcomeExamples().map((example, index) => ({
    ...example,
    season: index < 40 ? '2024/2025' : '2025/2026',
}));
const cutoffModel = Model.calibrateOutcomeModel(cutoffExamples, {
    synthetic: true,
    beforeSeason: '2025/2026',
});
assert.equal(cutoffModel.calibrated, true);
assert.equal(cutoffModel.diagnostics.usable, 40);
assert.equal(cutoffModel.diagnostics.excludedByCutoff, 10);
const invalidCutoffModel = Model.calibrateOutcomeModel(cutoffExamples, {
    synthetic: true,
    beforeSeason: 'invalid',
});
assert.equal(invalidCutoffModel.calibrated, false);
assert.equal(invalidCutoffModel.diagnostics.invalidCutoff, true);

const cutoffTraining = Model.buildOutcomeTrainingExamples({
    archiveTables, archiveData: outcomeArchive, clubs: outcomeClubs,
    beforeSeason: '2025/2026',
});
assert.equal(cutoffTraining.length, 0);
assert.equal(cutoffTraining.diagnostics.cutoff.beforeSeason, '2025/26');
const invalidCutoffTraining = Model.buildOutcomeTrainingExamples({
    archiveTables, archiveData: outcomeArchive, clubs: outcomeClubs,
    beforeSeason: 'invalid',
});
assert.equal(invalidCutoffTraining.length, 0);
assert.equal(invalidCutoffTraining.diagnostics.cutoff.invalid, true);

const cachedTraining = Model.buildOutcomeTrainingExamples({
    archiveTables: [{ season: '2025/2026', league: 'A-Klasse', rows: [
        { round: 1, home: 'Alpha', away: 'Bravo', result: '9:7' },
        { round: 2, home: 'Alpha', away: 'Bravo', result: '8:8' },
    ] }],
    archiveData: outcomeArchive, clubs: outcomeClubs,
});
assert.equal(cachedTraining.length, 2);
assert.deepEqual(cachedTraining.diagnostics.performance, {
    cutoffSnapshots: 1,
    filteredIndexBuilds: 1,
    calibrationBuilds: 1,
    priorCalls: 16,
    participantIndexBuilds: 1,
    historyRecordsScanned: 16,
    participantLookups: 4,
});
assert.equal(cachedTraining.every((example) => (
    example.cutoffProvenance.targetSeason === '2025/26'
    && example.cutoffProvenance.strictlyEarlier === true
)), true);
assert.equal(Object.isFrozen(cachedTraining), true);

function makeScaledOutcomeArchive(roundCount) {
    const archive = {};
    for (let index = 0; index < 8; index += 1) {
        const id = String(600 + index);
        const vNr = index < 4 ? '035' : '036';
        const perRound = Object.fromEntries(Array.from({ length: roundCount }, (_, roundIndex) => (
            [`R${roundIndex + 1}`, (roundIndex + index) % 3 === 0 ? 0 : (index < 4 ? 8 : 5)]
        )));
        const points = Object.values(perRound).reduce((sum, value) => sum + value, 0);
        archive[id] = [
            record({ id, season: '2024/2025', name: `Scale ${id}`, league: 'A-Klasse', mean: 6, vNr }),
            {
                id,
                season: '2025/2026',
                name: `Scale ${id}`,
                league: 'A-Klasse',
                v_nr: vNr,
                points,
                rounds: perRound,
                appearances: roundCount,
                points_per_appearance: points / roundCount,
            },
        ];
    }
    return archive;
}

const scaledOutcomeArchive = deepFreeze(makeScaledOutcomeArchive(500));
const scaledRows = deepFreeze(Array.from({ length: 500 }, (_, index) => ({
    round: index + 1,
    home: 'Alpha',
    away: 'Bravo',
    result: index % 3 === 0 ? '8:8' : '9:7',
})));
let previousScaledKeys = [];
for (const matchCount of [100, 250, 500]) {
    const scaledTraining = Model.buildOutcomeTrainingExamples({
        archiveTables: [{
            season: '2025/2026', league: 'A-Klasse', rows: scaledRows.slice(0, matchCount),
        }],
        archiveData: scaledOutcomeArchive,
        clubs: outcomeClubs,
    });
    assert.equal(scaledTraining.length, matchCount);
    assert.equal(scaledTraining.diagnostics.performance.participantIndexBuilds, 1);
    assert.equal(scaledTraining.diagnostics.performance.historyRecordsScanned, 16,
        'history scan count is independent of match count');
    assert.equal(scaledTraining.diagnostics.performance.participantLookups, 2 * matchCount,
        'each match performs exactly two direct participant lookups');
    assert.deepEqual(
        scaledTraining.slice(0, previousScaledKeys.length).map((example) => example.key),
        previousScaledKeys,
        'larger deterministic batches preserve the exact smaller-batch prefix',
    );
    previousScaledKeys = scaledTraining.map((example) => example.key);
}

const duplicateCurrentRoster = Model.buildTeamRoster({
    teamId: '035', targetLeague: 'B-Klasse', currentDatasetSeason: '2026/2027', archiveData: {},
    currentPlayers: [
        { id: '300', name: 'Duplicate Current', v_nr: '035', league: 'B-Klasse', rounds: { R1: 5 } },
        { id: '300', name: 'Duplicate Current', v_nr: '035', league: 'B-Klasse', rounds: { R1: 5 } },
    ],
});
assert.equal(duplicateCurrentRoster.players.length, 1,
    'duplicate current rows never duplicate a stable player identity');

const equivalentCurrentRows = [
    { id: '320', name: 'Equivalent', v_nr: '035', company: 'Exact Team', league: 'B-Klasse 2026/2027', season: '2026/2027', rounds: { R2: '5', R1: 4 } },
    { id: '320', name: 'Equivalent', v_nr: '035', company: 'Exact Team', league: 'B-Klasse 2026-2027', season: '26/27', rounds: { R1: '4', R2: 5 } },
];
const equivalentRoster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Exact Team', targetLeague: 'B-Klasse 2026/2027',
    currentPlayers: equivalentCurrentRows, archiveData: {}, classMean: 5,
});
assert.equal(equivalentRoster.players.length, 1);
assert.deepEqual(
    Model.buildTeamRoster({
        teamId: '035', teamName: 'Exact Team', targetLeague: 'B-Klasse 2026/2027',
        currentPlayers: equivalentCurrentRows.slice().reverse(), archiveData: {}, classMean: 5,
    }),
    equivalentRoster,
    'current-row input order cannot alter a roster',
);

for (const conflictRows of [
    [
        { id: '321', name: 'Conflict', v_nr: '035', company: 'Exact Team', league: 'B-Klasse', season: '2026/2027', rounds: { R1: 4 } },
        { id: '321', name: 'Conflict', v_nr: '036', company: 'Other Team', league: 'B-Klasse', season: '2026/2027', rounds: { R1: 4 } },
    ],
    [
        { id: '322', name: 'Conflict', v_nr: '035', company: 'Exact Team', league: 'B-Klasse', season: '2026/2027', rounds: { R1: 4 } },
        { id: '322', name: 'Conflict Name', v_nr: '035', company: 'Exact Team', league: 'B-Klasse', season: '2026/2027', rounds: { R1: 4 } },
    ],
    [
        { id: '323', name: 'Conflict', v_nr: '035', company: 'Exact Team', league: 'B-Klasse', season: '2026/2027', rounds: { R1: 4 } },
        { id: '323', name: 'Conflict', v_nr: '035', company: 'Exact Team', league: 'A-Klasse', season: '2026/2027', rounds: { R1: 4 } },
    ],
    [
        { id: '325', name: 'Conflict', v_nr: '035', company: 'Exact Team', league: 'B-Klasse', season: '2026/2027', rounds: { R1: 4 } },
        { id: '325', name: 'Conflict', v_nr: '035', company: 'Exact Team', league: 'B-Klasse', season: '2026/2027', rounds: { R1: 5 } },
    ],
    [
        { id: '329', name: 'Conflict', v_nr: '035', team: 'Exact Team', league: 'B-Klasse', season: '2026/2027', rounds: { R1: 4 } },
        { id: '329', name: 'Conflict', v_nr: '035', team: 'Other Team', league: 'B-Klasse', season: '2026/2027', rounds: { R1: 4 } },
    ],
]) {
    const conflicted = Model.buildTeamRoster({
        teamId: '035', teamName: 'Exact Team', targetLeague: 'B-Klasse 2026/2027',
        currentPlayers: conflictRows, archiveData: {}, classMean: 5,
    });
    assert.deepEqual(conflicted.players, []);
    assert.deepEqual(conflicted.diagnostics.ambiguousPlayerIds, [conflictRows[0].id]);
}

const targetPlusStaleRoster = Model.buildTeamRoster({
    teamId: '035', teamName: 'Exact Team', targetLeague: 'B-Klasse 2026/2027',
    currentPlayers: [
        { id: '324', name: 'Conflict', v_nr: '035', company: 'Exact Team', league: 'B-Klasse', season: '2026/2027', rounds: { R1: 4 } },
        { id: '324', name: 'Stale Malformed', v_nr: '999', company: 'Other Team', league: 'B-Klasse', season: '2025/2026', rounds: { R1: Number.NaN } },
    ],
    archiveData: {}, classMean: 5,
});
assert.deepEqual(targetPlusStaleRoster.players.map((player) => player.id), ['324'],
    'a stale duplicate is ignored wholesale and cannot poison a valid target-season row');
assert.deepEqual(targetPlusStaleRoster.diagnostics.irrelevantCurrentIds, ['324']);
assert.deepEqual(targetPlusStaleRoster.diagnostics.ambiguousCurrentIds, []);

for (const badSeasonRow of [
    { id: '327', name: 'Past Season', v_nr: '035', league: 'B-Klasse', season: '2025/2026', rounds: { R1: 4 } },
    { id: '328', name: 'Future Season', v_nr: '035', league: 'B-Klasse', season: '2027/2028', rounds: { R1: 4 } },
]) {
    const seasonRejected = Model.buildTeamRoster({
        teamId: '035', targetLeague: 'B-Klasse 2026/2027', currentPlayers: [badSeasonRow],
        archiveData: {}, classMean: 5,
    });
    assert.deepEqual(seasonRejected.players, []);
    assert.deepEqual(seasonRejected.diagnostics.excludedCurrentIds, [badSeasonRow.id]);
}

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
