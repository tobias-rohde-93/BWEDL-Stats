'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Model = require('../match_preview_model.js');

const MARKER = 'archive_data.js has no round-derived historical evidence';
const archivePath = process.env.BWEDL_BACKTEST_ARCHIVE
    || path.join(__dirname, '..', 'archive_data.js');
const source = fs.readFileSync(archivePath, 'utf8');
const context = vm.createContext({ window: {} });
vm.runInContext(source, context, { filename: path.basename(archivePath) });
const archiveData = context.ARCHIVE_DATA || context.window.ARCHIVE_DATA;

function ownValue(object, key) {
    try {
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
            ? descriptor.value
            : undefined;
    } catch (_error) {
        return undefined;
    }
}

function inspectOwn(object, key) {
    try {
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        return {
            safe: true,
            exists: Boolean(descriptor),
            isData: Boolean(descriptor
                && Object.prototype.hasOwnProperty.call(descriptor, 'value')),
            value: descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
                ? descriptor.value
                : undefined,
        };
    } catch (_error) {
        return { safe: false, exists: false, isData: false, value: undefined };
    }
}

function scanEnrichment(archive) {
    assert.ok(archive && typeof archive === 'object', 'archive data must be an object');
    let enrichedRecords = 0;
    for (const playerId of Object.getOwnPropertyNames(archive)) {
        const historyInspection = inspectOwn(archive, playerId);
        assert.ok(historyInspection.safe && historyInspection.isData,
            'archive histories must be own data properties');
        const history = historyInspection.value;
        assert.ok(Array.isArray(history), 'archive histories must be arrays');
        for (const record of history) {
            if (!record || typeof record !== 'object') continue;
            const segmentsInspection = inspectOwn(record, 'segments');
            let evidenceObjects = [record];
            let segmented = false;
            if (segmentsInspection.exists) {
                assert.equal(segmentsInspection.safe && segmentsInspection.isData
                    && Array.isArray(segmentsInspection.value), true,
                'segment containers must expose an own data array');
                evidenceObjects = segmentsInspection.value;
                segmented = true;
            }
            let recordEvidence = 0;
            for (const evidenceObject of evidenceObjects) {
                assert.ok(evidenceObject && typeof evidenceObject === 'object',
                    'archive evidence entries must be objects');
                const inspections = ['rounds', 'appearances', 'points_per_appearance']
                    .map((field) => inspectOwn(evidenceObject, field));
                const present = inspections.filter((inspection) => inspection.exists).length;
                if (present === 0) continue;
                recordEvidence += 1;
                assert.equal(present, inspections.length,
                    'round-derived evidence must contain rounds, appearances, and points_per_appearance');
                assert.equal(inspections.every((inspection) => inspection.safe && inspection.isData), true,
                    'round-derived evidence must use own data properties');
            }
            if (recordEvidence === 0) continue;
            enrichedRecords += recordEvidence;
            const isolatedArchive = {};
            isolatedArchive[playerId] = [record];
            const isolatedIndex = Model.buildArchiveIndex(isolatedArchive);
            const normalized = isolatedIndex.histories[playerId];
            assert.equal(Array.isArray(normalized) && normalized.length === 1, true,
                `round-derived evidence must be structurally valid and internally consistent (${playerId} ${ownValue(record, 'season')})`);
            if (!segmented) {
                assert.equal(normalized[0].completeEvidence, true,
                    'legacy round-derived evidence must be complete');
            }
        }
    }
    return enrichedRecords;
}

let syntheticSegmentSequence = 1;
function syntheticSegment({ league, name, vNr, rounds, rank = 1 }) {
    const numeric = Object.values(rounds).filter(
        (value) => Number.isSafeInteger(value) && value >= 0,
    );
    const points = numeric.reduce((sum, value) => sum + value, 0);
    return {
        segment_id: `sha256:${(syntheticSegmentSequence++).toString(16).padStart(64, '0')}`,
        league,
        rank,
        name,
        v_nr: vNr,
        points,
        rounds,
        appearances: numeric.length,
        points_per_appearance: numeric.length ? points / numeric.length : 0,
    };
}

