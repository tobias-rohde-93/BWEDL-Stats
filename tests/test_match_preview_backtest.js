'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Model = require('../match_preview_model.js');

const MARKER = 'archive_data.js has no round-derived historical evidence';
const source = fs.readFileSync(path.join(__dirname, '..', 'archive_data.js'), 'utf8');
const context = vm.createContext({ window: {} });
vm.runInContext(source, context, { filename: 'archive_data.js' });
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

function hasRoundEvidence(archive) {
    if (!archive || typeof archive !== 'object') return false;
    try {
        return Object.getOwnPropertyNames(archive).some((id) => {
            const history = ownValue(archive, id);
            return Array.isArray(history) && history.some((record) => (
                record && typeof record === 'object'
                && ownValue(record, 'rounds')
                && Number.isSafeInteger(ownValue(record, 'appearances'))
                && ownValue(record, 'appearances') > 0
            ));
        });
    } catch (_error) {
        return false;
    }
}

if (!hasRoundEvidence(archiveData)) {
    console.log(MARKER);
    process.exit(0);
}

const index = Model.buildArchiveIndex(archiveData);
const samples = [];
for (const playerId of Object.keys(index.histories).sort()) {
    const usable = index.histories[playerId].filter((record) => record.previewEligible);
    if (usable.length < 2) continue;
    const target = usable[0];
    const earlierArchive = {};
    for (const candidateId of Object.keys(index.histories)) {
        const records = index.histories[candidateId].filter((record) => record.seasonEnd <= target.seasonStart);
        if (records.length) earlierArchive[candidateId] = records;
    }
    const earlierIndex = Model.buildArchiveIndex(earlierArchive);
    const calibration = Model.buildClassCalibration(earlierIndex);
    const prior = Model.buildHistoricalPrior({
        playerId,
        targetClass: target.leagueClass,
        archiveIndex: earlierIndex,
        calibration,
        beforeSeason: target.season,
    });
    if (!prior.seasons.length || prior.sourceSeasons.some((season) => season >= target.season)) continue;
    const actual = target.points / target.appearances;
    const previous = usable[1].points / usable[1].appearances;
    const previousTwo = usable.slice(1, 3).map((record) => record.points / record.appearances);
    const unadjusted = previousTwo.length === 2
        ? 0.7 * previousTwo[0] + 0.3 * previousTwo[1]
        : previousTwo[0];
    samples.push({
        actual,
        hybrid: prior.rating,
        previous,
        unadjusted,
        classChanger: usable[1].leagueClass !== target.leagueClass,
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

const metrics = {
    samples: samples.length,
    classChangers: samples.filter((sample) => sample.classChanger).length,
    hybridMae: mae('hybrid'),
    previousMae: mae('previous'),
    unadjustedMae: mae('unadjusted'),
};
assert.equal(Object.values(metrics).every(Number.isFinite), true);
assert.ok(metrics.hybridMae <= metrics.previousMae + 1e-9);
assert.ok(metrics.hybridMae <= metrics.unadjustedMae + 1e-9);
console.log(`historical match preview backtest: ${JSON.stringify(metrics)}`);
