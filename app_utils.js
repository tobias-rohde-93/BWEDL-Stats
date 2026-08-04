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

    function validDate(year, month, day, hours, minutes) {
        const value = new Date(year, month - 1, day, hours, minutes, 0, 0);
        if (
            value.getFullYear() !== year ||
            value.getMonth() !== month - 1 ||
            value.getDate() !== day ||
            value.getHours() !== hours ||
            value.getMinutes() !== minutes
        ) return null;
        return value;
    }

    function parseDateValue(value) {
        if (value instanceof Date) {
            if (!Number.isFinite(value.getTime())) return null;
            return { value: new Date(value.getTime()), hasTime: true };
        }
        if (typeof value === 'number') {
            const date = new Date(value);
            return Number.isFinite(date.getTime()) ? { value: date, hasTime: true } : null;
        }
        if (typeof value !== 'string' || !value.trim()) return null;

        const source = value.trim();
        const german = source.match(
            /(?:^|\s)(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2}))?(?:\s|$)/,
        );
        if (german) {
            const year = Number(german[3].length === 2 ? `20${german[3]}` : german[3]);
            const hours = german[4] === undefined ? 0 : Number(german[4]);
            const minutes = german[5] === undefined ? 0 : Number(german[5]);
            const date = validDate(year, Number(german[2]), Number(german[1]), hours, minutes);
            return date ? { value: date, hasTime: german[4] !== undefined } : null;
        }

        const isoDateOnly = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoDateOnly) {
            const date = validDate(
                Number(isoDateOnly[1]),
                Number(isoDateOnly[2]),
                Number(isoDateOnly[3]),
                0,
                0,
            );
            return date ? { value: date, hasTime: false } : null;
        }

        const date = new Date(source);
        return Number.isFinite(date.getTime()) ? { value: date, hasTime: true } : null;
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
        const reference = parseDateValue(now) || { value: new Date(), hasTime: true };
        const startOfToday = new Date(reference.value.getTime());
        startOfToday.setHours(0, 0, 0, 0);

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
                    : parsed.value >= startOfToday;
            })
            .sort((left, right) => {
                if (!left.parsed && !right.parsed) return left.index - right.index;
                if (!left.parsed) return 1;
                if (!right.parsed) return -1;

                const leftDay = new Date(left.parsed.value.getTime());
                const rightDay = new Date(right.parsed.value.getTime());
                leftDay.setHours(0, 0, 0, 0);
                rightDay.setHours(0, 0, 0, 0);
                const dayDifference = leftDay - rightDay;
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

    function formatLocalDate(date, includeTime) {
        const pad = (value) => String(value).padStart(2, '0');
        const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
        return includeTime
            ? `${day}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
            : day;
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
            formatLocalDate(start.value, start.hasTime),
            summary,
            competition,
        ].join('|'));
        const uid = String(rawUid).replace(/[\r\n@]+/g, '-');
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
            const end = explicitEnd && explicitEnd.value > start.value
                ? explicitEnd.value
                : new Date(start.value.getTime() + 3 * 60 * 60 * 1000);
            lines.push(`DTSTART;TZID=Europe/Berlin:${formatLocalDate(start.value, true)}`);
            lines.push(`DTEND;TZID=Europe/Berlin:${formatLocalDate(end, true)}`);
        } else {
            const end = new Date(start.value.getTime());
            end.setDate(end.getDate() + 1);
            lines.push(`DTSTART;VALUE=DATE:${formatLocalDate(start.value, false)}`);
            lines.push(`DTEND;VALUE=DATE:${formatLocalDate(end, false)}`);
        }

        lines.push(`SUMMARY:${escapeIcsText(summary)}`);
        if (competition) lines.push(`DESCRIPTION:${escapeIcsText(competition)}`);
        if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
        lines.push('END:VEVENT', 'END:VCALENDAR', '');
        return lines.join('\r\n');
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

        if (stableSerialize(previous.nextGame) !== stableSerialize(current.nextGame)) {
            changes.push({
                type: 'nextGame',
                previous: previous.nextGame,
                current: current.nextGame,
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