function syntheticSeason(season, segments, flags = {}) {
    const greatestNumericRound = (segment) => Math.max(-1, ...Object.entries(segment.rounds || {})
        .filter(([, value]) => Number.isSafeInteger(value) && value >= 0)
        .map(([key]) => Number(key.slice(1))));
    const primary = segments.slice().sort((left, right) => (
        greatestNumericRound(right) - greatestNumericRound(left)
        || right.appearances - left.appearances
        || left.segment_id.localeCompare(right.segment_id, 'en')
    ))[0];
    const container = {
        season,
        rank: Math.min(...segments.map((segment) => segment.rank)),
        points: segments.reduce((sum, segment) => sum + segment.points, 0),
        league: primary.league,
        name: primary.name,
        primary_segment_id: primary.segment_id,
        segments,
        ...(flags.roundOverlapAmbiguous ? { round_overlap_ambiguous: true } : {}),
    };
    if (segments.length === 1) {
        for (const field of ['v_nr', 'rounds', 'appearances', 'points_per_appearance']) {
            if (Object.hasOwn(primary, field)) container[field] = primary[field];
        }
    }
    return container;
}

function seasonRounds(startRound, values, markers = {}) {
    const lastRound = Math.max(
        startRound + values.length - 1,
        ...Object.keys(markers).map((key) => Number(key.slice(1)) || 0),
    );
    const rounds = {};
    for (let round = 1; round <= lastRound; round += 1) rounds[`R${round}`] = '';
    values.forEach((value, index) => { rounds[`R${startRound + index}`] = value; });
    Object.assign(rounds, markers);
    return rounds;
}

function buildSegmentBacktestFixture() {
    const archive = {};
    for (let index = 0; index < 8; index += 1) {
        const playerId = String(100 + index);
        archive[playerId] = [
            syntheticSeason('2023/2024', [syntheticSegment({
                league: 'A-Klasse', name: `Calibration ${index}`, vNr: '010',
                rounds: seasonRounds(1, [40, 40, 40, 40]),
            })]),
            syntheticSeason('2024/2025', [syntheticSegment({
                league: 'B-Klasse', name: `Calibration ${index}`, vNr: '010',
                rounds: seasonRounds(1, [45, 45, 45, 45]),
            })]),
        ];
    }
    archive['200'] = [
        syntheticSeason('2024/2025', [
            syntheticSegment({ league: 'A-Klasse', name: 'Multi Class', vNr: '035', rounds: seasonRounds(1, [40, 40, 40, 40]) }),
            syntheticSegment({ league: 'B-Klasse', name: 'Multi Class', vNr: '035', rounds: seasonRounds(5, [45, 45, 45, 45]) }),
        ]),
        syntheticSeason('2025/2026', [syntheticSegment({
            league: 'B-Klasse', name: 'Multi Class', vNr: '035',
            rounds: seasonRounds(1, [46, 46, 46, 46]),
        })]),
    ];
    archive['201'] = [
        syntheticSeason('2024/2025', [
            syntheticSegment({
                league: 'B-Klasse', name: 'Transfer Player', vNr: '035',
                rounds: seasonRounds(1, [45, 45], { R3: 'VW' }),
            }),
            syntheticSegment({
                league: 'B-Klasse', name: 'Transfer Player', vNr: '036',
                rounds: seasonRounds(4, [45, 45]),
            }),
        ]),
        syntheticSeason('2025/2026', [syntheticSegment({
            league: 'B-Klasse', name: 'Transfer Player', vNr: '036',
            rounds: seasonRounds(1, [46, 46, 46, 46]),
        })]),
    ];
    archive['202'] = [
        syntheticSeason('2024/2025', [
            syntheticSegment({ league: 'B-Klasse', name: 'Ambiguous Player', vNr: '035', rounds: seasonRounds(1, [44, 44, 44, 44]) }),
            syntheticSegment({ league: 'B-Klasse', name: 'Ambiguous Player', vNr: '035', rounds: seasonRounds(3, [46, 46, 46, 46]) }),
        ], { roundOverlapAmbiguous: true }),
        syntheticSeason('2025/2026', [syntheticSegment({
            league: 'B-Klasse', name: 'Ambiguous Player', vNr: '036',
            rounds: seasonRounds(1, [45, 45, 45, 45]),
        })]),
    ];
    return archive;
}

const segmentFixture = buildSegmentBacktestFixture();
assert.equal(scanEnrichment(segmentFixture), 25,
    'segment enrichment is counted without compatibility analytics');

function segmentPerformance(record, requireSingleClass = true) {
    if (!record || record.identityAmbiguous || record.roundOverlapAmbiguous
        || !Array.isArray(record.segments)) return null;
    const eligible = record.segments.filter((segment) => segment.previewEligible === true);
    const classes = [...new Set(eligible.map((segment) => segment.leagueClass))];
    if (!eligible.length || (requireSingleClass && classes.length !== 1)) return null;
    const points = eligible.reduce((sum, segment) => sum + segment.points, 0);
    const appearances = eligible.reduce((sum, segment) => sum + segment.appearances, 0);
    if (!Number.isSafeInteger(points) || !Number.isSafeInteger(appearances)
        || appearances <= 0) return null;
    return { leagueClass: classes.length === 1 ? classes[0] : null, points, appearances, rating: points / appearances };
}

