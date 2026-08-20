(function (root, factory) {
    const api = Object.freeze(factory());
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.BwedlMatchPreviewModel = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
    'use strict';

    const CLASS_ORDER = Object.freeze([
        'Bezirksliga',
        'A-Klasse',
        'B-Klasse',
        'C-Klasse',
    ]);
    const MIN_TRANSITIONS = 8;
    const PRIOR_APPEARANCES = 4;
    const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
    const INVALID_CLONE = Object.freeze({ invalid: true });
    const ARCHIVE_INDEXES = new WeakSet();
    const OUTCOME_MODELS = new WeakSet();
    const OUTCOME_PARAMETER_GRID = deepFreeze({
        scale: [0.5, 1, 2, 4],
        homeAdvantage: [0, 0.25, 0.5],
        drawPeak: [0.25, 0.5, 1],
        drawDecay: [0.25, 0.5, 1],
    });
    const CONFIDENCE_ORDER = Object.freeze(['high', 'medium', 'provisional', 'very-low']);
    const EVIDENCE_ORDER = Object.freeze({
        'current+history': 0,
        current: 1,
        historical: 2,
        'historical-fallback': 3,
        neutral: 4,
    });
    const LEAGUE_CLASS_GRAMMAR = /^(bezirksliga|([abc])\s*(?:[-\u2010-\u2015]\s*)?klasse)(?:\s+gruppe\s+([a-z0-9]+))?(?:\s+(?:(?:\/\s+)?saison\s+)?((?:\d{4}\s*[/\-]\s*\d{4})|(?:\d{4}\s*[/\-]\s*\d{2})|(?:\d{2}\s*[/\-]\s*\d{2})))?$/u;
    const RESERVED_GROUP_TOKEN = /^(?:mix(?:ed)?(?:klasse|gruppe)?|(?:liga|super|world|euro)?cup(?:runde|finale|halbfinale|spiel)?|(?:liga)?pokal(?:runde|finale|halbfinale|spiel)?|freundschaft)$/u;

    function ownData(object, key) {
        if (!object || (typeof object !== 'object' && typeof object !== 'function')) return null;
        try {
            const descriptor = Object.getOwnPropertyDescriptor(object, key);
            return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
                ? descriptor
                : null;
        } catch (_error) {
            return null;
        }
    }

    function ownNames(object) {
        try {
            return Object.getOwnPropertyNames(object);
        } catch (_error) {
            return [];
        }
    }

    function inspectOwn(object, key) {
        try {
            const descriptor = Object.getOwnPropertyDescriptor(object, key);
            return {
                ok: true,
                exists: Boolean(descriptor),
                isData: Boolean(descriptor
                    && Object.prototype.hasOwnProperty.call(descriptor, 'value')),
                descriptor: descriptor || null,
            };
        } catch (_error) {
            return { ok: false, exists: false, isData: false, descriptor: null };
        }
    }

    function inspectNames(object) {
        try {
            return { ok: true, names: Object.getOwnPropertyNames(object) };
        } catch (_error) {
            return { ok: false, names: [] };
        }
    }

    function inspectArray(value) {
        try {
            return { ok: true, isArray: Array.isArray(value) };
        } catch (_error) {
            return { ok: false, isArray: false };
        }
    }

    function defineData(object, key, value) {
        Object.defineProperty(object, key, {
            configurable: true,
            enumerable: true,
            writable: true,
            value,
        });
    }

    function deepFreeze(value, seen) {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
        const visited = seen || new WeakSet();
        if (visited.has(value)) return value;
        visited.add(value);
        for (const key of ownNames(value)) {
            const descriptor = ownData(value, key);
            if (descriptor) deepFreeze(descriptor.value, visited);
        }
        return Object.freeze(value);
    }

    function cloneOwnData(value, seen) {
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
        if (typeof value === 'number') return Number.isFinite(value) ? value : INVALID_CLONE;
        if (typeof value !== 'object') return INVALID_CLONE;

        const arrayInspection = inspectArray(value);
        const namesInspection = inspectNames(value);
        if (!arrayInspection.ok || !namesInspection.ok) return INVALID_CLONE;
        const visited = seen || new WeakMap();
        if (visited.has(value)) return INVALID_CLONE;
        const clone = arrayInspection.isArray ? [] : {};
        visited.set(value, clone);
        for (const key of namesInspection.names) {
            if (arrayInspection.isArray && key === 'length') continue;
            const inspection = inspectOwn(value, key);
            if (!inspection.ok || !inspection.isData) return INVALID_CLONE;
            if (!inspection.descriptor.enumerable) continue;
            const child = cloneOwnData(inspection.descriptor.value, visited);
            if (child === INVALID_CLONE) return INVALID_CLONE;
            defineData(clone, key, child);
        }
        visited.delete(value);
        return clone;
    }

    function isSafeNonnegativeInteger(value) {
        return typeof value === 'number'
            && Number.isSafeInteger(value)
            && value >= 0;
    }

    function parseCanonicalInteger(value) {
        if (isSafeNonnegativeInteger(value)) return Object.is(value, -0) ? 0 : value;
        if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) return null;
        const numeric = Number(value);
        return Number.isSafeInteger(numeric) ? numeric : null;
    }

    function cloneCanonicalRounds(rounds) {
        const clone = {};
        for (const key of ownNames(rounds)) {
            const descriptor = ownData(rounds, key);
            if (!descriptor || !descriptor.enumerable) continue;
            const numeric = parseCanonicalInteger(descriptor.value);
            defineData(clone, key, numeric === null ? descriptor.value : numeric);
        }
        return clone;
    }

    function normalizeLeagueClass(value) {
        if (typeof value !== 'string') return null;
        const text = value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
            .toLocaleLowerCase('de-DE');
        const match = LEAGUE_CLASS_GRAMMAR.exec(text);
        if (!match) return null;
        if (match[3] && RESERVED_GROUP_TOKEN.test(match[3])) return null;
        if (match[4] && canonicalSeason(match[4]) === null) return null;
        return match[1] === 'bezirksliga'
            ? 'Bezirksliga'
            : `${match[2].toUpperCase()}-Klasse`;
    }

    function roundStats(rounds) {
        const entries = [];
        if (rounds && typeof rounds === 'object') {
            for (const key of ownNames(rounds)) {
                const descriptor = ownData(rounds, key);
                if (!descriptor || !descriptor.enumerable) continue;
                const match = /^R([1-9][0-9]*)$/u.exec(key);
                if (!match) continue;
                const roundNumber = Number(match[1]);
                if (!Number.isSafeInteger(roundNumber)) continue;
                const numeric = parseCanonicalInteger(descriptor.value);
                if (numeric !== null) entries.push({ roundNumber, value: numeric });
            }
        }
        entries.sort((left, right) => left.roundNumber - right.roundNumber);
        const values = entries.map((entry) => entry.value);
        let points = 0;
        for (const value of values) {
            points += value;
            if (!Number.isSafeInteger(points) || points > MAX_SAFE_INTEGER) {
                return { values: [], points: 0, appearances: 0, mean: 0 };
            }
        }
        return {
            values,
            points,
            appearances: values.length,
            mean: values.length ? points / values.length : 0,
        };
    }

    function parseSeason(value) {
        if (typeof value !== 'string') return null;
        const match = /^(\d{2}|\d{4})\s*[/\-]\s*(\d{2}|\d{4})$/u.exec(value.trim());
        if (!match) return null;
        const shortStart = Number(match[1]);
        const startYear = match[1].length === 4
            ? shortStart
            : (shortStart >= 70 ? 1900 + shortStart : 2000 + shortStart);
        let endYear = Number(match[2]);
        if (match[2].length === 2) {
            endYear += Math.floor(startYear / 100) * 100;
            if (endYear < startYear) endYear += 100;
        }
        const span = endYear - startYear;
        if (span < 1 || span > 2) return null;
        return {
            key: `${startYear}/${String(endYear % 100).padStart(2, '0')}`,
            startYear,
            endYear,
        };
    }

    function canonicalSeason(value) {
        const parsed = parseSeason(value);
        return parsed ? parsed.key : null;
    }

    function displayPlayerName(value) {
        if (typeof value !== 'string') return null;
        const name = value.normalize('NFKC').replace(/\s+/gu, ' ').trim().normalize('NFC');
        return name && /\p{L}/u.test(name) ? name : null;
    }

    function canonicalPlayerName(value) {
        const name = displayPlayerName(value);
        return name ? name.toLocaleLowerCase('de-DE') : '';
    }

    function validateRoundSequence(rounds) {
        if (!rounds || typeof rounds !== 'object' || Array.isArray(rounds)) return null;
        const numbers = [];
        for (const key of ownNames(rounds)) {
            const descriptor = ownData(rounds, key);
            if (!descriptor || !descriptor.enumerable) continue;
            const match = /^R([1-9][0-9]*)$/u.exec(key);
            if (!match) return null;
            const number = Number(match[1]);
            if (!Number.isSafeInteger(number)) return null;
            const value = descriptor.value;
            const numeric = parseCanonicalInteger(value);
            if (numeric === null && !(typeof value === 'string' && (value === '' || value === 'x'))) {
                return null;
            }
            numbers.push(number);
        }
        if (!numbers.length) return null;
        numbers.sort((left, right) => left - right);
        if (numbers.some((number, index) => number !== index + 1)) return null;
        return roundStats(rounds);
    }

    function normalizedRecord(record, playerId) {
        if (!record || typeof record !== 'object') return { identityConflict: true };
        const recordArray = inspectArray(record);
        if (!recordArray.ok || recordArray.isArray) return { identityConflict: true };

        const innerIdInspection = inspectOwn(record, 'id');
        const seasonInspection = inspectOwn(record, 'season');
        const nameInspection = inspectOwn(record, 'name');
        if (!innerIdInspection.ok || !seasonInspection.ok || !nameInspection.ok
            || (innerIdInspection.exists && !innerIdInspection.isData)
            || !seasonInspection.isData || !nameInspection.isData) {
            return { identityConflict: true };
        }
        if (innerIdInspection.exists
            && (typeof innerIdInspection.descriptor.value !== 'string'
                || innerIdInspection.descriptor.value !== playerId)) {
            return { identityConflict: true };
        }

        const parsedSeason = parseSeason(seasonInspection.descriptor.value);
        const name = displayPlayerName(nameInspection.descriptor.value);
        if (!parsedSeason || !name) return { identityConflict: true };
        const identity = {
            season: parsedSeason.key,
            seasonStart: parsedSeason.startYear,
            seasonEnd: parsedSeason.endYear,
            name,
            normalizedName: canonicalPlayerName(name),
        };

        const leagueDescriptor = ownData(record, 'league');
        const pointsDescriptor = ownData(record, 'points');
        if (!leagueDescriptor || !pointsDescriptor) return { identity, record: null };
        const league = typeof leagueDescriptor.value === 'string'
            ? leagueDescriptor.value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
            : '';
        if (!league || !isSafeNonnegativeInteger(pointsDescriptor.value)) {
            return { identity, record: null };
        }

        const clone = cloneOwnData(record);
        if (clone === INVALID_CLONE || !clone || typeof clone !== 'object') {
            return { identityConflict: true };
        }
        const result = clone;
        result.id = playerId;
        result.season = identity.season;
        result.seasonStart = identity.seasonStart;
        result.seasonEnd = identity.seasonEnd;
        result.name = identity.name;
        result.normalizedName = identity.normalizedName;
        result.league = league;
        result.leagueClass = normalizeLeagueClass(league);
        result.points = Object.is(pointsDescriptor.value, -0) ? 0 : pointsDescriptor.value;

        const clubDescriptor = ownData(record, 'v_nr');
        const validClub = Boolean(clubDescriptor
            && typeof clubDescriptor.value === 'string'
            && /^[0-9]+$/u.test(clubDescriptor.value));
        if (clubDescriptor && validClub) result.v_nr = clubDescriptor.value;

        const previewDescriptors = ['rounds', 'appearances', 'points_per_appearance']
            .map((key) => ownData(result, key));
        const presentPreviewFields = previewDescriptors.filter(Boolean).length;
        result.completeEvidence = false;
        result.previewEligible = false;
        if (presentPreviewFields === previewDescriptors.length && validClub) {
            const stats = validateRoundSequence(previewDescriptors[0].value);
            const appearances = Object.is(previewDescriptors[1].value, -0)
                ? 0
                : previewDescriptors[1].value;
            const average = Object.is(previewDescriptors[2].value, -0)
                ? 0
                : previewDescriptors[2].value;
            const expectedAverage = appearances ? result.points / appearances : 0;
            if (stats
                && isSafeNonnegativeInteger(appearances)
                && typeof average === 'number'
                && Number.isFinite(average)
                && average >= 0
                && stats.points === result.points
                && stats.appearances === appearances
                && Math.abs(average - expectedAverage) <= 1e-12) {
                result.rounds = cloneCanonicalRounds(previewDescriptors[0].value);
                result.appearances = appearances;
                result.points_per_appearance = average;
                result.completeEvidence = true;
                result.previewEligible = appearances > 0 && result.leagueClass !== null;
            }
        }
        return { identity, record: deepFreeze(result) };
    }

    function arrayDataValues(value) {
        const arrayInspection = inspectArray(value);
        if (!arrayInspection.ok || !arrayInspection.isArray) return { ok: false, values: [] };
        const namesInspection = inspectNames(value);
        if (!namesInspection.ok) return { ok: false, values: [] };
        const entries = [];
        for (const key of namesInspection.names) {
            if (!/^(?:0|[1-9][0-9]*)$/u.test(key)) continue;
            const index = Number(key);
            const inspection = inspectOwn(value, key);
            if (!inspection.ok || !inspection.isData) return { ok: false, values: [] };
            if (inspection.descriptor.enumerable && Number.isSafeInteger(index)) {
                entries.push({ index, value: inspection.descriptor.value });
            }
        }
        entries.sort((left, right) => left.index - right.index);
        return { ok: true, values: entries.map((entry) => entry.value) };
    }

    function buildArchiveIndex(archive) {
        const histories = {};
        const unusable = new Set();
        const diagnostics = { invalidArchive: false };
        if (!archive || typeof archive !== 'object') {
            diagnostics.invalidArchive = true;
            return finalizeArchiveIndex({ kind: 'archive-index-v1', histories, unusablePlayerIds: [], diagnostics });
        }
        const archiveArray = inspectArray(archive);
        const archiveNames = inspectNames(archive);
        if (!archiveArray.ok || archiveArray.isArray || !archiveNames.ok) {
            diagnostics.invalidArchive = true;
            return finalizeArchiveIndex({ kind: 'archive-index-v1', histories, unusablePlayerIds: [], diagnostics });
        }

        const candidates = [];
        for (const playerId of archiveNames.names) {
            if (!/^[0-9]+$/u.test(playerId)) continue;
            const playerInspection = inspectOwn(archive, playerId);
            if (!playerInspection.ok || !playerInspection.isData) {
                unusable.add(playerId);
                continue;
            }
            if (!playerInspection.descriptor.enumerable) continue;
            const historyValues = arrayDataValues(playerInspection.descriptor.value);
            if (!historyValues.ok) {
                unusable.add(playerId);
                continue;
            }
            const records = [];
            const identities = [];
            let identityConflict = false;
            for (const sourceRecord of historyValues.values) {
                const parsed = normalizedRecord(sourceRecord, playerId);
                if (parsed.identityConflict) {
                    identityConflict = true;
                    break;
                }
                identities.push(parsed.identity);
                if (parsed.record) records.push(parsed.record);
            }
            if (identityConflict) {
                unusable.add(playerId);
                continue;
            }
            const seasons = new Set();
            const names = new Set();
            for (const item of identities) {
                if (seasons.has(item.season)) identityConflict = true;
                seasons.add(item.season);
                names.add(item.normalizedName);
            }
            if (identityConflict || names.size !== 1) {
                unusable.add(playerId);
                continue;
            }
            if (!records.length) continue;
            records.sort((left, right) => (
                right.seasonEnd - left.seasonEnd || right.seasonStart - left.seasonStart
            ));
            candidates.push({ playerId, records: Object.freeze(records.slice()) });
        }

        candidates.sort((left, right) => left.playerId.localeCompare(right.playerId, 'en'));
        for (const candidate of candidates) defineData(histories, candidate.playerId, candidate.records);
        const unusablePlayerIds = Array.from(unusable).sort((left, right) => left.localeCompare(right, 'en'));
        return finalizeArchiveIndex({ kind: 'archive-index-v1', histories, unusablePlayerIds, diagnostics });
    }

    function finalizeArchiveIndex(value) {
        const index = deepFreeze(value);
        ARCHIVE_INDEXES.add(index);
        return index;
    }

    function isArchiveIndex(value) {
        return Boolean(value && typeof value === 'object' && ARCHIVE_INDEXES.has(value));
    }

    function asArchiveIndex(value) {
        return isArchiveIndex(value) ? value : buildArchiveIndex(value);
    }

    function seasonalPerformance(record) {
        if (!record || typeof record !== 'object') return null;
        const eligible = ownData(record, 'previewEligible');
        const points = ownData(record, 'points');
        const appearances = ownData(record, 'appearances');
        if (!eligible || eligible.value !== true || !points || !appearances
            || !isSafeNonnegativeInteger(points.value)
            || !isSafeNonnegativeInteger(appearances.value)
            || appearances.value === 0) return null;
        return points.value / appearances.value;
    }

    function buildClassSeasonMeans(source) {
        const index = asArchiveIndex(source);
        const totals = {};
        for (const playerId of Object.keys(index.histories)) {
            for (const record of index.histories[playerId]) {
                if (seasonalPerformance(record) === null) continue;
                const key = `${record.leagueClass}|${record.season}`;
                if (!totals[key]) totals[key] = { points: 0n, appearances: 0n, playerRecords: 0 };
                totals[key].points += BigInt(record.points);
                totals[key].appearances += BigInt(record.appearances);
                totals[key].playerRecords += 1;
            }
        }
        const means = {};
        for (const key of Object.keys(totals).sort()) {
            const total = totals[key];
            const numericPoints = Number(total.points);
            const numericAppearances = Number(total.appearances);
            defineData(means, key, {
                points: total.points <= BigInt(MAX_SAFE_INTEGER)
                    ? numericPoints
                    : total.points.toString(),
                appearances: total.appearances <= BigInt(MAX_SAFE_INTEGER)
                    ? numericAppearances
                    : total.appearances.toString(),
                playerRecords: total.playerRecords,
                mean: numericPoints / numericAppearances,
            });
        }
        return deepFreeze(means);
    }

    function stabilizeSeasonRecord(record, classSeasonMeans) {
        const raw = seasonalPerformance(record);
        if (raw === null || !classSeasonMeans || typeof classSeasonMeans !== 'object') return null;
        const leagueClass = ownData(record, 'leagueClass');
        const season = ownData(record, 'season');
        const points = ownData(record, 'points');
        const appearances = ownData(record, 'appearances');
        if (!leagueClass || !season || !points || !appearances) return null;
        const meanDescriptor = ownData(classSeasonMeans, `${leagueClass.value}|${season.value}`);
        if (!meanDescriptor || !meanDescriptor.value || typeof meanDescriptor.value !== 'object') return null;
        const mean = ownData(meanDescriptor.value, 'mean');
        if (!mean || typeof mean.value !== 'number' || !Number.isFinite(mean.value)) return null;
        const stable = (points.value + PRIOR_APPEARANCES * mean.value)
            / (appearances.value + PRIOR_APPEARANCES);
        return Number.isFinite(stable) ? stable : null;
    }

    function displayExactWeight(value) {
        return value <= BigInt(MAX_SAFE_INTEGER) ? Number(value) : value.toString();
    }

    function prepareRobustWeights(observations) {
        if (!observations.length) {
            return {
                observations: [],
                rawTotalWeight: 0,
                weightMedian: 0,
                weightCap: 0,
                cappedWeightCount: 0,
            };
        }
        const sortedWeights = observations
            .map((observation) => observation.rawWeight)
            .sort((left, right) => left - right);
        const weightMedian = sortedWeights[Math.floor((sortedWeights.length - 1) / 2)];
        const weightCap = weightMedian > Math.floor(MAX_SAFE_INTEGER / 2)
            ? MAX_SAFE_INTEGER
            : weightMedian * 2;
        const prepared = observations.map((observation) => ({
            ...observation,
            effectiveWeight: Math.min(observation.rawWeight, weightCap),
        }));
        const rawTotal = prepared.reduce(
            (sum, observation) => sum + BigInt(observation.rawWeight),
            0n,
        );
        return {
            observations: prepared,
            rawTotalWeight: displayExactWeight(rawTotal),
            weightMedian,
            weightCap,
            cappedWeightCount: prepared.filter(
                (observation) => observation.effectiveWeight < observation.rawWeight,
            ).length,
        };
    }

    function weightedMedian(observations) {
        if (!observations.length) return null;
        const sorted = observations.slice().sort((left, right) => (
            left.value - right.value
            || left.playerId.localeCompare(right.playerId, 'en')
            || left.olderSeason.localeCompare(right.olderSeason, 'en')
        ));
        const totalWeight = sorted.reduce(
            (sum, observation) => sum + BigInt(observation.effectiveWeight),
            0n,
        );
        let cumulative = 0n;
        for (const observation of sorted) {
            cumulative += BigInt(observation.effectiveWeight);
            if (cumulative * 2n >= totalWeight) {
                return {
                    value: Object.is(observation.value, -0) ? 0 : observation.value,
                    totalWeight: displayExactWeight(totalWeight),
                    sorted,
                };
            }
        }
        return null;
    }

    function buildClassCalibration(archive) {
        const index = asArchiveIndex(archive);
        const classSeasonMeans = buildClassSeasonMeans(index);
        const observationsByEdge = {};
        const excluded = {
            nonconsecutive: 0,
            incompleteEvidence: 0,
            sameClass: 0,
            nonAdjacentOrUnknownClass: 0,
            insufficientAppearances: 0,
            invalidPerformance: 0,
        };
        for (let indexPosition = 0; indexPosition < CLASS_ORDER.length - 1; indexPosition += 1) {
            observationsByEdge[`${CLASS_ORDER[indexPosition]}>${CLASS_ORDER[indexPosition + 1]}`] = [];
        }

        for (const playerId of Object.keys(index.histories)) {
            const history = index.histories[playerId];
            for (let position = 0; position < history.length - 1; position += 1) {
                const newer = history[position];
                const older = history[position + 1];
                if (older.seasonEnd !== newer.seasonStart) {
                    excluded.nonconsecutive += 1;
                    continue;
                }
                if (!newer.completeEvidence || !older.completeEvidence
                    || !newer.previewEligible || !older.previewEligible) {
                    excluded.incompleteEvidence += 1;
                    continue;
                }
                const newerClassIndex = CLASS_ORDER.indexOf(newer.leagueClass);
                const olderClassIndex = CLASS_ORDER.indexOf(older.leagueClass);
                if (newerClassIndex === olderClassIndex) {
                    excluded.sameClass += 1;
                    continue;
                }
                if (newerClassIndex < 0 || olderClassIndex < 0
                    || Math.abs(newerClassIndex - olderClassIndex) !== 1) {
                    excluded.nonAdjacentOrUnknownClass += 1;
                    continue;
                }
                if (newer.appearances < 4 || older.appearances < 4) {
                    excluded.insufficientAppearances += 1;
                    continue;
                }
                const newerRaw = seasonalPerformance(newer);
                const olderRaw = seasonalPerformance(older);
                if (newerRaw === null || olderRaw === null) {
                    excluded.invalidPerformance += 1;
                    continue;
                }
                const highIndex = Math.min(newerClassIndex, olderClassIndex);
                const edge = `${CLASS_ORDER[highIndex]}>${CLASS_ORDER[highIndex + 1]}`;
                const highRaw = newerClassIndex === highIndex ? newerRaw : olderRaw;
                const lowRaw = newerClassIndex === highIndex ? olderRaw : newerRaw;
                observationsByEdge[edge].push({
                    playerId,
                    olderSeason: older.season,
                    newerSeason: newer.season,
                    value: lowRaw - highRaw,
                    rawWeight: Math.min(older.appearances, newer.appearances),
                });
            }
        }

        const transitions = {};
        const edgeDiagnostics = {};
        for (const edge of Object.keys(observationsByEdge)) {
            const observations = observationsByEdge[edge];
            const robustWeights = prepareRobustWeights(observations);
            const median = weightedMedian(robustWeights.observations);
            const values = observations.map((observation) => observation.value).sort((a, b) => a - b);
            const diagnostic = {
                count: observations.length,
                published: observations.length >= MIN_TRANSITIONS,
                totalWeight: median ? median.totalWeight : 0,
                rawTotalWeight: robustWeights.rawTotalWeight,
                weightMedian: robustWeights.weightMedian,
                weightCap: robustWeights.weightCap,
                cappedWeightCount: robustWeights.cappedWeightCount,
                weightMedianRule: 'lower-unweighted-raw-weight',
                medianRule: 'lower-weighted',
                observationRange: values.length ? [values[0], values[values.length - 1]] : [],
                observations: (median ? median.sorted : []).map((observation) => ({
                    playerId: observation.playerId,
                    olderSeason: observation.olderSeason,
                    newerSeason: observation.newerSeason,
                    value: observation.value,
                    rawWeight: observation.rawWeight,
                    effectiveWeight: observation.effectiveWeight,
                    capped: observation.effectiveWeight < observation.rawWeight,
                })),
            };
            defineData(edgeDiagnostics, edge, diagnostic);
            if (diagnostic.published && median && Number.isFinite(median.value)) {
                defineData(transitions, edge, {
                    count: observations.length,
                    offset: median.value,
                    totalWeight: median.totalWeight,
                    rawTotalWeight: robustWeights.rawTotalWeight,
                    weightMedian: robustWeights.weightMedian,
                    weightCap: robustWeights.weightCap,
                    cappedWeightCount: robustWeights.cappedWeightCount,
                    weightMedianRule: 'lower-unweighted-raw-weight',
                    medianRule: 'lower-weighted',
                    observationRange: diagnostic.observationRange.slice(),
                });
            }
        }
        return deepFreeze({
            classOrder: CLASS_ORDER,
            minimumTransitions: MIN_TRANSITIONS,
            priorAppearances: PRIOR_APPEARANCES,
            classSeasonMeans,
            transitions,
            diagnostics: {
                unusablePlayerIds: index.unusablePlayerIds.slice(),
                excluded,
                edges: edgeDiagnostics,
            },
        });
    }

    function convertClassRating(rating, fromClass, toClass, calibration) {
        const failure = { rating, calibrated: false, path: [] };
        if (typeof rating !== 'number' || !Number.isFinite(rating)) return failure;
        const normalizedFrom = normalizeLeagueClass(fromClass);
        const normalizedTo = normalizeLeagueClass(toClass);
        const fromIndex = CLASS_ORDER.indexOf(normalizedFrom);
        const toIndex = CLASS_ORDER.indexOf(normalizedTo);
        if (fromIndex < 0 || toIndex < 0) return failure;
        if (fromIndex === toIndex) return { rating, calibrated: true, path: [] };
        const transitionsDescriptor = ownData(calibration, 'transitions');
        if (!transitionsDescriptor || !transitionsDescriptor.value
            || typeof transitionsDescriptor.value !== 'object') return failure;

        const step = toIndex > fromIndex ? 1 : -1;
        const path = [];
        const offsets = [];
        for (let position = fromIndex; position !== toIndex; position += step) {
            const highIndex = step > 0 ? position : position - 1;
            const edge = `${CLASS_ORDER[highIndex]}>${CLASS_ORDER[highIndex + 1]}`;
            const transitionDescriptor = ownData(transitionsDescriptor.value, edge);
            const offsetDescriptor = transitionDescriptor && ownData(transitionDescriptor.value, 'offset');
            if (!offsetDescriptor || typeof offsetDescriptor.value !== 'number'
                || !Number.isFinite(offsetDescriptor.value)) return failure;
            path.push(edge);
            offsets.push(step > 0 ? offsetDescriptor.value : -offsetDescriptor.value);
        }
        const converted = offsets.reduce((value, offset) => value + offset, rating);
        return Number.isFinite(converted)
            ? { rating: converted, calibrated: true, path }
            : failure;
    }

    function ownValue(object, key) {
        const descriptor = ownData(object, key);
        return descriptor ? descriptor.value : undefined;
    }

    function safeFinite(value, minimum) {
        return typeof value === 'number'
            && Number.isFinite(value)
            && value >= (minimum === undefined ? 0 : minimum)
            ? (Object.is(value, -0) ? 0 : value)
            : null;
    }

    function safeRating(value) {
        const rating = safeFinite(value, 0);
        return rating !== null && rating <= MAX_SAFE_INTEGER ? rating : null;
    }

    function safeIdentifier(value) {
        return typeof value === 'string' && /^[0-9]+$/u.test(value) ? value : null;
    }

    function seasonFromLeague(value) {
        if (typeof value !== 'string') return null;
        const matches = value.match(/(?:\d{4}\s*[/\-]\s*\d{2,4}|\d{2}\s*[/\-]\s*\d{2})/gu) || [];
        if (matches.length !== 1) return null;
        return canonicalSeason(matches[0]);
    }

    function filteredArchiveIndexBefore(index, beforeSeason) {
        if (!isArchiveIndex(index)) return buildArchiveIndex({});
        const parsedBefore = parseSeason(beforeSeason);
        if (!parsedBefore) return index;
        const archive = {};
        for (const playerId of ownNames(index.histories).sort((a, b) => a.localeCompare(b, 'en'))) {
            const historyDescriptor = ownData(index.histories, playerId);
            if (!historyDescriptor) continue;
            const records = historyDescriptor.value.filter(
                (record) => record.seasonEnd <= parsedBefore.startYear,
            );
            if (records.length) defineData(archive, playerId, records.slice());
        }
        return buildArchiveIndex(archive);
    }

    function resolveTargetClassMean(calibration, targetClass, beforeSeason, explicitMean) {
        const supplied = safeFinite(explicitMean, 0);
        if (supplied !== null) return supplied;
        const normalizedClass = normalizeLeagueClass(targetClass);
        const means = ownValue(calibration, 'classSeasonMeans');
        if (!normalizedClass || !means || typeof means !== 'object') return 1;
        const parsedBefore = parseSeason(beforeSeason);
        const candidates = [];
        for (const key of ownNames(means)) {
            const prefix = `${normalizedClass}|`;
            if (!key.startsWith(prefix)) continue;
            const season = parseSeason(key.slice(prefix.length));
            const entry = ownValue(means, key);
            const mean = ownValue(entry, 'mean');
            if (!season || (parsedBefore && season.endYear > parsedBefore.startYear)) continue;
            const numeric = safeFinite(mean, 0);
            if (numeric !== null) candidates.push({ seasonEnd: season.endYear, mean: numeric });
        }
        candidates.sort((left, right) => right.seasonEnd - left.seasonEnd || right.mean - left.mean);
        return candidates.length ? candidates[0].mean : 1;
    }

    function neutralHistoricalPrior(targetClass, neutralMean) {
        return deepFreeze({
            rating: neutralMean,
            neutralMean,
            targetClass,
            seasons: [],
            sourceSeasons: [],
            classCalibrated: false,
            confidence: 'very-low',
            provenance: 'neutral-target-class-mean',
        });
    }

    function buildHistoricalPrior(options) {
        const targetClass = normalizeLeagueClass(ownValue(options, 'targetClass'));
        const archiveIndex = ownValue(options, 'archiveIndex');
        const playerId = safeIdentifier(ownValue(options, 'playerId'));
        const beforeSeason = canonicalSeason(ownValue(options, 'beforeSeason'));
        const explicitMean = ownValue(options, 'classMean');
        if (!targetClass || !isArchiveIndex(archiveIndex)) {
            const neutralMean = safeFinite(explicitMean, 0) ?? 1;
            return neutralHistoricalPrior(targetClass, neutralMean);
        }

        const chronologicalIndex = beforeSeason
            ? filteredArchiveIndexBefore(archiveIndex, beforeSeason)
            : archiveIndex;
        const suppliedCalibration = ownValue(options, 'calibration');
        const calibration = beforeSeason || !suppliedCalibration
            ? buildClassCalibration(chronologicalIndex)
            : suppliedCalibration;
        const neutralMean = resolveTargetClassMean(
            calibration, targetClass, beforeSeason, explicitMean,
        );
        const history = playerId ? ownValue(chronologicalIndex.histories, playerId) : null;
        if (!history || !Array.isArray(history)) {
            return neutralHistoricalPrior(targetClass, neutralMean);
        }

        const usable = [];
        for (const record of history) {
            if (usable.length === 2) break;
            if (seasonalPerformance(record) === null) continue;
            const stable = stabilizeSeasonRecord(record, ownValue(calibration, 'classSeasonMeans'));
            if (stable === null) continue;
            const conversion = convertClassRating(
                stable, ownValue(record, 'leagueClass'), targetClass, calibration,
            );
            const converted = safeFinite(conversion.rating, 0);
            if (converted === null) continue;
            usable.push({
                season: record.season,
                sourceClass: record.leagueClass,
                targetClass,
                points: record.points,
                appearances: record.appearances,
                raw: record.points / record.appearances,
                stable,
                converted,
                classCalibrated: conversion.calibrated,
                conversionPath: conversion.path.slice(),
                weight: 0,
            });
        }
        if (!usable.length) return neutralHistoricalPrior(targetClass, neutralMean);
        const weights = usable.length === 2 ? [0.7, 0.3] : [1];
        let rating = 0;
        for (let indexPosition = 0; indexPosition < usable.length; indexPosition += 1) {
            usable[indexPosition].weight = weights[indexPosition];
            rating += usable[indexPosition].converted * weights[indexPosition];
        }
        const classCalibrated = usable.every((season) => season.classCalibrated);
        const solidTwoSeasons = usable.length === 2
            && classCalibrated
            && usable.every((season) => season.appearances >= PRIOR_APPEARANCES);
        return deepFreeze({
            rating,
            neutralMean,
            targetClass,
            seasons: usable,
            sourceSeasons: usable.map((season) => season.season),
            classCalibrated,
            confidence: classCalibrated ? (solidTwoSeasons ? 'medium' : 'provisional') : 'very-low',
            provenance: usable.length === 2 ? 'historical-two-season' : 'historical-one-season',
        });
    }

    function currentPlayerSources(value) {
        const inspection = inspectArray(value);
        const players = inspection.ok && inspection.isArray ? value : ownValue(value, 'players');
        const inspected = arrayDataValues(players);
        return inspected.ok ? inspected.values : [];
    }

    function parseCurrentPlayer(source) {
        if (!source || typeof source !== 'object') return null;
        const id = safeIdentifier(ownValue(source, 'id'));
        const name = displayPlayerName(ownValue(source, 'name'));
        const clubId = safeIdentifier(ownValue(source, 'v_nr'));
        const league = ownValue(source, 'league');
        const leagueClass = normalizeLeagueClass(league);
        const companyValue = ownValue(source, 'company');
        const company = typeof companyValue === 'string'
            ? companyValue.normalize('NFKC').replace(/\s+/gu, ' ').trim().normalize('NFC')
            : '';
        const roundsDescriptor = ownData(source, 'rounds');
        if (!id || !name || !clubId) return null;
        const roundsClone = roundsDescriptor ? cloneOwnData(roundsDescriptor.value) : {};
        if (roundsClone === INVALID_CLONE) return null;
        return {
            id,
            name,
            normalizedName: canonicalPlayerName(name),
            clubId,
            leagueClass,
            company,
            rounds: roundsClone,
            stats: roundStats(roundsClone),
        };
    }

    function weakestConfidence(values) {
        let weakest = 0;
        for (const value of values) {
            const index = CONFIDENCE_ORDER.indexOf(value);
            weakest = Math.max(weakest, index < 0 ? CONFIDENCE_ORDER.length - 1 : index);
        }
        return CONFIDENCE_ORDER[weakest] || 'very-low';
    }

    function rosterSort(left, right) {
        const leftEvidence = EVIDENCE_ORDER[left.evidence] ?? EVIDENCE_ORDER.neutral;
        const rightEvidence = EVIDENCE_ORDER[right.evidence] ?? EVIDENCE_ORDER.neutral;
        return leftEvidence - rightEvidence
            || right.adjustedRating - left.adjustedRating
            || left.id.localeCompare(right.id, 'en');
    }

    function explicitTeamMappingIsAmbiguous(options, teamId) {
        const teamMappings = ownValue(options, 'teamMappings');
        const mappedTeams = arrayDataValues(ownValue(teamMappings, teamId));
        if (mappedTeams.ok && mappedTeams.values.length > 1) return true;
        const clubs = arrayDataValues(ownValue(options, 'clubs'));
        if (!clubs.ok) return false;
        const matchingClubs = clubs.values.filter((club) => ownValue(club, 'number') === teamId);
        if (matchingClubs.length !== 1) return matchingClubs.length > 1;
        const teams = arrayDataValues(ownValue(matchingClubs[0], 'teams'));
        return teams.ok && teams.values.length > 1;
    }

    function buildTeamRoster(options) {
        const teamId = safeIdentifier(ownValue(options, 'teamId'));
        const targetLeague = ownValue(options, 'targetLeague');
        const targetClass = normalizeLeagueClass(targetLeague);
        const targetSeason = seasonFromLeague(targetLeague);
        const archiveData = ownValue(options, 'archiveData');
        const archiveIndex = buildArchiveIndex(archiveData && typeof archiveData === 'object' ? archiveData : {});
        const chronologicalIndex = targetSeason
            ? filteredArchiveIndexBefore(archiveIndex, targetSeason)
            : archiveIndex;
        const suppliedCalibration = ownValue(options, 'calibration');
        const calibration = targetSeason || !suppliedCalibration
            ? buildClassCalibration(chronologicalIndex)
            : suppliedCalibration;
        const classMean = resolveTargetClassMean(
            calibration, targetClass, targetSeason, ownValue(options, 'classMean'),
        );
        const diagnostics = {
            invalidTeam: !teamId || !targetClass,
            ambiguousTeam: false,
            ambiguousPlayerIds: [],
            excludedCurrentIds: [],
            historicalSeasons: [],
        };
        if (!teamId || !targetClass) {
            return deepFreeze({ players: [], targetClass, classMean, teamConfidence: 'very-low', diagnostics });
        }
        const explicitMappingAmbiguous = explicitTeamMappingIsAmbiguous(options, teamId);
        if (explicitMappingAmbiguous) diagnostics.ambiguousTeam = true;

        const parsedCurrent = currentPlayerSources(ownValue(options, 'currentPlayers'))
            .map(parseCurrentPlayer)
            .filter(Boolean);
        const affiliations = new Map();
        const namesById = new Map();
        for (const player of parsedCurrent) {
            if (!affiliations.has(player.id)) affiliations.set(player.id, new Set());
            affiliations.get(player.id).add(player.clubId);
            if (!namesById.has(player.id)) namesById.set(player.id, new Set());
            namesById.get(player.id).add(player.normalizedName);
        }
        const ambiguousIds = new Set();
        for (const [id, clubs] of affiliations) {
            if (clubs.size !== 1 || namesById.get(id).size !== 1) ambiguousIds.add(id);
        }
        diagnostics.ambiguousPlayerIds = Array.from(ambiguousIds).sort((a, b) => a.localeCompare(b, 'en'));

        const targetCurrent = parsedCurrent.filter((player) => (
            player.clubId === teamId && player.leagueClass === targetClass && !ambiguousIds.has(player.id)
        ));
        const teamNameValue = ownValue(options, 'teamName');
        const teamName = typeof teamNameValue === 'string'
            ? teamNameValue.normalize('NFKC').replace(/\s+/gu, ' ').trim().normalize('NFC')
            : '';
        const companies = new Set(targetCurrent.map((player) => player.company).filter(Boolean));
        if ((teamName && companies.size && !companies.has(teamName))
            || (!teamName && companies.size > 1)) {
            diagnostics.ambiguousTeam = true;
            return deepFreeze({ players: [], targetClass, classMean, teamConfidence: 'very-low', diagnostics });
        }
        const selectedCurrent = teamName
            ? targetCurrent.filter((player) => (
                player.company === teamName || (!explicitMappingAmbiguous && !player.company)
            ))
            : (explicitMappingAmbiguous ? [] : targetCurrent);

        const players = [];
        const addedIds = new Set();
        for (const current of selectedCurrent.sort((left, right) => left.id.localeCompare(right.id, 'en'))) {
            if (addedIds.has(current.id)) continue;
            const historicalRecord = ownValue(chronologicalIndex.histories, current.id);
            const historyNameMatches = !historicalRecord || historicalRecord.every(
                (record) => record.normalizedName === current.normalizedName,
            );
            const historicalPrior = historyNameMatches
                ? buildHistoricalPrior({
                    playerId: current.id,
                    targetClass,
                    archiveIndex: chronologicalIndex,
                    calibration,
                    classMean,
                })
                : neutralHistoricalPrior(targetClass, classMean);
            const hasHistory = historicalPrior.seasons.length > 0;
            const stats = current.stats;
            const rating = stats.appearances
                ? (stats.points + PRIOR_APPEARANCES * historicalPrior.rating)
                    / (stats.appearances + PRIOR_APPEARANCES)
                : historicalPrior.rating;
            const currentWeight = stats.appearances / (stats.appearances + PRIOR_APPEARANCES);
            let confidence = 'very-low';
            if (stats.appearances >= 8) confidence = 'high';
            else if (stats.appearances >= 1 && hasHistory) confidence = 'medium';
            else if (stats.appearances >= 1 || hasHistory) confidence = 'provisional';
            if (hasHistory && !historicalPrior.classCalibrated) confidence = 'very-low';
            players.push({
                id: current.id,
                name: current.name,
                rating,
                adjustedRating: rating,
                evidence: hasHistory ? 'current+history' : 'current',
                confidence,
                currentAppearances: stats.appearances,
                currentPoints: stats.points,
                currentWeight,
                historicalPrior,
                sourceSeasons: historicalPrior.sourceSeasons.slice(),
                rounds: cloneCanonicalRounds(current.rounds),
                rosterUnconfirmed: false,
            });
            addedIds.add(current.id);
        }

        const seasonSet = new Map();
        for (const playerId of ownNames(chronologicalIndex.histories)) {
            const history = ownValue(chronologicalIndex.histories, playerId) || [];
            for (const record of history) {
                if (!record.previewEligible) continue;
                seasonSet.set(record.season, record.seasonEnd);
            }
        }
        const historicalSeasons = Array.from(seasonSet, ([season, seasonEnd]) => ({ season, seasonEnd }))
            .sort((left, right) => right.seasonEnd - left.seasonEnd || right.season.localeCompare(left.season, 'en'))
            .slice(0, 2);
        diagnostics.historicalSeasons = historicalSeasons.map((item) => item.season);

        function addHistoricalSeason(season, evidence, limitToFour) {
            const candidates = [];
            for (const playerId of ownNames(chronologicalIndex.histories).sort((a, b) => a.localeCompare(b, 'en'))) {
                if (addedIds.has(playerId) || ambiguousIds.has(playerId)) continue;
                const affiliation = affiliations.get(playerId);
                if (affiliation && (!affiliation.has(teamId) || affiliation.size !== 1)) continue;
                const history = ownValue(chronologicalIndex.histories, playerId) || [];
                if (evidence === 'historical-fallback' && historicalSeasons[0]
                    && history.some((record) => record.season === historicalSeasons[0].season)) {
                    continue;
                }
                const sourceRecord = history.find((record) => (
                    record.season === season && record.previewEligible && record.v_nr === teamId
                ));
                if (!sourceRecord) continue;
                const historicalPrior = buildHistoricalPrior({
                    playerId, targetClass, archiveIndex: chronologicalIndex, calibration, classMean,
                });
                if (!historicalPrior.seasons.length) continue;
                let confidence = historicalPrior.confidence;
                if (evidence === 'historical-fallback') confidence = 'very-low';
                candidates.push({
                    id: playerId,
                    name: sourceRecord.name,
                    rating: historicalPrior.rating,
                    adjustedRating: historicalPrior.rating,
                    evidence,
                    confidence,
                    currentAppearances: 0,
                    currentPoints: 0,
                    currentWeight: 0,
                    historicalPrior,
                    sourceSeasons: historicalPrior.sourceSeasons.slice(),
                    rounds: cloneCanonicalRounds(sourceRecord.rounds),
                    rosterUnconfirmed: true,
                });
            }
            candidates.sort(rosterSort);
            for (const candidate of candidates) {
                if (limitToFour && players.length >= 4) break;
                players.push(candidate);
                addedIds.add(candidate.id);
            }
        }

        if (!diagnostics.ambiguousTeam && historicalSeasons[0]) {
            addHistoricalSeason(historicalSeasons[0].season, 'historical', false);
        }
        if (!diagnostics.ambiguousTeam && historicalSeasons[1] && players.length < 4) {
            addHistoricalSeason(historicalSeasons[1].season, 'historical-fallback', true);
        }
        players.sort(rosterSort);
        return deepFreeze({
            players,
            targetClass,
            classMean,
            teamConfidence: players.length
                ? weakestConfidence(players.slice(0, 4).map((player) => player.confidence))
                : 'very-low',
            diagnostics,
        });
    }

    function completeLineup(knownPlayers, options) {
        const requestedSize = parseCanonicalInteger(ownValue(options, 'size'));
        const size = requestedSize && requestedSize <= 32 ? requestedSize : 4;
        const manual = ownValue(options, 'manual') === true;
        const explicitMean = safeFinite(ownValue(options, 'classMean'), Number.MIN_VALUE);
        const classMean = explicitMean === null ? 1 : explicitMean;
        const inspected = arrayDataValues(knownPlayers);
        const known = [];
        if (inspected.ok) {
            for (const source of inspected.values) {
                const clone = cloneOwnData(source);
                if (clone === INVALID_CLONE || !clone || typeof clone !== 'object' || Array.isArray(clone)) continue;
                const adjusted = safeFinite(ownValue(clone, 'adjustedRating'), 0);
                const rating = adjusted === null ? safeFinite(ownValue(clone, 'rating'), 0) : adjusted;
                const id = ownValue(clone, 'id');
                const name = displayPlayerName(ownValue(clone, 'name'));
                if (rating === null || typeof id !== 'string' || !id || !name) continue;
                clone.name = name;
                clone.rating = rating;
                clone.adjustedRating = rating;
                const evidence = ownValue(clone, 'evidence');
                clone.evidence = Object.prototype.hasOwnProperty.call(EVIDENCE_ORDER, evidence)
                    ? evidence
                    : 'neutral';
                const confidence = ownValue(clone, 'confidence');
                clone.confidence = CONFIDENCE_ORDER.includes(confidence) ? confidence : 'very-low';
                known.push(clone);
            }
        }
        if (!manual) known.sort(rosterSort);
        const lineup = known.slice(0, size);
        let neutralCount = 0;
        while (lineup.length < size) {
            neutralCount += 1;
            lineup.push({
                id: `neutral-${neutralCount}`,
                name: 'Unbekannter Spieler (Klassenwert)',
                rating: classMean,
                adjustedRating: classMean,
                evidence: 'neutral',
                confidence: 'very-low',
                currentAppearances: 0,
                sourceSeasons: [],
                rosterUnconfirmed: true,
            });
        }
        const confidence = neutralCount >= 2
            ? 'very-low'
            : weakestConfidence(lineup.map((slot) => slot.confidence));
        defineData(lineup, 'teamConfidence', confidence);
        return deepFreeze(lineup);
    }

    function exactTeamLabel(value) {
        if (typeof value !== 'string') return null;
        const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim().normalize('NFC');
        return normalized && /\p{L}/u.test(normalized)
            ? normalized.toLocaleLowerCase('de-DE')
            : null;
    }

    function clubTeamMappings(clubs) {
        const mappings = new Map();
        const inspected = arrayDataValues(clubs);
        if (!inspected.ok) return mappings;
        function add(label, mapping) {
            const key = exactTeamLabel(label);
            if (!key) return;
            if (!mappings.has(key)) mappings.set(key, []);
            mappings.get(key).push(mapping);
        }
        for (const club of inspected.values) {
            const number = safeIdentifier(ownValue(club, 'number'));
            const clubName = ownValue(club, 'name');
            if (!number || !exactTeamLabel(clubName)) continue;
            const teams = arrayDataValues(ownValue(club, 'teams'));
            if (teams.ok && teams.values.length) {
                for (const team of teams.values) {
                    const teamName = typeof team === 'string' ? team : ownValue(team, 'name');
                    const teamIdValue = typeof team === 'string' ? team : ownValue(team, 'id');
                    const label = exactTeamLabel(teamName);
                    if (!label) continue;
                    add(teamName, {
                        clubId: number,
                        teamId: typeof teamIdValue === 'string' && teamIdValue ? teamIdValue : label,
                        teamLabel: label,
                        multiTeam: teams.values.length > 1,
                    });
                }
            } else {
                add(clubName, {
                    clubId: number,
                    teamId: number,
                    teamLabel: exactTeamLabel(clubName),
                    multiTeam: false,
                });
            }
        }
        return mappings;
    }

    function firstOwnValue(object, keys) {
        for (const key of keys) {
            const descriptor = ownData(object, key);
            if (descriptor) return descriptor.value;
        }
        return undefined;
    }

    function parseRoundNumber(value) {
        const integer = parseCanonicalInteger(value);
        if (integer !== null && integer > 0) return integer;
        if (typeof value !== 'string') return null;
        const normalized = value.normalize('NFKC').trim();
        const match = /^(?:Runde\s+)?([1-9][0-9]*)(?:\.\s*Spieltag|\b)/iu.exec(normalized);
        return match ? parseCanonicalInteger(match[1]) : null;
    }

    function parseMatchScore(row) {
        const result = firstOwnValue(row, ['result', 'score', 'ergebnis']);
        if (typeof result === 'string') {
            const match = /^\s*(0|[1-9][0-9]*)\s*:\s*(0|[1-9][0-9]*)\s*$/u.exec(result);
            if (match) {
                const homeScore = parseCanonicalInteger(match[1]);
                const awayScore = parseCanonicalInteger(match[2]);
                if (homeScore !== null && awayScore !== null) return { homeScore, awayScore };
            }
        }
        const homeScore = parseCanonicalInteger(firstOwnValue(row, ['homeScore', 'home_score']));
        const awayScore = parseCanonicalInteger(firstOwnValue(row, ['awayScore', 'away_score']));
        return homeScore === null || awayScore === null ? null : { homeScore, awayScore };
    }

    function normalizeObjectMatchRow(row, tableSeason, tableLeague) {
        if (!row || typeof row !== 'object') return null;
        const rowInspection = inspectArray(row);
        if (!rowInspection.ok || rowInspection.isArray) return null;
        const season = canonicalSeason(firstOwnValue(row, ['season']) || tableSeason);
        const league = firstOwnValue(row, ['league', 'class']) || tableLeague;
        const leagueClass = normalizeLeagueClass(league);
        const round = parseRoundNumber(firstOwnValue(row, ['round', 'roundNumber', 'spieltag', 'runde']));
        const home = firstOwnValue(row, ['home', 'homeTeam', 'heim']);
        const away = firstOwnValue(row, ['away', 'awayTeam', 'gast']);
        const score = parseMatchScore(row);
        if (!season || !leagueClass || !round || !exactTeamLabel(home) || !exactTeamLabel(away) || !score) {
            return null;
        }
        return { season, leagueClass, round, home, away, ...score };
    }

    function normalizedHeader(value) {
        return typeof value === 'string'
            ? value.normalize('NFKC').replace(/[.\s_\-/]+/gu, '').toLocaleLowerCase('de-DE')
            : '';
    }

    function objectRowsFromTable(table) {
        const rows = arrayDataValues(ownValue(table, 'rows'));
        if (!rows.ok || !rows.values.length) return [];
        const firstInspection = inspectArray(rows.values[0]);
        if (!firstInspection.ok) return [];
        if (!firstInspection.isArray) return rows.values;
        const headers = arrayDataValues(rows.values[0]);
        if (!headers.ok) return [];
        const aliases = {
            round: new Set(['rundeinfo', 'runde', 'spieltag']),
            home: new Set(['heim', 'home']),
            away: new Set(['gast', 'away']),
            result: new Set(['ergebnis', 'result']),
            homeScore: new Set(['heimpunkte', 'homescore']),
            awayScore: new Set(['gastpunkte', 'awayscore']),
        };
        const positions = {};
        headers.values.forEach((header, index) => {
            const normalized = normalizedHeader(header);
            for (const [field, candidates] of Object.entries(aliases)) {
                if (candidates.has(normalized) && positions[field] === undefined) positions[field] = index;
            }
        });
        if (positions.round === undefined || positions.home === undefined || positions.away === undefined
            || (positions.result === undefined
                && (positions.homeScore === undefined || positions.awayScore === undefined))) return [];
        const result = [];
        for (const row of rows.values.slice(1)) {
            const values = arrayDataValues(row);
            if (!values.ok) continue;
            const object = {};
            for (const [field, position] of Object.entries(positions)) {
                if (position < values.values.length) defineData(object, field, values.values[position]);
            }
            result.push(object);
        }
        return result;
    }

    function recordMatchesTeam(record, mapping) {
        if (record.v_nr !== mapping.clubId) return false;
        if (!mapping.multiTeam) return true;
        const recordTeam = firstOwnValue(record, ['team_id', 'team', 'company']);
        const normalized = exactTeamLabel(recordTeam);
        return normalized !== null
            && (normalized === mapping.teamLabel || recordTeam === mapping.teamId);
    }

    function roundParticipants(index, season, leagueClass, round, mapping) {
        const participants = [];
        for (const playerId of ownNames(index.histories).sort((a, b) => a.localeCompare(b, 'en'))) {
            const history = ownValue(index.histories, playerId) || [];
            const record = history.find((candidate) => (
                candidate.season === season
                && candidate.leagueClass === leagueClass
                && candidate.previewEligible
                && recordMatchesTeam(candidate, mapping)
            ));
            if (!record) continue;
            const rounds = ownValue(record, 'rounds');
            const value = parseCanonicalInteger(ownValue(rounds, `R${round}`));
            if (value !== null) participants.push({ playerId, record, value });
        }
        return participants;
    }

    function buildOutcomeTrainingExamples(options) {
        const tables = arrayDataValues(ownValue(options, 'archiveTables'));
        const archiveIndex = buildArchiveIndex(ownValue(options, 'archiveData'));
        const mappings = clubTeamMappings(ownValue(options, 'clubs'));
        const diagnostics = {
            rows: 0,
            accepted: 0,
            excluded: {
                malformed: 0,
                teamMapping: 0,
                participants: 0,
                duplicate: 0,
                chronology: 0,
            },
        };
        const examples = [];
        const seen = new Set();
        if (!tables.ok) {
            defineData(examples, 'diagnostics', diagnostics);
            return deepFreeze(examples);
        }
        for (const table of tables.values) {
            const tableSeason = ownValue(table, 'season');
            const tableLeague = ownValue(table, 'league');
            for (const row of objectRowsFromTable(table)) {
                diagnostics.rows += 1;
                const match = normalizeObjectMatchRow(row, tableSeason, tableLeague);
                if (!match) {
                    diagnostics.excluded.malformed += 1;
                    continue;
                }
                const homeMappings = mappings.get(exactTeamLabel(match.home)) || [];
                const awayMappings = mappings.get(exactTeamLabel(match.away)) || [];
                if (homeMappings.length !== 1 || awayMappings.length !== 1
                    || (homeMappings[0].clubId === awayMappings[0].clubId
                        && homeMappings[0].teamId === awayMappings[0].teamId)) {
                    diagnostics.excluded.teamMapping += 1;
                    continue;
                }
                const key = [
                    match.season, match.round, match.leagueClass,
                    `${homeMappings[0].clubId}:${homeMappings[0].teamId}`,
                    `${awayMappings[0].clubId}:${awayMappings[0].teamId}`,
                    match.homeScore, match.awayScore,
                ].join('|');
                if (seen.has(key)) {
                    diagnostics.excluded.duplicate += 1;
                    continue;
                }
                seen.add(key);
                const homePlayers = roundParticipants(
                    archiveIndex, match.season, match.leagueClass, match.round, homeMappings[0],
                );
                const awayPlayers = roundParticipants(
                    archiveIndex, match.season, match.leagueClass, match.round, awayMappings[0],
                );
                if (homePlayers.length !== 4 || awayPlayers.length !== 4) {
                    diagnostics.excluded.participants += 1;
                    continue;
                }
                const earlierIndex = filteredArchiveIndexBefore(archiveIndex, match.season);
                const earlierCalibration = buildClassCalibration(earlierIndex);
                const targetMean = resolveTargetClassMean(
                    earlierCalibration, match.leagueClass, match.season, undefined,
                );
                function scorePlayers(players) {
                    const priors = players.map((player) => buildHistoricalPrior({
                        playerId: player.playerId,
                        targetClass: match.leagueClass,
                        archiveIndex: earlierIndex,
                        calibration: earlierCalibration,
                        beforeSeason: match.season,
                        classMean: targetMean,
                    }));
                    const rating = priors.reduce((sum, prior) => sum + prior.rating, 0) / priors.length;
                    return { rating, priors };
                }
                const home = scorePlayers(homePlayers);
                const away = scorePlayers(awayPlayers);
                const sourceSeasons = Array.from(new Set([
                    ...home.priors.flatMap((prior) => prior.sourceSeasons),
                    ...away.priors.flatMap((prior) => prior.sourceSeasons),
                ])).sort().reverse();
                if (sourceSeasons.some((season) => season >= match.season)) {
                    diagnostics.excluded.chronology += 1;
                    continue;
                }
                examples.push({
                    key,
                    season: match.season,
                    round: match.round,
                    leagueClass: match.leagueClass,
                    homeTeamId: `${homeMappings[0].clubId}:${homeMappings[0].teamId}`,
                    awayTeamId: `${awayMappings[0].clubId}:${awayMappings[0].teamId}`,
                    homeRating: home.rating,
                    awayRating: away.rating,
                    outcome: match.homeScore > match.awayScore
                        ? 'home'
                        : (match.homeScore < match.awayScore ? 'away' : 'draw'),
                    sourceSeasons,
                    calibrationSeasons: sourceSeasons.slice(),
                });
                diagnostics.accepted += 1;
            }
        }
        examples.sort((left, right) => (
            left.season.localeCompare(right.season, 'en')
            || left.round - right.round
            || left.key.localeCompare(right.key, 'en')
        ));
        defineData(examples, 'diagnostics', diagnostics);
        return deepFreeze(examples);
    }

    function outcomeProbabilities(homeRating, awayRating, params) {
        const difference = (homeRating - awayRating) / params.scale + params.homeAdvantage;
        const rawHome = Math.exp(Math.max(-50, Math.min(50, difference)));
        const rawAway = Math.exp(Math.max(-50, Math.min(50, -difference)));
        const rawDraw = params.drawPeak * Math.exp(-params.drawDecay * Math.abs(difference));
        const total = rawHome + rawDraw + rawAway;
        return { home: rawHome / total, draw: rawDraw / total, away: rawAway / total };
    }

    function finalizeOutcomeModel(value) {
        const model = deepFreeze(value);
        OUTCOME_MODELS.add(model);
        return model;
    }

    function calibrateOutcomeModel(sourceExamples) {
        const inspected = arrayDataValues(sourceExamples);
        const diagnostics = {
            received: inspected.ok ? inspected.values.length : 0,
            usable: 0,
            excludedUnsafe: 0,
            excludedDuplicate: 0,
            outcomeCounts: { home: 0, draw: 0, away: 0 },
        };
        const examples = [];
        const seen = new Set();
        if (inspected.ok) {
            for (let indexPosition = 0; indexPosition < inspected.values.length; indexPosition += 1) {
                const source = inspected.values[indexPosition];
                const homeRating = safeRating(ownValue(source, 'homeRating'));
                const awayRating = safeRating(ownValue(source, 'awayRating'));
                const outcome = ownValue(source, 'outcome');
                const keyValue = ownValue(source, 'key');
                const key = typeof keyValue === 'string' && keyValue
                    ? keyValue
                    : `synthetic:${indexPosition}`;
                if (homeRating === null || awayRating === null
                    || !['home', 'draw', 'away'].includes(outcome)) {
                    diagnostics.excludedUnsafe += 1;
                    continue;
                }
                if (seen.has(key)) {
                    diagnostics.excludedDuplicate += 1;
                    continue;
                }
                seen.add(key);
                examples.push({ key, homeRating, awayRating, outcome });
                diagnostics.outcomeCounts[outcome] += 1;
            }
        }
        diagnostics.usable = examples.length;
        const sufficient = examples.length >= 40
            && Object.values(diagnostics.outcomeCounts).every((count) => count >= 5);
        if (!sufficient) {
            return finalizeOutcomeModel({
                kind: 'outcome-model-v1',
                calibrated: false,
                params: null,
                brier: null,
                parameterGrid: OUTCOME_PARAMETER_GRID,
                diagnostics,
            });
        }

        let best = null;
        for (const scale of OUTCOME_PARAMETER_GRID.scale) {
            for (const homeAdvantage of OUTCOME_PARAMETER_GRID.homeAdvantage) {
                for (const drawPeak of OUTCOME_PARAMETER_GRID.drawPeak) {
                    for (const drawDecay of OUTCOME_PARAMETER_GRID.drawDecay) {
                        const params = { scale, homeAdvantage, drawPeak, drawDecay };
                        let brier = 0;
                        for (const example of examples) {
                            const probabilities = outcomeProbabilities(
                                example.homeRating, example.awayRating, params,
                            );
                            brier += (probabilities.home - (example.outcome === 'home' ? 1 : 0)) ** 2;
                            brier += (probabilities.draw - (example.outcome === 'draw' ? 1 : 0)) ** 2;
                            brier += (probabilities.away - (example.outcome === 'away' ? 1 : 0)) ** 2;
                        }
                        brier /= examples.length;
                        if (!best || brier < best.brier - 1e-15) best = { params, brier };
                    }
                }
            }
        }
        return finalizeOutcomeModel({
            kind: 'outcome-model-v1',
            calibrated: true,
            params: best.params,
            brier: best.brier,
            parameterGrid: OUTCOME_PARAMETER_GRID,
            diagnostics,
        });
    }

    function lineupSummary(lineup) {
        const inspected = arrayDataValues(lineup);
        if (!inspected.ok || inspected.values.length !== 4) {
            return { valid: false, score: 0, confidence: 'very-low', uncertainty: 0.5, provenance: [] };
        }
        const ratings = [];
        const confidences = [];
        const provenance = [];
        let uncertainty = 0;
        const uncertaintyByConfidence = { high: 0.04, medium: 0.1, provisional: 0.2, 'very-low': 0.32 };
        for (const slot of inspected.values) {
            const adjusted = safeRating(ownValue(slot, 'adjustedRating'));
            const rating = adjusted === null ? safeRating(ownValue(slot, 'rating')) : adjusted;
            const confidenceValue = ownValue(slot, 'confidence');
            const confidence = CONFIDENCE_ORDER.includes(confidenceValue) ? confidenceValue : 'very-low';
            const evidenceValue = ownValue(slot, 'evidence');
            const evidence = Object.prototype.hasOwnProperty.call(EVIDENCE_ORDER, evidenceValue)
                ? evidenceValue
                : 'neutral';
            if (rating === null) {
                return { valid: false, score: 0, confidence: 'very-low', uncertainty: 0.5, provenance: [] };
            }
            ratings.push(rating);
            confidences.push(confidence);
            provenance.push(evidence);
            uncertainty += uncertaintyByConfidence[confidence]
                + (evidence === 'neutral' ? 0.18 : 0)
                + (ownValue(slot, 'rosterUnconfirmed') === true ? 0.04 : 0);
        }
        return {
            valid: true,
            score: ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length,
            confidence: weakestConfidence(confidences),
            uncertainty: uncertainty / ratings.length,
            provenance,
        };
    }

    function forecastMatch(homeLineup, awayLineup, options) {
        const home = lineupSummary(homeLineup);
        const away = lineupSummary(awayLineup);
        const outcomeModel = ownValue(options, 'outcomeModel');
        const relativeTotal = home.score + away.score;
        const relative = relativeTotal > 0
            ? { homeShare: home.score / relativeTotal, awayShare: away.score / relativeTotal }
            : { homeShare: 0.5, awayShare: 0.5 };
        const base = {
            mode: 'relative',
            homeScore: home.score,
            awayScore: away.score,
            relative,
            homeConfidence: home.confidence,
            awayConfidence: away.confidence,
            teamConfidence: weakestConfidence([home.confidence, away.confidence]),
            provenance: { home: home.provenance.slice(), away: away.provenance.slice() },
            uncertaintyText: 'Relative Aufstellungsstärke mit unsicherer Datenbasis',
        };
        if (!home.valid || !away.valid || !OUTCOME_MODELS.has(outcomeModel)
            || ownValue(outcomeModel, 'calibrated') !== true) return deepFreeze(base);
        const params = ownValue(outcomeModel, 'params');
        const safeParams = {
            scale: safeFinite(ownValue(params, 'scale'), Number.MIN_VALUE),
            homeAdvantage: safeFinite(ownValue(params, 'homeAdvantage'), 0),
            drawPeak: safeFinite(ownValue(params, 'drawPeak'), Number.MIN_VALUE),
            drawDecay: safeFinite(ownValue(params, 'drawDecay'), 0),
        };
        if (Object.values(safeParams).some((value) => value === null)) return deepFreeze(base);
        const probabilities = outcomeProbabilities(home.score, away.score, safeParams);
        const width = Math.min(0.45, 0.03 + (home.uncertainty + away.uncertainty) / 2);
        const low = {};
        const high = {};
        for (const outcome of ['home', 'draw', 'away']) {
            low[outcome] = Math.max(0, probabilities[outcome] - width);
            high[outcome] = Math.min(1, probabilities[outcome] + width);
        }
        return deepFreeze({
            mode: 'probability',
            home: probabilities.home,
            draw: probabilities.draw,
            away: probabilities.away,
            low,
            high,
            homeScore: home.score,
            awayScore: away.score,
            homeConfidence: home.confidence,
            awayConfidence: away.confidence,
            teamConfidence: weakestConfidence([home.confidence, away.confidence]),
            provenance: { home: home.provenance.slice(), away: away.provenance.slice() },
            calibration: {
                kind: ownValue(outcomeModel, 'kind'),
                brier: ownValue(outcomeModel, 'brier'),
                params: { ...safeParams },
            },
        });
    }

    return {
        CLASS_ORDER,
        MIN_TRANSITIONS,
        PRIOR_APPEARANCES,
        normalizeLeagueClass,
        roundStats,
        canonicalSeason,
        canonicalPlayerName,
        buildArchiveIndex,
        seasonalPerformance,
        buildClassSeasonMeans,
        stabilizeSeasonRecord,
        buildClassCalibration,
        convertClassRating,
        buildHistoricalPrior,
        buildTeamRoster,
        completeLineup,
        buildOutcomeTrainingExamples,
        calibrateOutcomeModel,
        forecastMatch,
    };
});
