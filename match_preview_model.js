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
    const MAX_MODEL_RATING = 1000;
    const NEUTRAL_FALLBACK_RATING = 1;
    const INVALID_CLONE = Object.freeze({ invalid: true });
    const ARCHIVE_INDEXES = new WeakSet();
    const OUTCOME_EXAMPLE_SETS = new WeakSet();
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
    const ARCHIVE_ADMIN_MARKERS = Object.freeze(new Set(['x', 'vw', 'd', 'kp', '*']));
    const ARCHIVE_AFFILIATION_MARKERS = Object.freeze(new Set(['vw']));
    const V2_CONTAINER_FIELDS = Object.freeze(new Set([
        'season', 'league', 'rank', 'name', 'points', 'primary_segment_id',
        'segments', 'v_nr', 'rounds', 'appearances', 'points_per_appearance',
        'identity_ambiguous', 'round_overlap_ambiguous',
    ]));
    const V2_SEGMENT_FIELDS = Object.freeze(new Set([
        'segment_id', 'league', 'rank', 'name', 'points', 'v_nr', 'affiliation_marker',
        'rounds', 'appearances', 'points_per_appearance',
    ]));

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

    function validateRoundSequence(rounds, strictArchiveNumbers) {
        if (!rounds || typeof rounds !== 'object') return null;
        const arrayInspection = inspectArray(rounds);
        const namesInspection = inspectNames(rounds);
        if (!arrayInspection.ok || arrayInspection.isArray || !namesInspection.ok) return null;
        const numbers = [];
        for (const key of namesInspection.names) {
            const inspection = inspectOwn(rounds, key);
            if (!inspection.ok || !inspection.isData) return null;
            const descriptor = inspection.descriptor;
            if (!descriptor.enumerable) continue;
            const match = /^R([1-9][0-9]*)$/u.exec(key);
            if (!match) return null;
            const number = Number(match[1]);
            if (!Number.isSafeInteger(number)) return null;
            const value = descriptor.value;
            const numeric = strictArchiveNumbers
                ? (isSafeNonnegativeInteger(value) ? (Object.is(value, -0) ? 0 : value) : null)
                : parseCanonicalInteger(value);
            const normalizedMarker = typeof value === 'string'
                ? value.normalize('NFKC').trim()
                : null;
            if (strictArchiveNumbers && normalizedMarker !== null && normalizedMarker !== value) {
                return null;
            }
            const marker = normalizedMarker === null
                ? null
                : normalizedMarker.toLocaleLowerCase('de-DE');
            if (numeric === null && marker !== '' && !ARCHIVE_ADMIN_MARKERS.has(marker)) {
                return null;
            }
            numbers.push(number);
        }
        if (!numbers.length) return null;
        numbers.sort((left, right) => left - right);
        if (numbers.some((number, index) => number !== index + 1)) return null;
        return roundStats(rounds);
    }

    function normalizeArchiveText(value) {
        return typeof value === 'string'
            ? value.normalize('NFKC').replace(/\s+/gu, ' ').trim().normalize('NFC')
            : '';
    }

    function normalizeArchiveSegment(source, playerId, seasonIdentity, virtual) {
        if (!source || typeof source !== 'object') return null;
        const arrayInspection = inspectArray(source);
        const namesInspection = inspectNames(source);
        if (!arrayInspection.ok || arrayInspection.isArray || !namesInspection.ok) return null;
        if (!virtual && namesInspection.names.some((key) => !V2_SEGMENT_FIELDS.has(key))) return null;
        for (const key of namesInspection.names) {
            const inspection = inspectOwn(source, key);
            if (!inspection.ok || !inspection.isData) return null;
        }
        const clone = cloneOwnData(source);
        if (clone === INVALID_CLONE || !clone || typeof clone !== 'object') return null;
        const segmentId = virtual ? `virtual:${playerId}:${seasonIdentity.season}` : ownValue(clone, 'segment_id');
        if (!virtual && (typeof segmentId !== 'string'
            || !/^sha256:[0-9a-f]{64}$/u.test(segmentId))) return null;
        const league = normalizeArchiveText(ownValue(clone, 'league'));
        const leagueClass = normalizeLeagueClass(league);
        const name = displayPlayerName(ownValue(clone, 'name'));
        const rankValue = ownValue(clone, 'rank');
        const rank = virtual && rankValue === undefined ? 0 : rankValue;
        const pointsValue = ownValue(clone, 'points');
        const points = Object.is(pointsValue, -0) ? 0 : pointsValue;
        if (!league || !name || !isSafeNonnegativeInteger(rank)
            || !isSafeNonnegativeInteger(points)) return null;
        const clubInspection = inspectOwn(clone, 'v_nr');
        const clubId = clubInspection.exists && clubInspection.isData
            ? safeIdentifier(clubInspection.descriptor.value)
            : null;
        if (clubInspection.exists && !clubId) return null;
        const affiliationInspection = inspectOwn(clone, 'affiliation_marker');
        if (!affiliationInspection.ok || (affiliationInspection.exists
            && (!affiliationInspection.isData || virtual))) return null;
        let affiliationMarker = null;
        if (affiliationInspection.exists) {
            const sourceMarker = affiliationInspection.descriptor.value;
            if (typeof sourceMarker !== 'string'
                || sourceMarker !== sourceMarker.normalize('NFKC').trim()
                || !sourceMarker
                || !ARCHIVE_AFFILIATION_MARKERS.has(
                    sourceMarker.toLocaleLowerCase('de-DE'),
                )) return null;
            affiliationMarker = sourceMarker;
        }
        if (clubId && affiliationMarker) return null;

        const result = clone;
        result.segment_id = segmentId;
        result.virtual = Boolean(virtual);
        result.league = league;
        result.leagueClass = leagueClass;
        result.name = name;
        result.normalizedName = canonicalPlayerName(name);
        result.rank = rank;
        result.points = points;
        if (clubId) result.v_nr = clubId;
        if (affiliationMarker) result.affiliation_marker = affiliationMarker;
        result.completeEvidence = false;
        result.previewEligible = false;
        const preview = ['rounds', 'appearances', 'points_per_appearance']
            .map((key) => inspectOwn(clone, key));
        if (preview.some((item) => !item.ok || (item.exists && !item.isData))) return null;
        const presentPreviewFields = preview.filter((item) => item.exists).length;
        if (presentPreviewFields !== 0 && presentPreviewFields !== preview.length) return null;
        if (presentPreviewFields === preview.length) {
            if (!clubId && !affiliationMarker) return null;
            const stats = validateRoundSequence(preview[0].descriptor.value, !virtual);
            const appearances = Object.is(preview[1].descriptor.value, -0)
                ? 0 : preview[1].descriptor.value;
            const average = Object.is(preview[2].descriptor.value, -0)
                ? 0 : preview[2].descriptor.value;
            const expectedAverage = appearances ? points / appearances : 0;
            if (!stats || !isSafeNonnegativeInteger(appearances)
                || typeof average !== 'number' || !Number.isFinite(average) || average < 0
                || stats.points !== points || stats.appearances !== appearances
                || Math.abs(average - expectedAverage) > 1e-12) return null;
            result.rounds = cloneCanonicalRounds(preview[0].descriptor.value);
            result.appearances = appearances;
            result.points_per_appearance = average;
            result.completeEvidence = true;
            result.previewEligible = appearances > 0 && leagueClass !== null;
        }
        return deepFreeze(result);
    }

    function segmentRoundOverlapAmbiguous(segments) {
        const observations = new Map();
        for (const segment of segments) {
            const clubId = ownValue(segment, 'v_nr') || '';
            const rounds = ownValue(segment, 'rounds');
            if (!rounds || !segment.leagueClass) continue;
            for (const key of ownNames(rounds)) {
                const descriptor = ownData(rounds, key);
                const value = descriptor ? parseCanonicalInteger(descriptor.value) : null;
                if (value === null) continue;
                const identity = `${segment.leagueClass}|${clubId}|${key}`;
                if (!observations.has(identity)) observations.set(identity, new Set());
                observations.get(identity).add(value);
            }
        }
        return Array.from(observations.values()).some((values) => values.size > 1);
    }

    function greatestNumericRound(segment) {
        let latest = -1;
        const rounds = ownValue(segment, 'rounds');
        for (const key of ownNames(rounds)) {
            const match = /^R([1-9][0-9]*)$/u.exec(key);
            const descriptor = ownData(rounds, key);
            if (match && descriptor && parseCanonicalInteger(descriptor.value) !== null) {
                latest = Math.max(latest, Number(match[1]));
            }
        }
        return latest;
    }

    function compareCanonicalSegments(left, right) {
        const leftClass = CLASS_ORDER.indexOf(left.leagueClass);
        const rightClass = CLASS_ORDER.indexOf(right.leagueClass);
        const leftClub = ownValue(left, 'v_nr');
        const rightClub = ownValue(right, 'v_nr');
        return (leftClass < 0 ? CLASS_ORDER.length : leftClass)
            - (rightClass < 0 ? CLASS_ORDER.length : rightClass)
            || left.league.toLocaleLowerCase('de-DE').localeCompare(
                right.league.toLocaleLowerCase('de-DE'), 'de-DE', { sensitivity: 'base' },
            )
            || Number(!leftClub) - Number(!rightClub)
            || String(leftClub || '').localeCompare(String(rightClub || ''), 'en')
            || left.rank - right.rank
            || left.segment_id.localeCompare(right.segment_id, 'en');
    }

    function sameRoundProjection(left, right) {
        const leftNames = ownNames(left).filter((key) => /^R[1-9][0-9]*$/u.test(key)).sort();
        const rightNames = ownNames(right).filter((key) => /^R[1-9][0-9]*$/u.test(key)).sort();
        if (leftNames.length !== ownNames(left).length
            || rightNames.length !== ownNames(right).length
            || leftNames.length !== rightNames.length) return false;
        return leftNames.every((key, index) => {
            const leftDescriptor = ownData(left, key);
            const rightDescriptor = ownData(right, rightNames[index]);
            return key === rightNames[index] && leftDescriptor && rightDescriptor
                && Object.is(leftDescriptor.value, rightDescriptor.value);
        });
    }

    function validFlatSegmentProjection(container, segments) {
        const fields = ['v_nr', 'rounds', 'appearances', 'points_per_appearance'];
        if (segments.length !== 1) {
            return fields.every((field) => !inspectOwn(container, field).exists);
        }
        const segment = segments[0];
        return fields.every((field) => {
            const containerField = inspectOwn(container, field);
            const segmentField = inspectOwn(segment, field);
            if (!containerField.ok || !segmentField.ok
                || containerField.exists !== segmentField.exists
                || (containerField.exists && (!containerField.isData || !segmentField.isData))) return false;
            if (!containerField.exists) return true;
            return field === 'rounds'
                ? sameRoundProjection(containerField.descriptor.value, segmentField.descriptor.value)
                : Object.is(containerField.descriptor.value, segmentField.descriptor.value);
        });
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

        const namesInspection = inspectNames(record);
        if (!namesInspection.ok) return { identityConflict: true };
        const v2Keys = new Set([
            'segments', 'primary_segment_id', 'identity_ambiguous', 'round_overlap_ambiguous',
        ]);
        const isV2 = namesInspection.names.some((key) => v2Keys.has(key));
        let segments = [];
        let result;
        if (isV2) {
            if (namesInspection.names.some((key) => !V2_CONTAINER_FIELDS.has(key))) {
                return { identity, record: null, isV2: true };
            }
            for (const key of namesInspection.names) {
                const inspection = inspectOwn(record, key);
                if (!inspection.ok || !inspection.isData) return { identity, record: null, isV2: true };
            }
            const clone = cloneOwnData(record);
            const segmentValues = arrayDataValues(ownValue(record, 'segments'));
            if (clone === INVALID_CLONE || !segmentValues.ok || !segmentValues.values.length) {
                return { identity, record: null, isV2: true };
            }
            const segmentIds = new Set();
            for (const sourceSegment of segmentValues.values) {
                const normalized = normalizeArchiveSegment(sourceSegment, playerId, identity, false);
                if (!normalized || segmentIds.has(normalized.segment_id)) {
                    return { identity, record: null, isV2: true };
                }
                segmentIds.add(normalized.segment_id);
                segments.push(normalized);
            }
            const primaryId = ownValue(clone, 'primary_segment_id');
            const primary = segments.find((segment) => segment.segment_id === primaryId);
            const expectedPrimary = segments.slice().sort((left, right) => (
                greatestNumericRound(right) - greatestNumericRound(left)
                || (right.appearances || 0) - (left.appearances || 0)
                || left.segment_id.localeCompare(right.segment_id, 'en')
            ))[0];
            const points = ownValue(clone, 'points');
            const rank = ownValue(clone, 'rank');
            let totalPoints = 0;
            for (const segment of segments) {
                totalPoints += segment.points;
                if (!Number.isSafeInteger(totalPoints)) return { identity, record: null, isV2: true };
            }
            const identityAmbiguous = new Set(
                segments.map((segment) => segment.normalizedName),
            ).size !== 1;
            const overlapAmbiguous = segmentRoundOverlapAmbiguous(segments);
            const identityFlag = inspectOwn(clone, 'identity_ambiguous');
            const overlapFlag = inspectOwn(clone, 'round_overlap_ambiguous');
            const validIdentityFlag = !identityFlag.exists
                ? !identityAmbiguous
                : identityFlag.isData && identityFlag.descriptor.value === true && identityAmbiguous;
            const validOverlapFlag = !overlapFlag.exists
                ? !overlapAmbiguous
                : overlapFlag.isData && overlapFlag.descriptor.value === true && overlapAmbiguous;
            const canonicalSegments = segments.slice().sort(compareCanonicalSegments);
            const canonicalOrder = canonicalSegments.every(
                (segment, index) => segment === segments[index],
            );
            if (!primary || primary !== expectedPrimary || !canonicalOrder
                || !isSafeNonnegativeInteger(points) || points !== totalPoints
                || !isSafeNonnegativeInteger(rank)
                || rank !== Math.min(...segments.map((segment) => segment.rank))
                || normalizeArchiveText(ownValue(clone, 'league')) !== primary.league
                || displayPlayerName(ownValue(clone, 'name')) !== primary.name
                || !validIdentityFlag || !validOverlapFlag
                || !validFlatSegmentProjection(clone, segments)) {
                return { identity, record: null, isV2: true };
            }
            result = clone;
            result.identityAmbiguous = identityAmbiguous;
            result.roundOverlapAmbiguous = overlapAmbiguous;
            result.archiveSchema = 'v2';
        } else {
            const clone = cloneOwnData(record);
            if (clone === INVALID_CLONE || !clone || typeof clone !== 'object') {
                return { identityConflict: true };
            }
            const segment = normalizeArchiveSegment(clone, playerId, identity, true);
            if (!segment) return { identity, record: null };
            segments = [segment];
            result = clone;
            result.identityAmbiguous = false;
            result.roundOverlapAmbiguous = false;
            result.archiveSchema = 'v1';
        }
        result.id = playerId;
        result.season = identity.season;
        result.seasonStart = identity.seasonStart;
        result.seasonEnd = identity.seasonEnd;
        result.name = identity.name;
        result.normalizedName = identity.normalizedName;
        result.segments = segments.slice();
        if (!isV2) {
            const segment = segments[0];
            result.league = segment.league;
            result.leagueClass = segment.leagueClass;
            result.points = segment.points;
            if (segment.v_nr) result.v_nr = segment.v_nr;
            if (segment.completeEvidence) {
                result.rounds = cloneCanonicalRounds(segment.rounds);
                result.appearances = segment.appearances;
                result.points_per_appearance = segment.points_per_appearance;
            }
        }
        const eligibleClasses = new Set(
            segments.filter((segment) => segment.previewEligible)
                .map((segment) => segment.leagueClass),
        );
        result.completeEvidence = segments.every((segment) => segment.completeEvidence);
        result.previewEligible = !result.identityAmbiguous && !result.roundOverlapAmbiguous
            && eligibleClasses.size === 1
            && segments.some((segment) => segment.previewEligible);
        if (!isV2 && eligibleClasses.size === 1) {
            result.leagueClass = Array.from(eligibleClasses)[0];
            const eligible = segments.filter((segment) => segment.previewEligible);
            result.points = eligible.reduce((sum, segment) => sum + segment.points, 0);
            result.appearances = eligible.reduce((sum, segment) => sum + segment.appearances, 0);
        }
        return { identity, record: deepFreeze(result), isV2 };
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
            let hasV2 = false;
            for (const sourceRecord of historyValues.values) {
                const parsed = normalizedRecord(sourceRecord, playerId);
                if (parsed.identityConflict) {
                    identityConflict = true;
                    break;
                }
                if (parsed.isV2 === true && !parsed.record) {
                    identityConflict = true;
                    break;
                }
                hasV2 = hasV2 || parsed.isV2 === true;
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
            if (identityConflict || (!hasV2 && names.size !== 1)) {
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
        const groups = seasonClassGroups(record);
        if (groups.length !== 1) return null;
        return groups[0].points / groups[0].appearances;
    }

    function seasonClassGroups(record) {
        if (!record || typeof record !== 'object'
            || ownValue(record, 'identityAmbiguous') === true
            || ownValue(record, 'roundOverlapAmbiguous') === true) return [];
        const segments = arrayDataValues(ownValue(record, 'segments'));
        if (!segments.ok) return [];
        const grouped = new Map();
        for (const segment of segments.values) {
            if (ownValue(segment, 'previewEligible') !== true) continue;
            const leagueClass = normalizeLeagueClass(ownValue(segment, 'leagueClass'));
            const points = ownValue(segment, 'points');
            const appearances = ownValue(segment, 'appearances');
            if (!leagueClass || !isSafeNonnegativeInteger(points)
                || !isSafeNonnegativeInteger(appearances) || appearances === 0) continue;
            if (!grouped.has(leagueClass)) {
                grouped.set(leagueClass, { leagueClass, points: 0, appearances: 0, segments: 0 });
            }
            const group = grouped.get(leagueClass);
            group.points += points;
            group.appearances += appearances;
            group.segments += 1;
            if (!Number.isSafeInteger(group.points) || !Number.isSafeInteger(group.appearances)) {
                grouped.delete(leagueClass);
            }
        }
        return Array.from(grouped.values())
            .sort((left, right) => CLASS_ORDER.indexOf(left.leagueClass) - CLASS_ORDER.indexOf(right.leagueClass))
            .map((group) => deepFreeze(group));
    }

    function observedSeasonClasses(record) {
        const segments = arrayDataValues(ownValue(record, 'segments'));
        if (!segments.ok) return [];
        return Array.from(new Set(segments.values
            .map((segment) => normalizeLeagueClass(ownValue(segment, 'leagueClass')))
            .filter(Boolean)))
            .sort((left, right) => CLASS_ORDER.indexOf(left) - CLASS_ORDER.indexOf(right));
    }

    function buildClassSeasonMeans(source) {
        const index = asArchiveIndex(source);
        const totals = {};
        for (const playerId of Object.keys(index.histories)) {
            for (const record of index.histories[playerId]) {
                for (const group of seasonClassGroups(record)) {
                    const key = `${group.leagueClass}|${record.season}`;
                    if (!totals[key]) totals[key] = { points: 0n, appearances: 0n, playerRecords: 0 };
                    totals[key].points += BigInt(group.points);
                    totals[key].appearances += BigInt(group.appearances);
                    totals[key].playerRecords += 1;
                }
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
        const groups = seasonClassGroups(record);
        if (groups.length !== 1 || !classSeasonMeans || typeof classSeasonMeans !== 'object') return null;
        const group = groups[0];
        const season = ownData(record, 'season');
        if (!season) return null;
        const meanDescriptor = ownData(classSeasonMeans, `${group.leagueClass}|${season.value}`);
        if (!meanDescriptor || !meanDescriptor.value || typeof meanDescriptor.value !== 'object') return null;
        const mean = ownData(meanDescriptor.value, 'mean');
        if (!mean || typeof mean.value !== 'number' || !Number.isFinite(mean.value)) return null;
        const stable = (group.points + PRIOR_APPEARANCES * mean.value)
            / (group.appearances + PRIOR_APPEARANCES);
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
            multiClass: 0,
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
                if (observedSeasonClasses(newer).length > 1
                    || observedSeasonClasses(older).length > 1) {
                    excluded.multiClass += 1;
                    continue;
                }
                const newerGroups = seasonClassGroups(newer);
                const olderGroups = seasonClassGroups(older);
                if (newerGroups.length !== 1 || olderGroups.length !== 1) {
                    excluded.incompleteEvidence += 1;
                    continue;
                }
                const newerGroup = newerGroups[0];
                const olderGroup = olderGroups[0];
                const newerClassIndex = CLASS_ORDER.indexOf(newerGroup.leagueClass);
                const olderClassIndex = CLASS_ORDER.indexOf(olderGroup.leagueClass);
                if (newerClassIndex === olderClassIndex) {
                    excluded.sameClass += 1;
                    continue;
                }
                if (newerClassIndex < 0 || olderClassIndex < 0
                    || Math.abs(newerClassIndex - olderClassIndex) !== 1) {
                    excluded.nonAdjacentOrUnknownClass += 1;
                    continue;
                }
                if (newerGroup.appearances < 4 || olderGroup.appearances < 4) {
                    excluded.insufficientAppearances += 1;
                    continue;
                }
                const newerRaw = newerGroup.points / newerGroup.appearances;
                const olderRaw = olderGroup.points / olderGroup.appearances;
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
                    rawWeight: Math.min(olderGroup.appearances, newerGroup.appearances),
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

    function safePositiveModelRating(value) {
        return typeof value === 'number'
            && Number.isFinite(value)
            && value > 0
            && value <= MAX_MODEL_RATING
            ? value
            : null;
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
        const histories = {};
        for (const playerId of ownNames(index.histories).sort((a, b) => a.localeCompare(b, 'en'))) {
            const historyDescriptor = ownData(index.histories, playerId);
            if (!historyDescriptor) continue;
            const records = historyDescriptor.value.filter(
                (record) => record.seasonEnd <= parsedBefore.startYear,
            );
            if (records.length) defineData(histories, playerId, Object.freeze(records.slice()));
        }
        return finalizeArchiveIndex({
            kind: 'archive-index-v2',
            histories,
            unusablePlayerIds: index.unusablePlayerIds.slice(),
            diagnostics: { ...index.diagnostics, filteredBeforeSeason: parsedBefore.key },
        });
    }

    function resolveTargetClassMean(calibration, targetClass, beforeSeason, explicitMean) {
        const supplied = safePositiveModelRating(explicitMean);
        if (supplied !== null) return { mean: supplied, available: true, source: 'explicit' };
        const normalizedClass = normalizeLeagueClass(targetClass);
        const means = ownValue(calibration, 'classSeasonMeans');
        if (!normalizedClass || !means || typeof means !== 'object') {
            return { mean: NEUTRAL_FALLBACK_RATING, available: false, source: 'fallback' };
        }
        const parsedBefore = parseSeason(beforeSeason);
        const candidates = [];
        for (const key of ownNames(means)) {
            const separator = key.lastIndexOf('|');
            if (separator < 1) continue;
            const keyClass = key.slice(0, separator);
            const season = parseSeason(key.slice(separator + 1));
            const entry = ownValue(means, key);
            const mean = ownValue(entry, 'mean');
            if (keyClass !== normalizedClass || !season
                || (parsedBefore && season.endYear > parsedBefore.startYear)) continue;
            const numeric = safePositiveModelRating(mean);
            if (numeric !== null) candidates.push({
                seasonEnd: season.endYear,
                mean: numeric,
            });
        }
        candidates.sort((left, right) => right.seasonEnd - left.seasonEnd || right.mean - left.mean);
        if (candidates.length) {
            return { mean: candidates[0].mean, available: true, source: 'target-class' };
        }
        return { mean: NEUTRAL_FALLBACK_RATING, available: false, source: 'fallback' };
    }

    function neutralHistoricalPrior(targetClass, meanInfo, diagnostics) {
        return deepFreeze({
            rating: meanInfo.mean,
            neutralMean: meanInfo.mean,
            classMeanAvailable: meanInfo.available,
            classMeanSource: meanInfo.source,
            targetClass,
            seasons: [],
            sourceSeasons: [],
            sourceClasses: [],
            classCalibrated: false,
            confidence: 'very-low',
            provenance: 'neutral-target-class-mean',
            diagnostics: diagnostics || { invalidBeforeSeason: false },
        });
    }

    function buildHistoricalPrior(options) {
        const targetClass = normalizeLeagueClass(ownValue(options, 'targetClass'));
        const archiveIndex = ownValue(options, 'archiveIndex');
        const playerId = safeIdentifier(ownValue(options, 'playerId'));
        const cutoffInspection = inspectOwn(options, 'beforeSeason');
        const cutoffProvided = cutoffInspection.exists;
        const beforeSeason = cutoffInspection.isData
            ? canonicalSeason(cutoffInspection.descriptor.value)
            : null;
        const explicitMean = ownValue(options, 'classMean');
        const invalidBeforeSeason = cutoffProvided && beforeSeason === null;
        if (!targetClass || !isArchiveIndex(archiveIndex)) {
            const supplied = safePositiveModelRating(explicitMean);
            const meanInfo = supplied === null
                ? { mean: NEUTRAL_FALLBACK_RATING, available: false, source: 'fallback' }
                : { mean: supplied, available: true, source: 'explicit' };
            return neutralHistoricalPrior(targetClass, meanInfo, { invalidBeforeSeason });
        }
        if (invalidBeforeSeason) {
            const supplied = safePositiveModelRating(explicitMean);
            const meanInfo = supplied === null
                ? { mean: NEUTRAL_FALLBACK_RATING, available: false, source: 'fallback' }
                : { mean: supplied, available: true, source: 'explicit' };
            return neutralHistoricalPrior(targetClass, meanInfo, { invalidBeforeSeason: true });
        }

        const chronologicalIndex = beforeSeason
            ? filteredArchiveIndexBefore(archiveIndex, beforeSeason)
            : archiveIndex;
        const suppliedCalibration = ownValue(options, 'calibration');
        const calibration = beforeSeason || !suppliedCalibration
            ? buildClassCalibration(chronologicalIndex)
            : suppliedCalibration;
        const meanInfo = resolveTargetClassMean(
            calibration, targetClass, beforeSeason, explicitMean,
        );
        const history = playerId ? ownValue(chronologicalIndex.histories, playerId) : null;
        if (!history || !Array.isArray(history)) {
            return neutralHistoricalPrior(targetClass, meanInfo, { invalidBeforeSeason: false });
        }

        const usable = [];
        const completedWindow = history.slice(0, 2);
        for (const record of completedWindow) {
            const groups = seasonClassGroups(record);
            if (!groups.length) continue;
            let totalAppearances = 0;
            let totalPoints = 0;
            let weightedConverted = 0;
            let classCalibrated = true;
            const conversionPath = [];
            for (const group of groups) {
                const raw = group.points / group.appearances;
                const conversion = convertClassRating(
                    raw, group.leagueClass, targetClass, calibration,
                );
                if (safeRating(conversion.rating) === null) {
                    totalAppearances = 0;
                    break;
                }
                totalAppearances += group.appearances;
                totalPoints += group.points;
                weightedConverted += conversion.rating * group.appearances;
                classCalibrated = classCalibrated && conversion.calibrated;
                conversionPath.push(...conversion.path);
            }
            if (!totalAppearances || !Number.isSafeInteger(totalAppearances)
                || !Number.isSafeInteger(totalPoints)) continue;
            const convertedRaw = weightedConverted / totalAppearances;
            const rating = (weightedConverted + PRIOR_APPEARANCES * meanInfo.mean)
                / (totalAppearances + PRIOR_APPEARANCES);
            const safeSeasonRating = safePositiveModelRating(rating);
            if (safeSeasonRating === null) continue;
            usable.push({
                season: record.season,
                sourceClass: groups.length === 1 ? groups[0].leagueClass : null,
                sourceClasses: groups.map((group) => group.leagueClass),
                targetClass,
                points: totalPoints,
                appearances: totalAppearances,
                raw: totalPoints / totalAppearances,
                convertedRaw,
                stable: safeSeasonRating,
                converted: safeSeasonRating,
                rating: safeSeasonRating,
                classCalibrated,
                conversionPath: Array.from(new Set(conversionPath)),
                weight: 0,
            });
        }
        if (!usable.length) {
            return neutralHistoricalPrior(targetClass, meanInfo, { invalidBeforeSeason: false });
        }
        const weights = usable.length === 2 ? [0.7, 0.3] : [1];
        let rating = 0;
        for (let indexPosition = 0; indexPosition < usable.length; indexPosition += 1) {
            usable[indexPosition].weight = weights[indexPosition];
            rating += usable[indexPosition].rating * weights[indexPosition];
        }
        const classCalibrated = usable.every((season) => season.classCalibrated);
        const solidTwoSeasons = usable.length === 2
            && classCalibrated
            && usable.every((season) => season.appearances >= PRIOR_APPEARANCES);
        return deepFreeze({
            rating,
            neutralMean: meanInfo.mean,
            classMeanAvailable: meanInfo.available,
            classMeanSource: meanInfo.source,
            targetClass,
            seasons: usable,
            sourceSeasons: usable.map((season) => season.season),
            sourceClasses: Array.from(new Set(usable.flatMap((season) => season.sourceClasses))),
            classCalibrated,
            confidence: classCalibrated ? (solidTwoSeasons ? 'medium' : 'provisional') : 'very-low',
            provenance: usable.length === 2 ? 'historical-two-season' : 'historical-one-season',
            diagnostics: { invalidBeforeSeason: false },
        });
    }

    function currentPlayerSources(value) {
        const inspection = inspectArray(value);
        const players = inspection.ok && inspection.isArray ? value : ownValue(value, 'players');
        const inspected = arrayDataValues(players);
        return inspected.ok ? inspected.values : [];
    }

    function collectTeamAliases(source, includeGenericIdentity = false) {
        const labels = new Set();
        const ids = new Set();
        let present = false;
        let invalid = false;
        function collect(keys, normalize) {
            for (const key of keys) {
                const inspection = inspectOwn(source, key);
                if (!inspection.ok || (inspection.exists && !inspection.isData)) {
                    invalid = true;
                    continue;
                }
                if (!inspection.exists) continue;
                present = true;
                const normalized = normalize(inspection.descriptor.value);
                if (normalized === null) invalid = true;
                else normalized.target.add(normalized.value);
            }
        }
        collect(['team', 'teamName', 'company', ...(includeGenericIdentity ? ['name'] : [])], (value) => {
            const label = exactTeamLabel(value);
            return label ? { target: labels, value: label } : null;
        });
        collect(['team_id', 'teamId', ...(includeGenericIdentity ? ['id'] : [])], (value) => {
            const id = normalizedTeamIdentityId(value);
            return id ? { target: ids, value: id } : null;
        });
        return {
            labels,
            ids,
            present,
            invalid,
            ambiguous: labels.size > 1 || ids.size > 1,
        };
    }

    function parseCurrentPlayer(source, currentDatasetSeason, targetSeason, invalidDatasetSeason) {
        if (!source || typeof source !== 'object') return null;
        const id = safeIdentifier(ownValue(source, 'id'));
        const name = displayPlayerName(ownValue(source, 'name'));
        const clubId = safeIdentifier(ownValue(source, 'v_nr'));
        const leagueInspection = inspectOwn(source, 'league');
        const league = leagueInspection.isData ? leagueInspection.descriptor.value : undefined;
        const leagueClass = normalizeLeagueClass(league);
        const leagueSeason = seasonFromLeague(league);
        const seasonInspection = inspectOwn(source, 'season');
        const explicitSeason = seasonInspection.isData
            ? canonicalSeason(seasonInspection.descriptor.value)
            : null;
        const hasLeagueSeasonSignal = typeof league === 'string'
            && (/\b(?:[0-9]{2}|[0-9]{4})\s*[/\-\u2010-\u2015]\s*(?:[0-9]{2}|[0-9]{4})\b/u.test(league)
                || /saison/iu.test(league));
        const invalidExplicitSeason = !seasonInspection.ok
            || (seasonInspection.exists && (!seasonInspection.isData || !explicitSeason));
        const invalidLeagueSeason = !leagueInspection.ok
            || (leagueInspection.exists && !leagueInspection.isData)
            || (hasLeagueSeasonSignal && (!leagueClass || !leagueSeason));
        const conflictingRowSeasons = explicitSeason && leagueSeason
            && explicitSeason !== leagueSeason;
        const rowSeasons = [explicitSeason, leagueSeason].filter(Boolean);
        const datasetConflict = currentDatasetSeason
            && rowSeasons.some((season) => season !== currentDatasetSeason);
        if ((invalidExplicitSeason || invalidLeagueSeason
            || conflictingRowSeasons || datasetConflict) && id) {
            return { id, invalidSeason: true };
        }
        const staleDatasetSeason = currentDatasetSeason && targetSeason
            && currentDatasetSeason !== targetSeason;
        const staleRowSeason = !currentDatasetSeason && targetSeason
            && rowSeasons.length && rowSeasons.every((season) => season !== targetSeason);
        if (id && (staleDatasetSeason || staleRowSeason
            || (!rowSeasons.length && !currentDatasetSeason))) {
            return { id, irrelevantSeason: true };
        }
        const invalidSeason = invalidDatasetSeason
            || (targetSeason && leagueSeason && leagueSeason !== targetSeason)
            || (targetSeason && explicitSeason && explicitSeason !== targetSeason)
            || (targetSeason && !explicitSeason && currentDatasetSeason !== targetSeason);
        if (invalidSeason && id) return { id, invalidSeason: true };
        const season = explicitSeason || currentDatasetSeason || null;
        const teamAliases = collectTeamAliases(source);
        if ((teamAliases.invalid || teamAliases.ambiguous) && id) {
            return { id, invalidTeamIdentity: true };
        }
        const company = Array.from(teamAliases.labels)[0] || '';
        const teamIdentityId = Array.from(teamAliases.ids)[0] || '';
        const roundsDescriptor = ownData(source, 'rounds');
        if (!id || !name || !clubId) return null;
        const roundsClone = roundsDescriptor ? cloneOwnData(roundsDescriptor.value) : {};
        if (roundsClone === INVALID_CLONE) return null;
        const canonicalRounds = {};
        for (const key of ownNames(roundsClone).sort()) {
            const descriptor = ownData(roundsClone, key);
            if (!descriptor || !descriptor.enumerable || !/^R[1-9][0-9]*$/u.test(key)) continue;
            const numeric = parseCanonicalInteger(descriptor.value);
            if (numeric !== null) defineData(canonicalRounds, key, numeric);
            else if (typeof descriptor.value === 'string'
                && (descriptor.value === '' || descriptor.value === 'x')) {
                defineData(canonicalRounds, key, descriptor.value);
            } else return null;
        }
        const fingerprint = JSON.stringify({
            id,
            name: canonicalPlayerName(name),
            clubId,
            leagueClass,
            season,
            teamLabels: Array.from(teamAliases.labels).sort(),
            teamIds: Array.from(teamAliases.ids).sort(),
            rounds: canonicalRounds,
        });
        const result = {
            id,
            name,
            normalizedName: canonicalPlayerName(name),
            clubId,
            leagueClass,
            season,
            rounds: canonicalRounds,
            stats: roundStats(canonicalRounds),
            fingerprint,
        };
        if (company) defineData(result, 'company', company);
        if (teamIdentityId) defineData(result, 'team_id', teamIdentityId);
        return result;
    }

    function groupCurrentPlayers(sources, currentDatasetSeason, targetSeason, invalidDatasetSeason) {
        const groups = new Map();
        const invalidIds = new Set();
        const irrelevantIds = new Set();
        const rejectedSeasonIds = new Set();
        for (const source of sources) {
            const sourceId = safeIdentifier(ownValue(source, 'id'));
            const player = parseCurrentPlayer(
                source, currentDatasetSeason, targetSeason, invalidDatasetSeason,
            );
            if (player && player.invalidTeamIdentity) {
                invalidIds.add(player.id);
                continue;
            }
            if (player && player.irrelevantSeason) {
                irrelevantIds.add(player.id);
                continue;
            }
            if (player && player.invalidSeason) {
                invalidIds.add(player.id);
                rejectedSeasonIds.add(player.id);
                continue;
            }
            if (!player) {
                if (sourceId) invalidIds.add(sourceId);
                continue;
            }
            if (!groups.has(player.id)) groups.set(player.id, []);
            groups.get(player.id).push(player);
        }
        const players = [];
        const ambiguousIds = new Set(invalidIds);
        for (const id of Array.from(groups.keys()).sort((left, right) => left.localeCompare(right, 'en'))) {
            if (ambiguousIds.has(id)) continue;
            const group = groups.get(id);
            const fingerprints = new Set(group.map((player) => player.fingerprint));
            if (fingerprints.size !== 1) {
                ambiguousIds.add(id);
                continue;
            }
            const player = group[0];
            if (targetSeason && player.season !== targetSeason) {
                irrelevantIds.add(id);
                continue;
            }
            players.push(player);
        }
        return { players, ambiguousIds, irrelevantIds, rejectedSeasonIds };
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

    function authoritativeRosterMapping(options, teamId, targetClass, targetSeason) {
        const labels = new Set();
        const entries = [];
        let explicitAmbiguity = false;
        let invalidMapping = false;
        const ambiguousInspection = inspectOwn(options, 'ambiguousClubNumbers');
        if (ambiguousInspection.exists && !ambiguousInspection.isData) explicitAmbiguity = true;
        const ambiguousNumbers = arrayDataValues(
            ambiguousInspection.isData ? ambiguousInspection.descriptor.value : undefined,
        );
        if (ambiguousNumbers.ok) {
            explicitAmbiguity = ambiguousNumbers.values.some(
                (number) => safeIdentifier(number) === teamId,
            );
        }

        function addLabel(value) {
            const label = exactTeamLabel(value);
            if (label) {
                labels.add(label);
                entries.push({ label, ids: new Set() });
                return true;
            }
            return false;
        }

        function mappingClubId(record, inheritedClubId) {
            const ids = new Set();
            for (const key of ['clubNumber', 'club_number', 'v_nr', 'number', 'clubId']) {
                const inspection = inspectOwn(record, key);
                if (!inspection.ok || (inspection.exists && !inspection.isData)) return null;
                if (!inspection.exists) continue;
                const id = safeIdentifier(inspection.descriptor.value);
                if (!id) return null;
                ids.add(id);
            }
            if (ids.size > 1) return null;
            const explicit = Array.from(ids)[0] || null;
            if (inheritedClubId && explicit && explicit !== inheritedClubId) return null;
            return explicit || inheritedClubId || null;
        }

        function mappingScope(record) {
            const classes = new Set();
            const leagueSeasons = new Set();
            let hasLeague = false;
            for (const key of ['league', 'leagueClass', 'class']) {
                const inspection = inspectOwn(record, key);
                if (!inspection.ok || (inspection.exists && !inspection.isData)) return null;
                if (!inspection.exists) continue;
                hasLeague = true;
                const leagueClass = normalizeLeagueClass(inspection.descriptor.value);
                if (!leagueClass) return null;
                classes.add(leagueClass);
                const season = seasonFromLeague(inspection.descriptor.value);
                if (season) leagueSeasons.add(season);
            }
            if (classes.size > 1 || leagueSeasons.size > 1) return null;
            const seasonInspection = inspectOwn(record, 'season');
            if (!seasonInspection.ok || (seasonInspection.exists && !seasonInspection.isData)) return null;
            const explicitSeason = seasonInspection.exists
                ? canonicalSeason(seasonInspection.descriptor.value)
                : null;
            if (seasonInspection.exists && !explicitSeason) return null;
            const leagueSeason = Array.from(leagueSeasons)[0] || null;
            if (explicitSeason && leagueSeason && explicitSeason !== leagueSeason) return null;
            return {
                leagueClass: Array.from(classes)[0] || null,
                season: explicitSeason || leagueSeason,
                hasLeague,
            };
        }

        function recordMentionsTargetClub(record, inheritedClubId) {
            if (inheritedClubId === teamId) return true;
            for (const key of ['clubNumber', 'club_number', 'v_nr', 'number', 'clubId']) {
                const inspection = inspectOwn(record, key);
                if (inspection.isData && safeIdentifier(inspection.descriptor.value) === teamId) {
                    return true;
                }
            }
            return false;
        }

        function addMappingRecord(record, requireScope, inheritedClubId, includeGenericIdentity = false) {
            if (typeof record === 'string') {
                if (inheritedClubId && !addLabel(record) && inheritedClubId === teamId) {
                    explicitAmbiguity = true;
                    invalidMapping = true;
                }
                return;
            }
            const mentionsTargetClub = recordMentionsTargetClub(record, inheritedClubId);
            const safeRecord = cloneOwnData(record);
            if (safeRecord === INVALID_CLONE || !safeRecord
                || typeof safeRecord !== 'object' || Array.isArray(safeRecord)) {
                if (mentionsTargetClub) {
                    explicitAmbiguity = true;
                    invalidMapping = true;
                }
                return;
            }
            const clubId = mappingClubId(safeRecord, inheritedClubId);
            const scope = mappingScope(safeRecord);
            if (!clubId || !scope) {
                if (mentionsTargetClub) {
                    explicitAmbiguity = true;
                    invalidMapping = true;
                }
                return;
            }
            if (clubId !== teamId) return;
            if (requireScope && (!scope.leagueClass || (targetSeason && !scope.season))) {
                explicitAmbiguity = true;
                invalidMapping = true;
                return;
            }
            if ((scope.leagueClass && scope.leagueClass !== targetClass)
                || (targetSeason && scope.season && scope.season !== targetSeason)) return;
            const aliases = collectTeamAliases(safeRecord, includeGenericIdentity);
            if (aliases.invalid || aliases.ambiguous || (!aliases.labels.size && !aliases.ids.size)) {
                explicitAmbiguity = true;
                invalidMapping = true;
                return;
            }
            const label = Array.from(aliases.labels)[0] || null;
            if (label) labels.add(label);
            entries.push({
                label,
                ids: new Set(aliases.ids),
                objectTeam: includeGenericIdentity && aliases.ids.size > 0,
            });
        }

        function addRecords(value, requireScope, inheritedClubId) {
            const records = arrayDataValues(value);
            if (!records.ok) return false;
            for (const record of records.values) addMappingRecord(record, requireScope, inheritedClubId);
            return true;
        }

        const teamMappingsInspection = inspectOwn(options, 'teamMappings');
        if (!teamMappingsInspection.ok
            || (teamMappingsInspection.exists && !teamMappingsInspection.isData)) {
            explicitAmbiguity = true;
            invalidMapping = true;
        }
        const teamMappings = teamMappingsInspection.isData
            ? teamMappingsInspection.descriptor.value
            : undefined;
        const directMappingInspection = teamMappingsInspection.isData
            ? inspectOwn(teamMappings, teamId)
            : { ok: true, exists: false, isData: false, descriptor: null };
        if (!directMappingInspection.ok
            || (directMappingInspection.exists && !directMappingInspection.isData)) {
            explicitAmbiguity = true;
            invalidMapping = true;
        }
        if (directMappingInspection.isData && !addRecords(
            directMappingInspection.descriptor.value, true, teamId,
        )) {
            explicitAmbiguity = true;
            invalidMapping = true;
        }
        addRecords(teamMappings, true, null);
        const leagueTeamsInspection = inspectOwn(options, 'leagueTeams');
        if (!leagueTeamsInspection.ok
            || (leagueTeamsInspection.exists && !leagueTeamsInspection.isData)) {
            explicitAmbiguity = true;
            invalidMapping = true;
        }
        if (leagueTeamsInspection.isData && !addRecords(
            leagueTeamsInspection.descriptor.value, true, null,
        )) {
            explicitAmbiguity = true;
            invalidMapping = true;
        }

        const useClubsFallback = !teamMappingsInspection.exists && !leagueTeamsInspection.exists;
        const clubsInspection = inspectOwn(options, 'clubs');
        if (useClubsFallback
            && (!clubsInspection.ok || (clubsInspection.exists && !clubsInspection.isData))) {
            explicitAmbiguity = true;
            invalidMapping = true;
        }
        const clubs = arrayDataValues(
            clubsInspection.isData ? clubsInspection.descriptor.value : undefined,
        );
        if (useClubsFallback && clubsInspection.exists && !clubs.ok) {
            explicitAmbiguity = true;
            invalidMapping = true;
        }
        if (useClubsFallback && clubs.ok) {
            const matchingClubs = [];
            const clubIdentities = new Set();
            for (const club of clubs.values) {
                const mentionsTargetClub = recordMentionsTargetClub(club, null);
                const safeClub = cloneOwnData(club);
                if (safeClub === INVALID_CLONE || !safeClub
                    || typeof safeClub !== 'object' || Array.isArray(safeClub)) {
                    explicitAmbiguity = true;
                    invalidMapping = true;
                    continue;
                }
                const clubId = mappingClubId(safeClub, null);
                if (!clubId) {
                    if (mentionsTargetClub) {
                        explicitAmbiguity = true;
                        invalidMapping = true;
                    }
                    continue;
                }
                if (clubId !== teamId) continue;
                const clubNames = new Set();
                let invalidClubName = false;
                for (const key of ['name', 'clubName', 'company']) {
                    const inspection = inspectOwn(safeClub, key);
                    if (!inspection.ok || (inspection.exists && !inspection.isData)) {
                        invalidClubName = true;
                        continue;
                    }
                    if (!inspection.exists) continue;
                    const name = exactTeamLabel(inspection.descriptor.value);
                    if (!name) invalidClubName = true;
                    else clubNames.add(name);
                }
                if (invalidClubName || clubNames.size !== 1) {
                    explicitAmbiguity = true;
                    invalidMapping = true;
                    continue;
                }
                const clubIdentity = JSON.stringify([clubId, Array.from(clubNames)[0]]);
                clubIdentities.add(clubIdentity);
                matchingClubs.push(safeClub);
            }
            if (clubIdentities.size > 1) {
                explicitAmbiguity = true;
                invalidMapping = true;
            }
            for (const club of invalidMapping ? [] : matchingClubs) {
                const teamsInspection = inspectOwn(club, 'teams');
                if (!teamsInspection.ok || (teamsInspection.exists && !teamsInspection.isData)) {
                    explicitAmbiguity = true;
                    invalidMapping = true;
                    continue;
                }
                if (!teamsInspection.exists) continue;
                const teams = arrayDataValues(teamsInspection.descriptor.value);
                if (!teams.ok) {
                    explicitAmbiguity = true;
                    invalidMapping = true;
                    continue;
                }
                for (const team of teams.values) {
                    addMappingRecord(team, false, teamId, true);
                }
            }
        }
        const canonicalEntries = [];
        const seenIdentities = new Set();
        for (const entry of entries) {
            const ids = Array.from(entry.ids).sort((left, right) => left.localeCompare(right, 'en'));
            const identity = JSON.stringify([entry.label || null, ids]);
            if (seenIdentities.has(identity)) continue;
            seenIdentities.add(identity);
            canonicalEntries.push({
                label: entry.label,
                ids: new Set(ids),
                identity,
                objectTeam: Boolean(entry.objectTeam),
            });
        }
        canonicalEntries.sort((left, right) => left.identity.localeCompare(right.identity, 'en'));
        const canonicalLabels = new Set(
            canonicalEntries.map((entry) => entry.label).filter(Boolean),
        );
        return {
            labels: canonicalLabels,
            entries: canonicalEntries,
            authoritative: canonicalEntries.length > 0 || explicitAmbiguity,
            ambiguous: explicitAmbiguity || canonicalEntries.length > 1,
            invalid: invalidMapping,
        };
    }

    function mappingEntriesMatchingAliases(mapping, aliases) {
        if (aliases.invalid || aliases.ambiguous || !aliases.present) return [];
        return mapping.entries.filter((entry) => (
            !(mapping.entries.length > 1 && entry.objectTeam && !aliases.ids.size)
            && (!aliases.labels.size || (entry.label && aliases.labels.has(entry.label)))
            && (!aliases.ids.size
                || Array.from(aliases.ids).some((id) => entry.ids.has(id)))
        ));
    }

    function selectedRosterTeamAliases(options) {
        const labels = new Set();
        const ids = new Set();
        let present = false;
        let invalid = false;
        const teamNameInspection = inspectOwn(options, 'teamName');
        if (!teamNameInspection.ok || (teamNameInspection.exists && !teamNameInspection.isData)) {
            invalid = true;
        } else if (teamNameInspection.exists) {
            present = true;
            const label = exactTeamLabel(teamNameInspection.descriptor.value);
            if (label) labels.add(label);
            else invalid = true;
        }
        for (const key of ['team_id', 'selectedTeamId', 'selected_team_id']) {
            const inspection = inspectOwn(options, key);
            if (!inspection.ok || (inspection.exists && !inspection.isData)) {
                invalid = true;
                continue;
            }
            if (!inspection.exists) continue;
            present = true;
            const id = normalizedTeamIdentityId(inspection.descriptor.value);
            if (id) ids.add(id);
            else invalid = true;
        }
        return {
            labels,
            ids,
            present,
            invalid,
            ambiguous: labels.size > 1 || ids.size > 1,
        };
    }

    function resolveSelectedRosterEntry(options, mapping) {
        const aliases = selectedRosterTeamAliases(options);
        if (aliases.invalid || aliases.ambiguous) return { valid: false, aliases, entry: null };
        if (!mapping.authoritative) {
            return {
                valid: !aliases.ids.size,
                aliases,
                entry: null,
            };
        }
        const matches = aliases.present
            ? mappingEntriesMatchingAliases(mapping, aliases)
            : mapping.entries.slice();
        return {
            valid: matches.length === 1 && !mapping.invalid,
            aliases,
            entry: matches.length === 1 ? matches[0] : null,
        };
    }

    function rosterRecordMatchesSelectedTeam(record, mapping, selection) {
        const aliases = collectTeamAliases(record);
        if (aliases.invalid || aliases.ambiguous || !selection.valid) return false;
        if (!mapping.authoritative) {
            if (!aliases.present) return true;
            if (aliases.ids.size || !selection.aliases.labels.size) return false;
            return aliases.labels.size === 1
                && aliases.labels.has(Array.from(selection.aliases.labels)[0]);
        }
        if (!aliases.present) return mapping.entries.length === 1 && !mapping.ambiguous;
        const matches = mappingEntriesMatchingAliases(mapping, aliases);
        return matches.length === 1 && selection.entry
            && matches[0].identity === selection.entry.identity;
    }

    function rosterRecordResolvesMappedTeam(record, mapping) {
        const aliases = collectTeamAliases(record);
        if (aliases.invalid || aliases.ambiguous || !aliases.present) return false;
        if (!mapping.authoritative) return aliases.labels.size === 1 && !aliases.ids.size;
        return mappingEntriesMatchingAliases(mapping, aliases).length === 1;
    }

    function latestHistoricalAffiliation(record) {
        const inspected = arrayDataValues(ownValue(record, 'segments'));
        if (!inspected.ok) return { ambiguous: true, segments: [], clubId: null };
        const candidates = [];
        for (const segment of inspected.values) {
            const clubId = safeIdentifier(ownValue(segment, 'v_nr'));
            if (!clubId) continue;
            let latestRound = -1;
            const rounds = ownValue(segment, 'rounds');
            for (const key of ownNames(rounds)) {
                const match = /^R([1-9][0-9]*)$/u.exec(key);
                const descriptor = ownData(rounds, key);
                if (!match || !descriptor || parseCanonicalInteger(descriptor.value) === null) continue;
                latestRound = Math.max(latestRound, Number(match[1]));
            }
            candidates.push({ segment, clubId, latestRound });
        }
        if (!candidates.length) return { ambiguous: true, segments: [], clubId: null };
        const greatestRound = Math.max(...candidates.map((candidate) => candidate.latestRound));
        if (greatestRound < 0) return { ambiguous: true, segments: [], clubId: null };
        const latest = candidates.filter((candidate) => candidate.latestRound === greatestRound);
        const clubs = new Set(latest.map((candidate) => candidate.clubId));
        if (clubs.size !== 1) return { ambiguous: true, segments: [], clubId: null };
        latest.sort((left, right) => (
            String(left.segment.segment_id).localeCompare(String(right.segment.segment_id), 'en')
        ));
        return {
            ambiguous: false,
            segments: latest.map((candidate) => candidate.segment),
            clubId: latest[0].clubId,
        };
    }

    function buildTeamRoster(options) {
        const teamId = safeIdentifier(ownValue(options, 'teamId'));
        const targetLeague = ownValue(options, 'targetLeague');
        const targetClass = normalizeLeagueClass(targetLeague);
        const leagueSeason = seasonFromLeague(targetLeague);
        const targetSeasonInspection = inspectOwn(options, 'targetSeason');
        const explicitTargetSeason = targetSeasonInspection.isData
            ? canonicalSeason(targetSeasonInspection.descriptor.value)
            : null;
        const datasetSeasonInspection = inspectOwn(options, 'currentDatasetSeason');
        const currentDatasetSeason = datasetSeasonInspection.isData
            ? canonicalSeason(datasetSeasonInspection.descriptor.value)
            : null;
        const invalidTargetSeason = (targetSeasonInspection.exists && !explicitTargetSeason)
            || (leagueSeason && explicitTargetSeason && explicitTargetSeason !== leagueSeason);
        const targetSeason = explicitTargetSeason || leagueSeason || currentDatasetSeason;
        const invalidDatasetSeason = datasetSeasonInspection.exists && !currentDatasetSeason;
        const archiveData = ownValue(options, 'archiveData');
        const archiveIndex = buildArchiveIndex(archiveData && typeof archiveData === 'object' ? archiveData : {});
        const chronologicalIndex = targetSeason
            ? filteredArchiveIndexBefore(archiveIndex, targetSeason)
            : archiveIndex;
        const suppliedCalibration = ownValue(options, 'calibration');
        const calibration = targetSeason || !suppliedCalibration
            ? buildClassCalibration(chronologicalIndex)
            : suppliedCalibration;
        const meanInfo = resolveTargetClassMean(
            calibration, targetClass, targetSeason, ownValue(options, 'classMean'),
        );
        const classMean = meanInfo.mean;
        const diagnostics = {
            invalidTeam: !teamId || !targetClass || invalidTargetSeason,
            ambiguousTeam: false,
            ambiguousPlayerIds: [],
            excludedCurrentIds: [],
            ambiguousCurrentIds: [],
            irrelevantCurrentIds: [],
            invalidMapping: false,
            historicalSeasons: [],
        };
        if (!teamId || !targetClass || invalidTargetSeason) {
            return deepFreeze({ players: [], targetClass, classMean, teamConfidence: 'very-low', diagnostics });
        }
        const rosterMapping = authoritativeRosterMapping(
            options, teamId, targetClass, targetSeason,
        );
        diagnostics.invalidMapping = rosterMapping.invalid;
        const selectedRosterEntry = resolveSelectedRosterEntry(options, rosterMapping);

        const groupedCurrent = groupCurrentPlayers(
            currentPlayerSources(ownValue(options, 'currentPlayers')),
            currentDatasetSeason,
            targetSeason,
            invalidDatasetSeason,
        );
        const parsedCurrent = groupedCurrent.players;
        const affiliations = new Map();
        const namesById = new Map();
        for (const player of parsedCurrent) {
            if (!affiliations.has(player.id)) affiliations.set(player.id, new Set());
            affiliations.get(player.id).add(player.clubId);
            if (!namesById.has(player.id)) namesById.set(player.id, new Set());
            namesById.get(player.id).add(player.normalizedName);
        }
        const ambiguousIds = new Set(groupedCurrent.ambiguousIds);
        for (const [id, clubs] of affiliations) {
            if (clubs.size !== 1 || namesById.get(id).size !== 1) ambiguousIds.add(id);
        }
        diagnostics.irrelevantCurrentIds = Array.from(groupedCurrent.irrelevantIds)
            .sort((a, b) => a.localeCompare(b, 'en'));
        diagnostics.excludedCurrentIds = Array.from(new Set([
            ...groupedCurrent.irrelevantIds, ...groupedCurrent.rejectedSeasonIds,
        ]))
            .sort((a, b) => a.localeCompare(b, 'en'));

        const targetCurrent = parsedCurrent.filter((player) => (
            player.clubId === teamId && player.leagueClass === targetClass && !ambiguousIds.has(player.id)
        ));
        const teamNameValue = ownValue(options, 'teamName');
        const teamName = typeof teamNameValue === 'string'
            ? teamNameValue.normalize('NFKC').replace(/\s+/gu, ' ').trim().normalize('NFC')
            : '';
        const selectedTeamLabel = exactTeamLabel(teamName);
        const companies = new Set(targetCurrent.map((player) => exactTeamLabel(player.company)).filter(Boolean));
        if ((rosterMapping.authoritative && !selectedRosterEntry.valid)
            || (!rosterMapping.authoritative && teamName && companies.size
                && !companies.has(selectedTeamLabel))
            || (!rosterMapping.authoritative && !teamName && companies.size > 1)) {
            diagnostics.ambiguousTeam = true;
            return deepFreeze({ players: [], targetClass, classMean, teamConfidence: 'very-low', diagnostics });
        }
        const selectedCurrent = targetCurrent.filter((player) => (
            rosterRecordMatchesSelectedTeam(player, rosterMapping, selectedRosterEntry)
        ));
        const selectedCurrentIds = new Set(selectedCurrent.map((player) => player.id));
        const currentAffiliationVetoIds = new Set();
        for (const player of parsedCurrent) {
            if (selectedCurrentIds.has(player.id)) continue;
            currentAffiliationVetoIds.add(player.id);
            if (player.clubId === teamId && player.leagueClass === targetClass
                && !rosterRecordResolvesMappedTeam(player, rosterMapping)) {
                ambiguousIds.add(player.id);
            }
        }
        diagnostics.ambiguousPlayerIds = Array.from(ambiguousIds)
            .sort((a, b) => a.localeCompare(b, 'en'));
        diagnostics.ambiguousCurrentIds = diagnostics.ambiguousPlayerIds.slice();

        const players = [];
        const addedIds = new Set();
        for (const current of selectedCurrent.sort((left, right) => left.id.localeCompare(right.id, 'en'))) {
            if (addedIds.has(current.id)) continue;
            const historicalRecord = ownValue(chronologicalIndex.histories, current.id);
            const historyNameMatches = !historicalRecord || historicalRecord.every((record) => (
                record.identityAmbiguous === true
                || record.segments.every((segment) => segment.normalizedName === current.normalizedName)
            ));
            const historicalPrior = historyNameMatches
                ? buildHistoricalPrior({
                    playerId: current.id,
                    targetClass,
                    archiveIndex: chronologicalIndex,
                    calibration,
                    classMean,
                })
                : neutralHistoricalPrior(targetClass, meanInfo, { invalidBeforeSeason: false });
            const hasHistory = historicalPrior.seasons.length > 0;
            const stats = current.stats;
            const blendedRating = stats.appearances
                ? (stats.points + PRIOR_APPEARANCES * historicalPrior.rating)
                    / (stats.appearances + PRIOR_APPEARANCES)
                : historicalPrior.rating;
            const safeBlendedRating = safePositiveModelRating(blendedRating);
            const rating = safeBlendedRating === null ? classMean : safeBlendedRating;
            const currentWeight = stats.appearances / (stats.appearances + PRIOR_APPEARANCES);
            let confidence = 'very-low';
            if (stats.appearances >= 8) confidence = 'high';
            else if (stats.appearances >= 1 && hasHistory) confidence = 'medium';
            else if (stats.appearances >= 1 || hasHistory) confidence = 'provisional';
            if (hasHistory && !historicalPrior.classCalibrated) confidence = 'very-low';
            if (safeBlendedRating === null) confidence = 'very-low';
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
                sourceClasses: historicalPrior.sourceClasses.slice(),
                rounds: cloneCanonicalRounds(current.rounds),
                rosterUnconfirmed: false,
            });
            addedIds.add(current.id);
        }

        const seasonSet = new Map();
        for (const playerId of ownNames(chronologicalIndex.histories)) {
            const history = ownValue(chronologicalIndex.histories, playerId) || [];
            for (const record of history) {
                if (!record.segments.some((segment) => safeIdentifier(segment.v_nr))) continue;
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
                if (addedIds.has(playerId) || ambiguousIds.has(playerId)
                    || currentAffiliationVetoIds.has(playerId)) continue;
                const affiliation = affiliations.get(playerId);
                if (affiliation && (!affiliation.has(teamId) || affiliation.size !== 1)) continue;
                const history = ownValue(chronologicalIndex.histories, playerId) || [];
                if (evidence === 'historical-fallback' && historicalSeasons[0]
                    && history.some((record) => record.season === historicalSeasons[0].season)) {
                    continue;
                }
                const sourceRecord = history.find((record) => record.season === season);
                if (!sourceRecord || sourceRecord.identityAmbiguous || sourceRecord.roundOverlapAmbiguous) continue;
                const sourceAffiliation = latestHistoricalAffiliation(sourceRecord);
                const sourceSegments = sourceAffiliation.segments.filter((segment) => (
                    segment.leagueClass === targetClass
                    && rosterRecordMatchesSelectedTeam(segment, rosterMapping, selectedRosterEntry)
                ));
                if (sourceAffiliation.ambiguous || sourceAffiliation.clubId !== teamId
                    || !sourceSegments.length) continue;
                const sourceSegment = sourceSegments[0];
                const historicalPrior = buildHistoricalPrior({
                    playerId, targetClass, archiveIndex: chronologicalIndex, calibration, classMean,
                });
                if (!historicalPrior.seasons.length) continue;
                let confidence = historicalPrior.confidence;
                if (evidence === 'historical-fallback') confidence = 'very-low';
                else if (confidence === 'high' || confidence === 'medium') confidence = 'provisional';
                candidates.push({
                    id: playerId,
                    name: sourceSegment.name,
                    rating: historicalPrior.rating,
                    adjustedRating: historicalPrior.rating,
                    evidence,
                    confidence,
                    currentAppearances: 0,
                    currentPoints: 0,
                    currentWeight: 0,
                    historicalPrior,
                    sourceSeasons: historicalPrior.sourceSeasons.slice(),
                    sourceClasses: historicalPrior.sourceClasses.slice(),
                    rounds: cloneCanonicalRounds(sourceSegment.rounds || {}),
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
        const completedRoster = completeLineup(players, {
            classMean,
            classMeanAvailable: meanInfo.available,
        });
        return deepFreeze({
            players,
            targetClass,
            classMean,
            classMeanAvailable: meanInfo.available,
            classMeanSource: meanInfo.source,
            teamConfidence: completedRoster.teamConfidence,
            diagnostics,
        });
    }

    function completeLineup(knownPlayers, options) {
        const size = 4;
        const manual = ownValue(options, 'manual') === true;
        const explicitMean = safePositiveModelRating(ownValue(options, 'classMean'));
        const classMean = explicitMean === null ? NEUTRAL_FALLBACK_RATING : explicitMean;
        const availabilityValue = ownValue(options, 'classMeanAvailable');
        const classMeanAvailable = explicitMean !== null && availabilityValue !== false;
        const inspected = arrayDataValues(knownPlayers);
        const known = [];
        if (inspected.ok) {
            for (const source of inspected.values) {
                const clone = cloneOwnData(source);
                if (clone === INVALID_CLONE || !clone || typeof clone !== 'object' || Array.isArray(clone)) continue;
                const adjusted = safePositiveModelRating(ownValue(clone, 'adjustedRating'));
                const rating = adjusted === null
                    ? safePositiveModelRating(ownValue(clone, 'rating'))
                    : adjusted;
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
        defineData(lineup, 'classMean', classMean);
        defineData(lineup, 'classMeanAvailable', classMeanAvailable);
        defineData(lineup, 'classMeanSource', classMeanAvailable ? 'provided' : 'fallback');
        return deepFreeze(lineup);
    }

    function exactTeamLabel(value) {
        if (typeof value !== 'string') return null;
        const compatibilityNormalized = value.normalize('NFKC');
        if (/[\p{Default_Ignorable_Code_Point}\p{Noncharacter_Code_Point}\p{Cc}\p{Cf}\p{Cs}]/u.test(compatibilityNormalized)) {
            return null;
        }
        const normalized = compatibilityNormalized.replace(/\s+/gu, ' ').trim().normalize('NFC');
        return normalized && /\p{L}/u.test(normalized)
            ? normalized.toLocaleLowerCase('de-DE')
            : null;
    }

    function clubTeamMappings(clubs) {
        const mappings = new Map();
        const invalidClubIds = new Set();
        let globalInvalid = false;
        const inspected = arrayDataValues(clubs);
        if (!inspected.ok) {
            return { mappings, invalidClubIds, globalInvalid: clubs !== undefined };
        }
        const prepared = [];
        const identitiesByClub = new Map();
        function canonicalOutcomeMappingIdentity(mapping) {
            return JSON.stringify([
                mapping.clubId,
                mapping.teamLabel,
                mapping.hasAuthoritativeId ? String(mapping.teamId) : null,
            ]);
        }
        function registerIdentity(mapping) {
            if (!identitiesByClub.has(mapping.clubId)) {
                identitiesByClub.set(mapping.clubId, new Set());
            }
            identitiesByClub.get(mapping.clubId).add(canonicalOutcomeMappingIdentity(mapping));
        }
        function add(label, mapping) {
            const key = exactTeamLabel(label);
            if (!key) return;
            if (!mappings.has(key)) mappings.set(key, []);
            const identity = canonicalOutcomeMappingIdentity(mapping);
            if (mappings.get(key).some(
                (candidate) => canonicalOutcomeMappingIdentity(candidate) === identity,
            )) return;
            mappings.get(key).push(mapping);
        }
        const validatedClubs = [];
        const namesByClub = new Map();
        for (const club of inspected.values) {
            if (!club || typeof club !== 'object' || Array.isArray(club)) {
                globalInvalid = true;
                continue;
            }
            const clubIds = new Set();
            let invalidClubIdAlias = false;
            let unreadableClubIdScope = false;
            for (const key of ['number', 'clubNumber', 'club_number', 'v_nr', 'clubId']) {
                const inspection = inspectOwn(club, key);
                if (!inspection.ok) {
                    unreadableClubIdScope = true;
                    continue;
                }
                if (!inspection.exists) continue;
                if (!inspection.isData) {
                    invalidClubIdAlias = true;
                    continue;
                }
                const id = safeIdentifier(inspection.descriptor.value);
                if (!id) invalidClubIdAlias = true;
                else clubIds.add(id);
            }
            if (unreadableClubIdScope || !clubIds.size) {
                globalInvalid = true;
                continue;
            }
            if (invalidClubIdAlias || clubIds.size > 1) {
                for (const id of clubIds) invalidClubIds.add(id);
                continue;
            }
            const number = Array.from(clubIds)[0];
            const nameInspection = inspectOwn(club, 'name');
            if (!nameInspection.ok) {
                globalInvalid = true;
                continue;
            }
            if (!nameInspection.exists || !nameInspection.isData) {
                invalidClubIds.add(number);
                continue;
            }
            const clubName = exactTeamLabel(nameInspection.descriptor.value);
            if (!clubName) {
                invalidClubIds.add(number);
                continue;
            }
            if (!namesByClub.has(number)) namesByClub.set(number, new Set());
            namesByClub.get(number).add(clubName);
            validatedClubs.push({ club, number, clubName });
        }
        for (const [number, names] of namesByClub) {
            if (names.size > 1) invalidClubIds.add(number);
        }
        for (const { club, number, clubName } of validatedClubs) {
            if (invalidClubIds.has(number)) continue;
            const teamsInspection = inspectOwn(club, 'teams');
            if (!teamsInspection.ok || (teamsInspection.exists && !teamsInspection.isData)) {
                invalidClubIds.add(number);
                continue;
            }
            const teams = arrayDataValues(
                teamsInspection.isData ? teamsInspection.descriptor.value : undefined,
            );
            if (teamsInspection.exists && !teams.ok) {
                invalidClubIds.add(number);
                continue;
            }
            if (teams.ok && teams.values.length) {
                for (const team of teams.values) {
                    if (typeof team !== 'string') {
                        const explicitClubIds = new Set();
                        let invalidClubIdentity = false;
                        for (const key of ['clubNumber', 'club_number', 'v_nr', 'number', 'clubId']) {
                            const inspection = inspectOwn(team, key);
                            if (!inspection.ok || (inspection.exists && !inspection.isData)) {
                                invalidClubIdentity = true;
                                continue;
                            }
                            if (!inspection.exists) continue;
                            const id = safeIdentifier(inspection.descriptor.value);
                            if (!id) invalidClubIdentity = true;
                            else explicitClubIds.add(id);
                        }
                        if (invalidClubIdentity || explicitClubIds.size > 1
                            || (explicitClubIds.size === 1 && !explicitClubIds.has(number))) {
                            invalidClubIds.add(number);
                            continue;
                        }
                    }
                    const aliases = typeof team === 'string'
                        ? {
                            labels: new Set([exactTeamLabel(team)].filter(Boolean)),
                            ids: new Set(),
                            invalid: !exactTeamLabel(team),
                            ambiguous: false,
                        }
                        : collectTeamAliases(team, true);
                    if (aliases.invalid || aliases.ambiguous || aliases.labels.size !== 1) {
                        invalidClubIds.add(number);
                        continue;
                    }
                    const label = Array.from(aliases.labels)[0];
                    const explicitTeamId = Array.from(aliases.ids)[0] || null;
                    const mapping = {
                        clubId: number,
                        teamId: explicitTeamId || label,
                        teamLabel: label,
                        hasAuthoritativeId: explicitTeamId !== null,
                    };
                    prepared.push({ label, mapping });
                    registerIdentity(mapping);
                }
            } else {
                const mapping = {
                    clubId: number,
                    teamId: number,
                    teamLabel: clubName,
                    hasAuthoritativeId: false,
                };
                prepared.push({ label: clubName, mapping });
                registerIdentity(mapping);
            }
        }
        for (const item of globalInvalid ? [] : prepared) {
            if (invalidClubIds.has(item.mapping.clubId)) continue;
            add(item.label, {
                ...item.mapping,
                multiTeam: identitiesByClub.get(item.mapping.clubId).size > 1,
            });
        }
        return { mappings, invalidClubIds, globalInvalid };
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
        function fields(keys) {
            const values = [];
            for (const key of keys) {
                const inspection = inspectOwn(row, key);
                if (!inspection.ok || (inspection.exists && !inspection.isData)) {
                    return { valid: false, values: [] };
                }
                if (inspection.exists) values.push(inspection.descriptor.value);
            }
            return { valid: true, values };
        }
        function sameScore(scores) {
            return scores.length > 0 && scores.every((score) => (
                score.homeScore === scores[0].homeScore && score.awayScore === scores[0].awayScore
            ));
        }
        const resultFields = fields(['result', 'score', 'ergebnis']);
        const homeFields = fields(['homeScore', 'home_score']);
        const awayFields = fields(['awayScore', 'away_score']);
        if (!resultFields.valid || !homeFields.valid || !awayFields.valid) return null;
        const scores = [];
        for (const result of resultFields.values) {
            if (typeof result !== 'string') return null;
            const match = /^\s*(0|[1-9][0-9]*)\s*:\s*(0|[1-9][0-9]*)\s*$/u.exec(result);
            if (!match) return null;
            const homeScore = parseCanonicalInteger(match[1]);
            const awayScore = parseCanonicalInteger(match[2]);
            if (homeScore === null || awayScore === null) return null;
            scores.push({ homeScore, awayScore });
        }
        const numericFieldsPresent = homeFields.values.length > 0 || awayFields.values.length > 0;
        if (numericFieldsPresent && (!homeFields.values.length || !awayFields.values.length)) return null;
        if (numericFieldsPresent) {
            for (const homeValue of homeFields.values) {
                const homeScore = parseCanonicalInteger(homeValue);
                if (homeScore === null) return null;
                for (const awayValue of awayFields.values) {
                    const awayScore = parseCanonicalInteger(awayValue);
                    if (awayScore === null) return null;
                    scores.push({ homeScore, awayScore });
                }
            }
        }
        return sameScore(scores) ? scores[0] : null;
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

    function normalizedTeamIdentityId(value) {
        if (typeof value !== 'string') return null;
        const compatibilityNormalized = value.normalize('NFKC');
        if (/[\p{Default_Ignorable_Code_Point}\p{Noncharacter_Code_Point}\p{Cc}\p{Cf}\p{Cs}]/u.test(compatibilityNormalized)) {
            return null;
        }
        const normalized = compatibilityNormalized.replace(/\s+/gu, ' ').trim()
            .normalize('NFC').toLocaleLowerCase('de-DE');
        return normalized || null;
    }

    function teamAliasesMatchMapping(aliases, mapping) {
        const mappingId = normalizedTeamIdentityId(mapping.teamId);
        return aliases.present
            && (!mapping.multiTeam || !mapping.hasAuthoritativeId || aliases.ids.size > 0)
            && (!aliases.labels.size || aliases.labels.has(mapping.teamLabel))
            && (!aliases.ids.size || (mapping.hasAuthoritativeId
                && mappingId !== null && aliases.ids.has(mappingId)));
    }

    function participantBucketKey(season, leagueClass, round, mapping) {
        const identity = mapping.multiTeam
            ? [
                mapping.clubId,
                mapping.teamLabel,
                mapping.hasAuthoritativeId ? String(mapping.teamId) : null,
            ]
            : [mapping.clubId];
        return JSON.stringify([season, leagueClass, round, identity]);
    }

    function buildOutcomeParticipantIndex(archiveIndex, mappings, performance) {
        performance.participantIndexBuilds += 1;
        const mappingsByClub = {};
        const seenMappings = new Set();
        for (const mappingList of mappings.values()) {
            for (const mapping of mappingList) {
                const identity = JSON.stringify([
                    mapping.clubId,
                    mapping.teamLabel,
                    mapping.hasAuthoritativeId ? String(mapping.teamId) : null,
                    mapping.multiTeam,
                ]);
                if (seenMappings.has(identity)) continue;
                seenMappings.add(identity);
                if (!ownValue(mappingsByClub, mapping.clubId)) {
                    defineData(mappingsByClub, mapping.clubId, []);
                }
                mappingsByClub[mapping.clubId].push(mapping);
            }
        }

        const buckets = {};
        const bucketPlayerIds = new Map();
        function addParticipant(key, participant) {
            performance.participantInsertAttempts += 1;
            if (!ownValue(buckets, key)) {
                defineData(buckets, key, []);
                bucketPlayerIds.set(key, new Set());
            }
            performance.participantIdentityChecks += 1;
            const identities = bucketPlayerIds.get(key);
            if (identities.has(participant.playerId)) return;
            identities.add(participant.playerId);
            buckets[key].push(participant);
            performance.participantUniqueAdds += 1;
        }

        for (const playerId of ownNames(archiveIndex.histories).sort((a, b) => a.localeCompare(b, 'en'))) {
            const history = ownValue(archiveIndex.histories, playerId) || [];
            for (const record of history) {
                performance.historyRecordsScanned += 1;
                const segments = arrayDataValues(ownValue(record, 'segments'));
                if (!segments.ok) continue;
                for (const segment of segments.values) {
                    performance.historySegmentsScanned += 1;
                    if (record.identityAmbiguous || record.roundOverlapAmbiguous
                        || !segment.previewEligible || !segment.v_nr) continue;
                    const aliases = collectTeamAliases(segment);
                    if (aliases.invalid || aliases.ambiguous) continue;
                    const clubMappings = ownValue(mappingsByClub, segment.v_nr) || [];
                    const matchingMappings = aliases.present
                        ? clubMappings.filter((mapping) => teamAliasesMatchMapping(aliases, mapping))
                        : clubMappings;
                    const applicableMappings = matchingMappings.length === 1
                        ? matchingMappings
                        : [];
                    if (!applicableMappings.length) continue;
                    const rounds = ownValue(segment, 'rounds');
                    for (const roundKey of ownNames(rounds).sort((left, right) => left.localeCompare(right, 'en'))) {
                        const roundDescriptor = ownData(rounds, roundKey);
                        const match = /^R([1-9][0-9]*)$/u.exec(roundKey);
                        if (!roundDescriptor || !roundDescriptor.enumerable || !match) continue;
                        const round = parseCanonicalInteger(match[1]);
                        const value = parseCanonicalInteger(roundDescriptor.value);
                        if (round === null || value === null) continue;
                        for (const mapping of applicableMappings) {
                            addParticipant(
                                participantBucketKey(record.season, segment.leagueClass, round, mapping),
                                { playerId, segment, value },
                            );
                        }
                    }
                }
            }
        }
        for (const key of ownNames(buckets)) {
            buckets[key].sort((left, right) => left.playerId.localeCompare(right.playerId, 'en'));
        }
        return deepFreeze({ buckets });
    }

    function lookupOutcomeParticipants(participantIndex, season, leagueClass, round, mapping, performance) {
        performance.participantLookups += 1;
        return ownValue(
            participantIndex.buckets,
            participantBucketKey(season, leagueClass, round, mapping),
        ) || [];
    }

    function finalizeOutcomeExamples(examples) {
        const result = deepFreeze(examples);
        OUTCOME_EXAMPLE_SETS.add(result);
        return result;
    }

    function seasonIsStrictlyBefore(season, cutoff) {
        const parsedSeason = parseSeason(season);
        const parsedCutoff = parseSeason(cutoff);
        return Boolean(parsedSeason && parsedCutoff && parsedSeason.endYear <= parsedCutoff.startYear);
    }

    function buildOutcomeTrainingExamples(options) {
        const tables = arrayDataValues(ownValue(options, 'archiveTables'));
        const archiveIndex = buildArchiveIndex(ownValue(options, 'archiveData'));
        const clubMapping = clubTeamMappings(ownValue(options, 'clubs'));
        const mappings = clubMapping.mappings;
        const cutoffInspection = inspectOwn(options, 'beforeSeason');
        const cutoffProvided = cutoffInspection.exists;
        const beforeSeason = cutoffInspection.isData
            ? canonicalSeason(cutoffInspection.descriptor.value)
            : null;
        const invalidCutoff = cutoffProvided && beforeSeason === null;
        const diagnostics = {
            rows: 0,
            accepted: 0,
            cutoff: {
                provided: cutoffProvided,
                invalid: invalidCutoff,
                beforeSeason,
            },
            clubMapping: {
                globalInvalid: clubMapping.globalInvalid,
                invalidClubIds: Array.from(clubMapping.invalidClubIds)
                    .sort((left, right) => left.localeCompare(right, 'en')),
                reason: clubMapping.globalInvalid
                    ? 'unreadableClubIdentity'
                    : (clubMapping.invalidClubIds.size ? 'invalidClubIdentity' : null),
            },
            performance: {
                cutoffSnapshots: 0,
                filteredIndexBuilds: 0,
                calibrationBuilds: 0,
                priorCalls: 0,
                participantIndexBuilds: 0,
                historyRecordsScanned: 0,
                historySegmentsScanned: 0,
                participantInsertAttempts: 0,
                participantIdentityChecks: 0,
                participantUniqueAdds: 0,
                participantLookups: 0,
            },
            excluded: {
                malformed: 0,
                teamMapping: 0,
                participants: 0,
                crossSidePlayer: 0,
                duplicate: 0,
                conflictingDuplicate: 0,
                chronology: 0,
                cutoff: 0,
            },
        };
        const examples = [];
        const groupedMatches = new Map();
        if (!tables.ok || invalidCutoff) {
            defineData(examples, 'diagnostics', diagnostics);
            return finalizeOutcomeExamples(examples);
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
                if (beforeSeason && !seasonIsStrictlyBefore(match.season, beforeSeason)) {
                    diagnostics.excluded.cutoff += 1;
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
                const identityKey = [
                    match.season, match.round, match.leagueClass,
                    `${homeMappings[0].clubId}:${homeMappings[0].teamId}`,
                    `${awayMappings[0].clubId}:${awayMappings[0].teamId}`,
                ].join('|');
                const scoreKey = `${match.homeScore}:${match.awayScore}`;
                const existing = groupedMatches.get(identityKey);
                if (existing && existing.scoreKey === scoreKey) {
                    diagnostics.excluded.duplicate += 1;
                    continue;
                }
                if (existing) {
                    if (!existing.conflict) diagnostics.excluded.conflictingDuplicate += 1;
                    existing.conflict = true;
                    continue;
                }
                groupedMatches.set(identityKey, {
                    identityKey,
                    scoreKey,
                    conflict: false,
                    match,
                    homeMapping: homeMappings[0],
                    awayMapping: awayMappings[0],
                });
            }
        }
        const participantIndex = buildOutcomeParticipantIndex(
            archiveIndex, mappings, diagnostics.performance,
        );
        const cutoffSnapshots = new Map();
        function snapshotFor(targetSeason) {
            if (cutoffSnapshots.has(targetSeason)) return cutoffSnapshots.get(targetSeason);
            const earlierIndex = filteredArchiveIndexBefore(archiveIndex, targetSeason);
            diagnostics.performance.filteredIndexBuilds += 1;
            const calibration = buildClassCalibration(earlierIndex);
            diagnostics.performance.calibrationBuilds += 1;
            const snapshot = { archiveIndex: earlierIndex, calibration };
            cutoffSnapshots.set(targetSeason, snapshot);
            diagnostics.performance.cutoffSnapshots += 1;
            return snapshot;
        }
        for (const group of Array.from(groupedMatches.values())
            .sort((left, right) => left.identityKey.localeCompare(right.identityKey, 'en'))) {
                if (group.conflict) continue;
                const { match, homeMapping, awayMapping, identityKey: key } = group;
                const homePlayers = lookupOutcomeParticipants(
                    participantIndex, match.season, match.leagueClass, match.round,
                    homeMapping, diagnostics.performance,
                );
                const awayPlayers = lookupOutcomeParticipants(
                    participantIndex, match.season, match.leagueClass, match.round,
                    awayMapping, diagnostics.performance,
                );
                const homePlayerIds = new Set(homePlayers.map((player) => player.playerId));
                if (awayPlayers.some((player) => homePlayerIds.has(player.playerId))) {
                    diagnostics.excluded.participants += 1;
                    diagnostics.excluded.crossSidePlayer += 1;
                    continue;
                }
                if (homePlayers.length !== 4 || awayPlayers.length !== 4) {
                    diagnostics.excluded.participants += 1;
                    continue;
                }
                const snapshot = snapshotFor(match.season);
                const earlierIndex = snapshot.archiveIndex;
                const earlierCalibration = snapshot.calibration;
                const targetMeanInfo = resolveTargetClassMean(
                    earlierCalibration, match.leagueClass, match.season, undefined,
                );
                const targetMean = targetMeanInfo.mean;
                function scorePlayers(players) {
                    const priors = players.map((player) => {
                        diagnostics.performance.priorCalls += 1;
                        return buildHistoricalPrior({
                            playerId: player.playerId,
                            targetClass: match.leagueClass,
                            archiveIndex: earlierIndex,
                            calibration: earlierCalibration,
                            classMean: targetMean,
                        });
                    });
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
                    homeTeamId: `${homeMapping.clubId}:${homeMapping.teamId}`,
                    awayTeamId: `${awayMapping.clubId}:${awayMapping.teamId}`,
                    homeRating: home.rating,
                    awayRating: away.rating,
                    outcome: match.homeScore > match.awayScore
                        ? 'home'
                        : (match.homeScore < match.awayScore ? 'away' : 'draw'),
                    sourceSeasons,
                    calibrationSeasons: sourceSeasons.slice(),
                    cutoffProvenance: {
                        targetSeason: match.season,
                        strictlyEarlier: true,
                    },
                });
                diagnostics.accepted += 1;
        }
        examples.sort((left, right) => (
            left.season.localeCompare(right.season, 'en')
            || left.round - right.round
            || left.key.localeCompare(right.key, 'en')
        ));
        defineData(examples, 'diagnostics', diagnostics);
        return finalizeOutcomeExamples(examples);
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

    function calibrateOutcomeModel(sourceExamples, options) {
        const inspected = arrayDataValues(sourceExamples);
        const synthetic = ownValue(options, 'synthetic') === true;
        const brandedProductionInput = OUTCOME_EXAMPLE_SETS.has(sourceExamples);
        const cutoffInspection = inspectOwn(options, 'beforeSeason');
        const cutoffProvided = cutoffInspection.exists;
        const beforeSeason = cutoffInspection.isData
            ? canonicalSeason(cutoffInspection.descriptor.value)
            : null;
        const invalidCutoff = cutoffProvided && beforeSeason === null;
        const diagnostics = {
            received: inspected.ok ? inspected.values.length : 0,
            usable: 0,
            excludedUnsafe: 0,
            excludedDuplicate: 0,
            excludedByCutoff: 0,
            excludedKeyless: 0,
            invalidCutoff,
            unbrandedProductionInput: !synthetic && !brandedProductionInput,
            outcomeCounts: { home: 0, draw: 0, away: 0 },
        };
        const examples = [];
        const seen = new Set();
        if (inspected.ok && !invalidCutoff && !diagnostics.unbrandedProductionInput) {
            for (let indexPosition = 0; indexPosition < inspected.values.length; indexPosition += 1) {
                const source = inspected.values[indexPosition];
                const homeRating = safeRating(ownValue(source, 'homeRating'));
                const awayRating = safeRating(ownValue(source, 'awayRating'));
                const outcome = ownValue(source, 'outcome');
                const keyValue = ownValue(source, 'key');
                const hasKey = typeof keyValue === 'string' && keyValue.length > 0;
                const key = hasKey ? keyValue : `synthetic:${indexPosition}`;
                if (!synthetic && !hasKey) {
                    diagnostics.excludedKeyless += 1;
                    continue;
                }
                if (beforeSeason) {
                    const season = canonicalSeason(ownValue(source, 'season'));
                    if (!season || !seasonIsStrictlyBefore(season, beforeSeason)) {
                        diagnostics.excludedByCutoff += 1;
                        continue;
                    }
                }
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
            return {
                valid: false,
                score: NEUTRAL_FALLBACK_RATING,
                confidence: 'very-low',
                uncertainty: 0.5,
                provenance: [],
            };
        }
        const ratings = [];
        const confidences = [];
        const provenance = [];
        let uncertainty = 0;
        const uncertaintyByConfidence = { high: 0.04, medium: 0.1, provisional: 0.2, 'very-low': 0.32 };
        for (const slot of inspected.values) {
            const adjusted = safePositiveModelRating(ownValue(slot, 'adjustedRating'));
            const rating = adjusted === null
                ? safePositiveModelRating(ownValue(slot, 'rating'))
                : adjusted;
            const confidenceValue = ownValue(slot, 'confidence');
            const confidence = CONFIDENCE_ORDER.includes(confidenceValue) ? confidenceValue : 'very-low';
            const evidenceValue = ownValue(slot, 'evidence');
            const evidence = Object.prototype.hasOwnProperty.call(EVIDENCE_ORDER, evidenceValue)
                ? evidenceValue
                : 'neutral';
            if (rating === null) {
                return {
                    valid: false,
                    score: NEUTRAL_FALLBACK_RATING,
                    confidence: 'very-low',
                    uncertainty: 0.5,
                    provenance: [],
                };
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
        MAX_MODEL_RATING,
        NEUTRAL_FALLBACK_RATING,
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