function meanAbsoluteError(samples, field) {
    return samples.reduce(
        (sum, sample) => sum + Math.abs(sample[field] - sample.actual), 0,
    ) / samples.length;
}

function runSegmentFixtureBacktest(fixture) {
    const index = Model.buildArchiveIndex(fixture);
    assert.equal(index.unusablePlayerIds.length, 0, 'valid segment fixtures remain indexable');
    const samples = [];
    for (const playerId of ['200', '201']) {
        const history = index.histories[playerId];
        const target = history[0];
        const targetPerformance = segmentPerformance(target);
        const earlier = history.slice(1).map((record) => ({
            record,
            performance: segmentPerformance(record, false),
        })).filter((entry) => entry.performance);
        const prior = Model.buildHistoricalPrior({
            playerId,
            targetClass: targetPerformance.leagueClass,
            archiveIndex: index,
            beforeSeason: target.season,
        });
        assert.equal(prior.sourceSeasons.every((season) => season < target.season), true,
            'the public cutoff excludes the held-out season');
        assert.equal(prior.sourceSeasons.includes(target.season), false,
            'target evidence never enters its own prior');
        assert.equal(prior.classCalibrated, true);
        const previousRatings = earlier.slice(0, 2).map((entry) => entry.performance.rating);
        const unadjusted = previousRatings.length === 2
            ? 0.7 * previousRatings[0] + 0.3 * previousRatings[1]
            : previousRatings[0];
        samples.push({
            playerId,
            actual: targetPerformance.rating,
            hybrid: prior.rating,
            previous: previousRatings[0],
            unadjusted,
            sourceClasses: prior.sourceClasses.slice(),
            sourceSeasons: prior.sourceSeasons.slice(),
            targetSeason: target.season,
            targetClass: targetPerformance.leagueClass,
            classChanger: prior.sourceClasses.some(
                (sourceClass) => sourceClass !== targetPerformance.leagueClass,
            ),
        });
    }
    const multiPrior = samples.find((sample) => sample.playerId === '200');
    const transferPrior = samples.find((sample) => sample.playerId === '201');
    assert.deepEqual(multiPrior.sourceClasses, ['A-Klasse', 'B-Klasse']);
    assert.deepEqual(transferPrior.sourceClasses, ['B-Klasse']);
    assert.equal(multiPrior.hybrid, 45, 'class groups convert before one season prior');
    assert.equal(transferPrior.hybrid, 45, 'same-class transfer segments aggregate once');
    const transferSource = index.histories['201'][1];
    assert.equal(transferSource.segments.length, 2);
    assert.equal(transferSource.segments.reduce(
        (sum, segment) => sum + segment.appearances, 0,
    ), 4, 'administrative markers are not appearances');
    assert.equal(transferSource.segments.some(
        (segment) => Object.values(segment.rounds).includes('VW'),
    ), true);
    const ambiguousPrior = Model.buildHistoricalPrior({
        playerId: '202', targetClass: 'B-Klasse', archiveIndex: index,
        beforeSeason: '2025/2026',
    });
    assert.deepEqual(ambiguousPrior.sourceSeasons, [],
        'overlap-ambiguous evidence is excluded rather than guessed');
    assert.equal(samples.length, 2);
    assert.equal(samples.filter((sample) => sample.classChanger).length, 1);
    const metrics = {
        samples: samples.length,
        classChangers: samples.filter((sample) => sample.classChanger).length,
        hybridMae: meanAbsoluteError(samples, 'hybrid'),
        previousMae: meanAbsoluteError(samples, 'previous'),
        unadjustedMae: meanAbsoluteError(samples, 'unadjusted'),
    };
    assert.equal(Object.values(metrics).every(Number.isFinite), true);
    assert.ok(metrics.hybridMae <= metrics.previousMae + 1e-9);
    assert.ok(metrics.hybridMae <= metrics.unadjustedMae + 1e-9);
    assert.deepEqual({
        enrichedSegments: scanEnrichment(fixture),
        eligibleTargets: samples.length,
        classChangers: metrics.classChangers,
        multiClassSeasons: index.histories['200'][1].segments.length > 1 ? 1 : 0,
        transferSeasons: new Set(index.histories['201'][1].segments.map((segment) => segment.v_nr)).size > 1 ? 1 : 0,
        overlapAmbiguousExcluded: ambiguousPrior.sourceSeasons.length === 0 ? 1 : 0,
        administrativeMarkers: transferSource.segments.reduce(
            (count, segment) => count + Object.values(segment.rounds).filter((value) => value === 'VW').length,
            0,
        ),
    }, {
        enrichedSegments: 25,
        eligibleTargets: 2,
        classChangers: 1,
        multiClassSeasons: 1,
        transferSeasons: 1,
        overlapAmbiguousExcluded: 1,
        administrativeMarkers: 1,
    }, 'synthetic coverage remains exact');
    return metrics;
}

