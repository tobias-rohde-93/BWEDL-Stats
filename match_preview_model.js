(function (root, factory) {
    const api = Object.freeze(factory());
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.BwedlMatchPreviewModel = api;
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

        const visited = seen || new WeakMap();
        if (visited.has(value)) return INVALID_CLONE;
        const clone = Array.isArray(value) ? [] : {};
        visited.set(value, clone);
        for (const key of ownNames(value)) {
            if (Array.isArray(value) && key === 'length') continue;
            const descriptor = ownData(value, key);
            if (!descriptor || !descriptor.enumerable) continue;
            const child = cloneOwnData(descriptor.value, visited);
            if (child === INVALID_CLONE) continue;
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
        if (isSafeNonnegativeInteger(value)) return value;
        if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) return null;
        const numeric = Number(value);
        return Number.isSafeInteger(numeric) ? numeric : null;
    }

    function normalizeLeagueClass(value) {
        if (typeof value !== 'string') return null;
        const text = value.normalize('NFKC').toLocaleLowerCase('de-DE');
        const token = (word) => new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, 'u');
        if (/(?:mix|pokal|cup)/u.test(text)) return null;
        if (token('bezirksliga').test(text)) return 'Bezirksliga';
        const match = /(?<![\p{L}\p{N}])([abc])\s*[-\u2010-\u2015 ]?\s*klasse(?![\p{L}\p{N}])/u.exec(text);
        return match ? `${match[1].toUpperCase()}-Klasse` : null;
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

    function canonicalSeason(value) {
        if (typeof value !== 'string') return null;
        const match = /^(\d{2}|\d{4})\s*[/\-]\s*(\d{2}|\d{4})$/u.exec(value.trim());
        if (!match) return null;
        let start = Number(match[1]);
        let end = Number(match[2]);
        if (match[1].length === 2) start += 2000;
        if (match[2].length === 2) end = Math.floor(start / 100) * 100 + end;
        if (end !== start + 1) return null;
        return `${start}/${end}`;
    }

    function seasonStart(value) {
        const canonical = canonicalSeason(value);
        return canonical ? Number(canonical.slice(0, 4)) : null;
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
        if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
        const innerIdDescriptor = ownData(record, 'id');
        if (innerIdDescriptor
            && (typeof innerIdDescriptor.value !== 'string' || innerIdDescriptor.value !== playerId)) {
            return { identityConflict: true };
        }
        const seasonDescriptor = ownData(record, 'season');
        const nameDescriptor = ownData(record, 'name');
        const leagueDescriptor = ownData(record, 'league');
        const pointsDescriptor = ownData(record, 'points');
        if (!seasonDescriptor || !nameDescriptor || !leagueDescriptor || !pointsDescriptor) return null;

        const season = canonicalSeason(seasonDescriptor.value);
        const name = displayPlayerName(nameDescriptor.value);
        const league = typeof leagueDescriptor.value === 'string'
            ? leagueDescriptor.value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
            : '';
        if (!season || !name || !league || !isSafeNonnegativeInteger(pointsDescriptor.value)) return null;

        const clone = cloneOwnData(record);
        const result = clone === INVALID_CLONE || !clone || typeof clone !== 'object' ? {} : clone;
        result.id = playerId;
        result.season = season;
        result.seasonStart = Number(season.slice(0, 4));
        result.name = name;
        result.normalizedName = canonicalPlayerName(name);
        result.league = league;
        result.leagueClass = normalizeLeagueClass(league);
        result.points = pointsDescriptor.value;

        const clubDescriptor = ownData(record, 'v_nr');
        const validClub = Boolean(clubDescriptor
            && typeof clubDescriptor.value === 'string'
            && /^[0-9]+$/u.test(clubDescriptor.value));
        if (clubDescriptor && validClub) result.v_nr = clubDescriptor.value;

        const previewDescriptors = ['rounds', 'appearances', 'points_per_appearance']
            .map((key) => ownData(record, key));
        const presentPreviewFields = previewDescriptors.filter(Boolean).length;
        result.completeEvidence = false;
        result.previewEligible = false;
        if (presentPreviewFields === previewDescriptors.length && validClub) {
            const stats = validateRoundSequence(previewDescriptors[0].value);
            const appearances = previewDescriptors[1].value;
            const average = previewDescriptors[2].value;
            const expectedAverage = appearances ? result.points / appearances : 0;
            if (stats
                && isSafeNonnegativeInteger(appearances)
                && typeof average === 'number'
                && Number.isFinite(average)
                && average >= 0
                && stats.points === result.points
                && stats.appearances === appearances
                && Math.abs(average - expectedAverage) <= 1e-12) {
                result.rounds = cloneOwnData(previewDescriptors[0].value);
                result.appearances = appearances;
                result.points_per_appearance = average;
                result.completeEvidence = true;
                result.previewEligible = appearances > 0 && result.leagueClass !== null;
            }
        }
        return deepFreeze(result);
    }

    function arrayDataValues(value) {
        if (!Array.isArray(value)) return [];
        const entries = [];
        for (const key of ownNames(value)) {
            if (!/^(?:0|[1-9][0-9]*)$/u.test(key)) continue;
            const index = Number(key);
            const descriptor = ownData(value, key);
            if (descriptor && descriptor.enumerable && Number.isSafeInteger(index)) {
                entries.push({ index, value: descriptor.value });
            }
        }
        entries.sort((left, right) => left.index - right.index);
        return entries.map((entry) => entry.value);
    }

    function buildArchiveIndex(archive) {
        const histories = {};
        const unusable = new Set();
        if (!archive || typeof archive !== 'object' || Array.isArray(archive)) {
            return deepFreeze({ kind: 'archive-index-v1', histories, unusablePlayerIds: [] });
        }

        const candidates = [];
        for (const playerId of ownNames(archive)) {
            if (!/^[0-9]+$/u.test(playerId)) continue;
            const descriptor = ownData(archive, playerId);
            if (!descriptor || !descriptor.enumerable || !Array.isArray(descriptor.value)) continue;
            const records = [];
            let identityConflict = false;
            for (const sourceRecord of arrayDataValues(descriptor.value)) {
                const parsed = normalizedRecord(sourceRecord, playerId);
                if (parsed && parsed.identityConflict) {
                    identityConflict = true;
                    break;
                }
                if (parsed) records.push(parsed);
            }
            if (identityConflict) {
                unusable.add(playerId);
                continue;
            }
            if (!records.length) continue;
            const seasons = new Set();
            const names = new Set();
            for (const item of records) {
                if (seasons.has(item.season)) identityConflict = true;
                seasons.add(item.season);
                names.add(item.normalizedName);
            }
            if (identityConflict || names.size !== 1) {
                unusable.add(playerId);
                continue;
            }
            records.sort((left, right) => right.seasonStart - left.seasonStart);
            candidates.push({ playerId, records: Object.freeze(records.slice()) });
        }

        candidates.sort((left, right) => left.playerId.localeCompare(right.playerId, 'en'));
        for (const candidate of candidates) defineData(histories, candidate.playerId, candidate.records);
        const unusablePlayerIds = Array.from(unusable).sort((left, right) => left.localeCompare(right, 'en'));
        return deepFreeze({ kind: 'archive-index-v1', histories, unusablePlayerIds });
    }

    function isArchiveIndex(value) {
        const kind = ownData(value, 'kind');
        const histories = ownData(value, 'histories');
        return Boolean(kind && kind.value === 'archive-index-v1'
            && histories && histories.value && typeof histories.value === 'object');
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
                if (!totals[key]) totals[key] = { points: 0, appearances: 0, playerRecords: 0 };
                const nextPoints = totals[key].points + record.points;
                const nextAppearances = totals[key].appearances + record.appearances;
                if (!Number.isSafeInteger(nextPoints) || !Number.isSafeInteger(nextAppearances)) continue;
                totals[key].points = nextPoints;
                totals[key].appearances = nextAppearances;
                totals[key].playerRecords += 1;
            }
        }
        const means = {};
        for (const key of Object.keys(totals).sort()) {
            const total = totals[key];
            defineData(means, key, {
                points: total.points,
                appearances: total.appearances,
                playerRecords: total.playerRecords,
                mean: total.points / total.appearances,
            });
        }
        return deepFreeze(means);
    }

    function stabilizeSeasonRecord(record, classSeasonMeans) {
        const raw = seasonalPerformance(record);
        if (raw === null || !classSeasonMeans || typeof classSeasonMeans !== 'object') return null;
        const meanDescriptor = ownData(classSeasonMeans, `${record.leagueClass}|${record.season}`);
        if (!meanDescriptor || !meanDescriptor.value || typeof meanDescriptor.value.mean !== 'number'
            || !Number.isFinite(meanDescriptor.value.mean)) return null;
        const stable = (record.points + PRIOR_APPEARANCES * meanDescriptor.value.mean)
            / (record.appearances + PRIOR_APPEARANCES);
        return Number.isFinite(stable) ? stable : null;
    }

    function weightedMedian(observations) {
        if (!observations.length) return null;
        const sorted = observations.slice().sort((left, right) => (
            left.value - right.value
            || left.playerId.localeCompare(right.playerId, 'en')
            || left.olderSeason.localeCompare(right.olderSeason, 'en')
        ));
        const totalWeight = sorted.reduce((sum, observation) => sum + observation.weight, 0);
        const halfway = totalWeight / 2;
        let cumulative = 0;
        for (const observation of sorted) {
            cumulative += observation.weight;
            if (cumulative >= halfway) {
                return {
                    value: Object.is(observation.value, -0) ? 0 : observation.value,
                    totalWeight,
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
            invalidStabilization: 0,
        };
        for (let indexPosition = 0; indexPosition < CLASS_ORDER.length - 1; indexPosition += 1) {
            observationsByEdge[`${CLASS_ORDER[indexPosition]}>${CLASS_ORDER[indexPosition + 1]}`] = [];
        }

        for (const playerId of Object.keys(index.histories)) {
            const history = index.histories[playerId];
            for (let position = 0; position < history.length - 1; position += 1) {
                const newer = history[position];
                const older = history[position + 1];
                if (newer.seasonStart !== older.seasonStart + 1) {
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
                const newerStable = stabilizeSeasonRecord(newer, classSeasonMeans);
                const olderStable = stabilizeSeasonRecord(older, classSeasonMeans);
                if (newerStable === null || olderStable === null) {
                    excluded.invalidStabilization += 1;
                    continue;
                }
                const highIndex = Math.min(newerClassIndex, olderClassIndex);
                const edge = `${CLASS_ORDER[highIndex]}>${CLASS_ORDER[highIndex + 1]}`;
                const highStable = newerClassIndex === highIndex ? newerStable : olderStable;
                const lowStable = newerClassIndex === highIndex ? olderStable : newerStable;
                observationsByEdge[edge].push({
                    playerId,
                    olderSeason: older.season,
                    newerSeason: newer.season,
                    value: lowStable - highStable,
                    weight: Math.min(older.appearances, newer.appearances),
                });
            }
        }

        const transitions = {};
        const edgeDiagnostics = {};
        for (const edge of Object.keys(observationsByEdge)) {
            const observations = observationsByEdge[edge];
            const median = weightedMedian(observations);
            const values = observations.map((observation) => observation.value).sort((a, b) => a - b);
            const diagnostic = {
                count: observations.length,
                published: observations.length >= MIN_TRANSITIONS,
                totalWeight: median ? median.totalWeight : 0,
                medianRule: 'lower-weighted',
                observationRange: values.length ? [values[0], values[values.length - 1]] : [],
                observations: (median ? median.sorted : []).map((observation) => ({
                    playerId: observation.playerId,
                    olderSeason: observation.olderSeason,
                    newerSeason: observation.newerSeason,
                    value: observation.value,
                    weight: observation.weight,
                })),
            };
            defineData(edgeDiagnostics, edge, diagnostic);
            if (diagnostic.published && median && Number.isFinite(median.value)) {
                defineData(transitions, edge, {
                    count: observations.length,
                    offset: median.value,
                    totalWeight: median.totalWeight,
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
