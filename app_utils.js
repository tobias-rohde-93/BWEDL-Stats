(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.BwedlAppUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
    const ROUTES = new Set([
        'dashboard',
        'profile',
        'league',
        'ligapokalArchive',
        'ranking',
        'club',
        'clubList',
        'comparison',
        'alltime',
        'tools',
        'matchPreview',
        'wiki',
    ]);
    const ROUTES_WITH_ID = new Set(['league', 'ligapokalArchive', 'ranking', 'club']);
    const BERLIN_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Berlin',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    });

    function isByeOpponent(value) {
        if (typeof value !== 'string') return false;
        const normalized = value
            .normalize('NFKC')
            .replace(/\u00a0/g, ' ')
            .toLocaleLowerCase('de-DE')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!normalized) return true;
        return /\b(?:spielfrei|freilos|bye)\b/.test(normalized) ||
            /^(?:kein(?:e[rs]?)?|ohne) gegner$/.test(normalized) ||
            /^(?:tbd|n n|offen|unbekannt)$/.test(normalized);
    }

    function validDateParts(year, month, day, hours, minutes) {
        const value = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));
        return value.getUTCFullYear() === year &&
            value.getUTCMonth() === month - 1 &&
            value.getUTCDate() === day &&
            value.getUTCHours() === hours &&
            value.getUTCMinutes() === minutes;
    }

    function berlinParts(date) {
        const parts = {};
        BERLIN_DATE_FORMATTER.formatToParts(date).forEach((part) => {
            if (part.type !== 'literal') parts[part.type] = Number(part.value);
        });
        return parts;
    }

    function parsedDate(value, hasTime, parts) {
        const dateParts = parts || berlinParts(value);
        return {
            value,
            hasTime,
            year: dateParts.year,
            month: dateParts.month,
            day: dateParts.day,
            dayKey: dateParts.year * 10000 + dateParts.month * 100 + dateParts.day,
        };
    }

    function berlinDateTime(year, month, day, hours, minutes) {
        const target = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
        let instant = target;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const shown = berlinParts(new Date(instant));
            const shownAsUtc = Date.UTC(
                shown.year,
                shown.month - 1,
                shown.day,
                shown.hour,
                shown.minute,
                shown.second,
            );
            instant = target - (shownAsUtc - instant);
        }
        const value = new Date(instant);
        const shown = berlinParts(value);
        if (
            shown.year !== year || shown.month !== month || shown.day !== day ||
            shown.hour !== hours || shown.minute !== minutes
        ) return null;
        return value;
    }

    function parseDateValue(value) {
        if (value instanceof Date) {
            if (!Number.isFinite(value.getTime())) return null;
            return parsedDate(new Date(value.getTime()), true);
        }
        if (typeof value === 'number') {
            const date = new Date(value);
            return Number.isFinite(date.getTime()) ? parsedDate(date, true) : null;
        }
        if (typeof value !== 'string' || !value.trim()) return null;

        const source = value.trim();
        const german = source.match(
            /(?:^|\s)(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2}))?(?:\s|$)/,
        );
        if (german) {
            const year = Number(german[3].length === 2 ? `20${german[3]}` : german[3]);
            const month = Number(german[2]);
            const day = Number(german[1]);
            const hours = german[4] === undefined ? 0 : Number(german[4]);
            const minutes = german[5] === undefined ? 0 : Number(german[5]);
            if (!validDateParts(year, month, day, hours, minutes)) return null;
            const parts = { year, month, day };
            if (german[4] === undefined) {
                return parsedDate(new Date(Date.UTC(year, month - 1, day)), false, parts);
            }
            const date = berlinDateTime(year, month, day, hours, minutes);
            return date ? parsedDate(date, true, parts) : null;
        }

        const isoDateOnly = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoDateOnly) {
            const year = Number(isoDateOnly[1]);
            const month = Number(isoDateOnly[2]);
            const day = Number(isoDateOnly[3]);
            if (!validDateParts(year, month, day, 0, 0)) return null;
            return parsedDate(
                new Date(Date.UTC(year, month - 1, day)),
                false,
                { year, month, day },
            );
        }

        const explicitIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
        if (!explicitIso.test(source)) return null;
        const date = new Date(source);
        return Number.isFinite(date.getTime()) ? parsedDate(date, true) : null;
    }

    function gameDate(game) {
        if (!game || typeof game !== 'object') return null;
        const parsed = parseDateValue(game.dateStr) || parseDateValue(game.date);
        if (!parsed) return null;
        if (game.dateOnly === true || game.hasTime === false) parsed.hasTime = false;
        return parsed;
    }

    function isFinished(game) {
        if (game.isPending === false || game.played === true) return true;
        if (Number.isFinite(game.scoreHome) && Number.isFinite(game.scoreAway)) return true;
        return typeof game.score === 'string' && /^\s*\d+\s*:\s*\d+\s*$/.test(game.score);
    }

    function selectUpcomingGames(schedule, now) {
        if (!Array.isArray(schedule)) return [];
        const reference = parseDateValue(now) || parseDateValue(new Date());

        return schedule
            .map((game, index) => ({ game, index, parsed: gameDate(game) }))
            .filter(({ game, parsed }) => {
                if (!game || typeof game !== 'object' || isFinished(game)) return false;
                if (
                    isByeOpponent(game.opponent) ||
                    isByeOpponent(game.home) ||
                    isByeOpponent(game.away)
                ) return false;
                if (!parsed) return true;
                return parsed.hasTime
                    ? parsed.value >= reference.value
                    : parsed.dayKey >= reference.dayKey;
            })
            .sort((left, right) => {
                if (!left.parsed && !right.parsed) return left.index - right.index;
                if (!left.parsed) return 1;
                if (!right.parsed) return -1;

                const dayDifference = left.parsed.dayKey - right.parsed.dayKey;
                if (dayDifference !== 0) return dayDifference;
                if (left.parsed.hasTime !== right.parsed.hasTime) {
                    return left.parsed.hasTime ? -1 : 1;
                }
                const timeDifference = left.parsed.value - right.parsed.value;
                return timeDifference || left.index - right.index;
            })
            .map(({ game }) => game);
    }

    function buildSeasonNotice(status) {
        if (!status || typeof status !== 'object') return null;
        const season = typeof status.season === 'string' ? status.season.trim() : '';
        if (!season) return null;

        if (status.state === 'retained') {
            return {
                state: 'retained',
                season,
                title: `Vorjahresstand ${season}`,
                message: `Vorjahresstand ${season} – die neue Rangliste wird erst nach vollständigem Saisonstart aktiviert.`,
            };
        }
        if (status.state === 'published' || status.state === 'current') {
            return {
                state: 'published',
                season,
                title: `Saison ${season}`,
                message: `Aktueller Stand ${season}.`,
            };
        }
        return null;
    }

    function escapeIcsText(value) {
        return String(value == null ? '' : value)
            .replace(/\\/g, '\\\\')
            .replace(/\r\n|\r|\n/g, '\\n')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,');
    }

    function formatDateOnly(parsed) {
        const pad = (value) => String(value).padStart(2, '0');
        return `${parsed.year}${pad(parsed.month)}${pad(parsed.day)}`;
    }

    function formatUtcDate(date) {
        return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    }

    function stableHash(value) {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index += 1) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function utf8Bytes(character) {
        const codePoint = character.codePointAt(0);
        if (codePoint <= 0x7f) return 1;
        if (codePoint <= 0x7ff) return 2;
        if (codePoint <= 0xffff) return 3;
        return 4;
    }

    function foldIcsLine(line) {
        let folded = '';
        let current = '';
        let currentBytes = 0;
        for (const character of line) {
            const characterBytes = utf8Bytes(character);
            if (current && currentBytes + characterBytes > 75) {
                folded += `${current}\r\n`;
                current = ` ${character}`;
                currentBytes = 1 + characterBytes;
            } else {
                current += character;
                currentBytes += characterBytes;
            }
        }
        return folded + current;
    }

    function buildIcsContent(game) {
        if (!game || typeof game !== 'object') return '';
        const start = gameDate(game);
        if (!start) return '';

        const home = typeof game.home === 'string' ? game.home.trim() : '';
        const away = typeof game.away === 'string' ? game.away.trim() : '';
        const summary = game.summary || [home, away].filter(Boolean).join(' - ') || 'BWEDL-Spiel';
        const competition = game.competition || game.league || game.leagueKey || '';
        const location = game.location || game.address || '';
        const rawUid = game.uid || stableHash([
            start.hasTime ? formatUtcDate(start.value) : formatDateOnly(start),
            summary,
            competition,
        ].join('|'));
        const uid = escapeIcsText(String(rawUid).replace(/@/g, '-'));
        const lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//BWEDL Stats//DE',
            'CALSCALE:GREGORIAN',
            'BEGIN:VEVENT',
            `UID:${uid}@bwedl-stats`,
            `DTSTAMP:${formatUtcDate(start.value)}`,
        ];

        if (start.hasTime) {
            const explicitEnd = parseDateValue(game.endDate || game.end || game.dateEnd);
            const end = explicitEnd && explicitEnd.hasTime && explicitEnd.value > start.value
                ? explicitEnd.value
                : new Date(start.value.getTime() + 3 * 60 * 60 * 1000);
            lines.push(`DTSTART:${formatUtcDate(start.value)}`);
            lines.push(`DTEND:${formatUtcDate(end)}`);
        } else {
            const endValue = new Date(Date.UTC(start.year, start.month - 1, start.day + 1));
            const end = parsedDate(endValue, false, {
                year: endValue.getUTCFullYear(),
                month: endValue.getUTCMonth() + 1,
                day: endValue.getUTCDate(),
            });
            lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(start)}`);
            lines.push(`DTEND;VALUE=DATE:${formatDateOnly(end)}`);
        }

        lines.push(`SUMMARY:${escapeIcsText(summary)}`);
        if (competition) lines.push(`DESCRIPTION:${escapeIcsText(competition)}`);
        if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
        lines.push('END:VEVENT', 'END:VCALENDAR', '');
        return lines.map(foldIcsLine).join('\r\n');
    }

    function fallbackRoute() {
        return { type: 'dashboard', id: null };
    }

    function parseAppHash(hash, routeExists) {
        if (typeof hash !== 'string') return fallbackRoute();
        const source = hash.replace(/^#/, '');
        if (!source) return fallbackRoute();

        const separator = source.indexOf('/');
        const type = separator === -1 ? source : source.slice(0, separator);
        const encodedId = separator === -1 ? '' : source.slice(separator + 1);
        if (!ROUTES.has(type)) return fallbackRoute();

        let id = null;
        try {
            id = encodedId ? decodeURIComponent(encodedId) : null;
        } catch (_error) {
            return fallbackRoute();
        }
        if (id && (/\p{C}/u.test(id) || id.length > 256)) return fallbackRoute();
        if (ROUTES_WITH_ID.has(type) !== Boolean(id)) return fallbackRoute();

        if (typeof routeExists === 'function') {
            try {
                if (!routeExists(type, id)) return fallbackRoute();
            } catch (_error) {
                return fallbackRoute();
            }
        }
        return { type, id };
    }

    function stableSerialize(value) {
        if (value === undefined) return 'undefined';
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
        return `{${Object.keys(value).sort().map((key) => (
            `${JSON.stringify(key)}:${stableSerialize(value[key])}`
        )).join(',')}}`;
    }

    function normalizeSnapshotValue(value) {
        if (value instanceof Date) {
            return Number.isFinite(value.getTime()) ? value.toISOString() : null;
        }
        if (Array.isArray(value)) return value.map(normalizeSnapshotValue);
        if (value && typeof value === 'object') {
            return Object.keys(value).sort().reduce((normalized, key) => {
                normalized[key] = normalizeSnapshotValue(value[key]);
                return normalized;
            }, {});
        }
        return value;
    }

    function firstDefined(object, paths) {
        for (const path of paths) {
            let value = object;
            for (const key of path) value = value && value[key];
            if (value !== undefined) return value;
        }
        return undefined;
    }

    function diffVisitSnapshots(previous, current) {
        if (
            !previous || typeof previous !== 'object' || Array.isArray(previous) ||
            !current || typeof current !== 'object' || Array.isArray(current)
        ) return [];

        const changes = [];
        const rankBefore = firstDefined(previous, [['rank'], ['ranking', 'rank'], ['ranking', 'position']]);
        const rankNow = firstDefined(current, [['rank'], ['ranking', 'rank'], ['ranking', 'position']]);
        if (rankBefore !== rankNow) changes.push({ type: 'rank', previous: rankBefore, current: rankNow });

        const pointsBefore = firstDefined(previous, [['points'], ['ranking', 'points']]);
        const pointsNow = firstDefined(current, [['points'], ['ranking', 'points']]);
        if (pointsBefore !== pointsNow) {
            changes.push({ type: 'points', previous: pointsBefore, current: pointsNow });
        }

        const resultsBefore = firstDefined(previous, [['resultCounts'], ['teamResults'], ['results']]) || {};
        const resultsNow = firstDefined(current, [['resultCounts'], ['teamResults'], ['results']]) || {};
        const resultKeys = Array.from(new Set([
            ...Object.keys(resultsBefore),
            ...Object.keys(resultsNow),
        ])).sort();
        resultKeys.forEach((key) => {
            if (resultsBefore[key] !== resultsNow[key]) {
                changes.push({
                    type: 'results',
                    key,
                    previous: resultsBefore[key],
                    current: resultsNow[key],
                });
            }
        });

        const previousNextGame = normalizeSnapshotValue(previous.nextGame);
        const currentNextGame = normalizeSnapshotValue(current.nextGame);
        if (stableSerialize(previousNextGame) !== stableSerialize(currentNextGame)) {
            changes.push({
                type: 'nextGame',
                previous: previousNextGame,
                current: currentNextGame,
            });
        }

        const dataBefore = firstDefined(previous, [['dataVersion'], ['updatedAt'], ['updated_at']]);
        const dataNow = firstDefined(current, [['dataVersion'], ['updatedAt'], ['updated_at']]);
        if (dataBefore !== dataNow) {
            changes.push({ type: 'data', previous: dataBefore, current: dataNow });
        }
        return changes;
    }

    return {
        isByeOpponent,
        selectUpcomingGames,
        buildSeasonNotice,
        buildIcsContent,
        parseAppHash,
        diffVisitSnapshots,
    };
});