runSegmentFixtureBacktest(segmentFixture);

const enrichedRecords = scanEnrichment(archiveData);
if (enrichedRecords === 0) {
    console.log(MARKER);
    process.exit(0);
}

const index = Model.buildArchiveIndex(archiveData);
const indexedEvidenceSegments = Object.keys(index.histories).reduce(
    (count, playerId) => count + index.histories[playerId].reduce(
        (recordCount, record) => recordCount + record.segments.filter(
            (segment) => segment.completeEvidence,
        ).length,
        0,
    ),
    0,
);
assert.equal(indexedEvidenceSegments, enrichedRecords,
    'globally ambiguous or duplicate round-derived evidence is invalid');
const samples = [];
let eligibleTargets = 0;
for (const playerId of Object.keys(index.histories).sort()) {
    const history = index.histories[playerId];
    if (history.length < 2) continue;
    const target = history[0];
    const targetPerformance = segmentPerformance(target);
    if (!targetPerformance) continue;
    eligibleTargets += 1;
    const precedingWindow = history.slice(1, 3).map(
        (record) => segmentPerformance(record, false),
    );
    if (!precedingWindow[0]) continue;
    const prior = Model.buildHistoricalPrior({
        playerId,
        targetClass: targetPerformance.leagueClass,
        archiveIndex: index,
        beforeSeason: target.season,
    });
    if (!prior.seasons.length || prior.sourceSeasons.some((season) => season >= target.season)) continue;
    const actual = targetPerformance.rating;
    const previous = precedingWindow[0].rating;
    const previousTwo = precedingWindow.filter(Boolean).map((performance) => performance.rating);
    const unadjusted = previousTwo.length === 2
        ? 0.7 * previousTwo[0] + 0.3 * previousTwo[1]
        : previousTwo[0];
    samples.push({
        actual,
        hybrid: prior.rating,
        previous,
        unadjusted,
        classChanger: prior.sourceClasses.some(
            (sourceClass) => sourceClass !== targetPerformance.leagueClass,
        ),
        targetSeason: target.season,
        sourceSeasons: prior.sourceSeasons.slice(),
    });
}

assert.ok(samples.length > 0, 'chronological backtest needs overall samples');
assert.ok(samples.some((sample) => sample.classChanger), 'chronological backtest needs class changers');
assert.equal(samples.every((sample) => sample.sourceSeasons.every(
    (season) => season < sample.targetSeason,
)), true, 'target seasons never leak into their own forecasts');

function mae(field, values = samples) {
    return values.reduce((sum, sample) => sum + Math.abs(sample[field] - sample.actual), 0)
        / values.length;
}

const indexedRecords = Object.values(index.histories).flat();
const indexedSegments = indexedRecords.flatMap((record) => record.segments);

const metrics = {
    samples: samples.length,
    classChangers: samples.filter((sample) => sample.classChanger).length,
    hybridMae: mae('hybrid'),
    previousMae: mae('previous'),
    unadjustedMae: mae('unadjusted'),
    enrichedSegments: enrichedRecords,
    eligibleTargets,
    ambiguousSeasonsExcluded: indexedRecords.filter(
        (record) => record.identityAmbiguous || record.roundOverlapAmbiguous,
    ).length,
    multiClassSeasons: indexedRecords.filter((record) => new Set(
        record.segments.filter((segment) => segment.previewEligible)
            .map((segment) => segment.leagueClass),
    ).size > 1).length,
    transferSeasons: indexedRecords.filter((record) => new Set(
        record.segments.map((segment) => segment.v_nr).filter(Boolean),
    ).size > 1).length,
    administrativeMarkers: indexedSegments.reduce(
        (count, segment) => count + Object.values(segment.rounds || {})
            .filter((value) => typeof value === 'string' && value !== '').length,
        0,
    ),
};
assert.equal(Object.values(metrics).every(Number.isFinite), true);
assert.ok(metrics.hybridMae <= metrics.previousMae + 1e-9);
assert.ok(metrics.hybridMae <= metrics.unadjustedMae + 1e-9);
console.log(`historical match preview backtest: ${JSON.stringify(metrics)}`);
