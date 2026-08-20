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
    };
});
