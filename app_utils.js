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

    async function probePublishedData(fetchImpl, baseUri, nowValue) {
        if (typeof fetchImpl !== 'function') {
            throw new TypeError('A fetch implementation is required');
        }
        const statusUrl = new URL('data_status.json', baseUri);
        statusUrl.searchParams.set('t', String(nowValue));
        const response = await fetchImpl(statusUrl.toString(), {
            cache: 'no-store',
            credentials: 'omit',
            headers: { Accept: 'application/json' },
        });
        if (!response || response.ok !== true) {
            const status = response && Number.isFinite(response.status)
                ? response.status
                : 'unbekannt';
            throw new Error(`Öffentlicher Datenstand nicht erreichbar (${status})`);
        }
        const payload = await response.json();
        if (
            !payload || typeof payload !== 'object' || Array.isArray(payload) ||
            !payload.domains || typeof payload.domains !== 'object' ||
            Array.isArray(payload.domains)
        ) {
            throw new Error('Öffentlicher Datenstatus ist ungültig');
        }
        return payload;
    }

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

    function matchPreviewGameKey(game) {
        if (!game || typeof game !== 'object') return '';
        const normalize = (value) => String(value || '')
            .normalize('NFKC')
            .replace(/\s+/gu, ' ')
            .trim()
            .toLocaleLowerCase('de-DE');
        const league = normalize(game.league || game.leagueName || game.leagueKey);
        const home = normalize(game.home);
        const away = normalize(game.away);
        if (!league || !home || !away) return '';
        const parsed = gameDate(game);
        const date = parsed
            ? `${parsed.dayKey}:${parsed.hasTime ? parsed.value.getTime() : 'date-only'}`
            : normalize(game.dateStr || game.date);
        return [league, home, away, date].join('|');
    }

    function mergeMatchPreviewGames(selectedGame, detectedGames) {
        const games = [
            ...(selectedGame && typeof selectedGame === 'object' ? [selectedGame] : []),
            ...(Array.isArray(detectedGames) ? detectedGames : []),
        ];
        const seen = new Set();
        return games.filter((game) => {
            const key = matchPreviewGameKey(game);
            if (!key) return true;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function buildLigapokalArchiveEntries(archiveTables) {
        if (!Array.isArray(archiveTables)) return {};
        return archiveTables.reduce((entries, table) => {
            if (!table || typeof table !== 'object' || !Array.isArray(table.rows) || table.rows.length < 2) {
                return entries;
            }
            const league = String(table.league || '').toLocaleLowerCase('de-DE');
            if (!league.includes('ligapokal') && !league.includes('liga-pokal')) return entries;
            const season = String(table.season || '').trim().replace('/', '-');
            if (!/^\d{4}-\d{4}$/.test(season)) return entries;
            const label = `Ligapokal ${season}`;
            if (!entries[label]) entries[label] = { tables: [], isCup: true };
            entries[label].tables.push(table);
            return entries;
        }, {});
    }

    function buildMatchPreviewTeams(players, tableTeams, clubs) {
        const normalize = (value) => String(value || '')
            .normalize('NFKC')
            .replace(/\u00a0/gu, ' ')
            .replace(/[^\p{L}\p{N}]+/gu, '')
            .toLocaleLowerCase('de-DE');
        const validTableTeams = (Array.isArray(tableTeams) ? tableTeams : [])
            .map((name) => String(name || '').replace(/\u00a0/gu, ' ').replace(/\s+/gu, ' ').trim())
            .filter((name) => (
                name && !/^(?:tabelle|team|mannschaft)$/iu.test(name) && !isByeOpponent(name)
            ));
        const clubList = Array.isArray(clubs) ? clubs : [];
        const teams = new Map();

        (Array.isArray(players) ? players : []).forEach((player) => {
            if (!player || typeof player !== 'object') return;
            let id = '';
            let name = '';
            if (player.v_nr !== null && player.v_nr !== undefined && String(player.v_nr).trim()) {
                id = String(player.v_nr).trim();
                const club = clubList.find((candidate) => (
                    candidate && String(candidate.number) === id
                ));
                name = String((club && club.name) || player.company || '').trim();
            } else if (player.company) {
                name = String(player.company).trim();
                id = `NAME:${name}`;
            }
            if (!id || !name || teams.has(id)) return;
            const normalizedName = normalize(name);
            const exactTableName = validTableTeams.find((candidate) => (
                normalize(candidate) === normalizedName
            ));
            const fuzzyTableName = validTableTeams.find((candidate) => {
                const normalizedCandidate = normalize(candidate);
                return normalizedCandidate.includes(normalizedName) || normalizedName.includes(normalizedCandidate);
            });
            teams.set(id, exactTableName || fuzzyTableName || name);
        });

        const knownNames = new Set(Array.from(teams.values(), normalize));
        validTableTeams.forEach((name) => {
            const normalizedName = normalize(name);
            if (!normalizedName || knownNames.has(normalizedName)) return;
            const club = clubList.find((candidate) => (
                candidate && normalize(candidate.name) === normalizedName
            ));
            const id = club && String(club.number || '').trim()
                ? String(club.number).trim()
                : `NAME:${name}`;
            if (!teams.has(id)) teams.set(id, name);
            knownNames.add(normalizedName);
        });

        return Array.from(teams, ([id, name]) => ({ id, name }))
            .sort((left, right) => left.name.localeCompare(right.name, 'de-DE'));
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

    function rankingNumber(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function rankingClubNumber(value) {
        if (value === null || value === undefined) return '';
        return String(value).trim();
    }

    function enrichRankingPlayersWithClubs(players, clubs) {
        if (!Array.isArray(players)) return [];
        const byNumber = new Map();
        if (Array.isArray(clubs)) {
            clubs.forEach((club, index) => {
                if (!club || typeof club !== 'object') return;
                const number = rankingClubNumber(club.number);
                const name = String(club.name || '').trim();
                if (!number || !name) return;
                const current = byNumber.get(number);
                if (current) {
                    current.ambiguous = true;
                } else {
                    byNumber.set(number, { name, index, ambiguous: false });
                }
            });
        }
        return players.map((player) => {
            if (!player || typeof player !== 'object') return player;
            const enriched = { ...player };
            const club = byNumber.get(rankingClubNumber(player.v_nr));
            if (club && !club.ambiguous) {
                enriched.clubName = club.name;
                enriched.clubIndex = club.index;
            }
            return enriched;
        });
    }

    function canonicalRankingPlayerName(value) {
        return String(value == null ? '' : value)
            .normalize('NFKC')
            .replace(/\s+/gu, ' ')
            .trim()
            .toLocaleLowerCase('de-DE');
    }

    function matchRankingPlayer(players, savedName) {
        const canonical = canonicalRankingPlayerName(savedName);
        if (!canonical || !Array.isArray(players)) return { status: 'missing', player: null };
        const matches = players.filter((player) => (
            player && canonicalRankingPlayerName(player.name) === canonical
        ));
        if (matches.length === 1) return { status: 'found', player: matches[0] };
        return { status: matches.length > 1 ? 'ambiguous' : 'missing', player: null };
    }

    function filterAndSortRanking(players, options) {
        if (!Array.isArray(players)) return [];
        const settings = options && typeof options === 'object' ? options : {};
        const query = String(settings.query || '').trim().toLocaleLowerCase('de-DE');
        const minGames = Math.max(0, rankingNumber(settings.minGames, 0));
        const sort = ['points', 'average', 'games'].includes(settings.sort)
            ? settings.sort
            : 'official';
        const metric = {
            points: 'totalPoints',
            average: 'average',
            games: 'games',
        }[sort];

        return players
            .map((player, index) => ({ player, index }))
            .filter(({ player }) => {
                if (!player || typeof player !== 'object') return false;
                if (rankingNumber(player.games, 0) < minGames) return false;
                if (!query) return true;
                return [player.name, player.company, player.team, player.clubName]
                    .some((value) => String(value || '').toLocaleLowerCase('de-DE').includes(query));
            })
            .sort((left, right) => {
                if (metric) {
                    const difference = rankingNumber(right.player[metric], 0) -
                        rankingNumber(left.player[metric], 0);
                    if (difference) return difference;
                }
                const officialDifference = rankingNumber(
                    left.player.officialSortRank,
                    rankingNumber(left.player.officialRank, Infinity),
                ) - rankingNumber(
                    right.player.officialSortRank,
                    rankingNumber(right.player.officialRank, Infinity),
                );
                return officialDifference || left.index - right.index;
            })
            .map(({ player }) => player);
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

    const VISIT_SNAPSHOT_VERSION = 2;
    const VISIT_SNAPSHOT_STORAGE_KEY = 'bwedl_visit_snapshot';

    function snapshotText(value) {
        if (value === null || value === undefined) return null;
        const text = String(value).trim();
        return text || null;
    }

    function snapshotNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function snapshotDate(value) {
        if (!value) return null;
        const date = value instanceof Date ? value : new Date(value);
        return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    }

    function buildTeamResultsFingerprint(games) {
        if (!Array.isArray(games)) return '[]';
        const completedResults = games
            .filter((game) => game && (game.isPending === false || game.played === true))
            .map((game) => [
                snapshotText(game.leagueKey || game.leagueName || game.competition),
                snapshotDate(game.date) || snapshotText(game.dateStr),
                snapshotText(game.home),
                snapshotText(game.away),
                snapshotText(game.id || game.round),
                snapshotText(game.score || (
                    game.scoreHome !== undefined && game.scoreAway !== undefined
                        ? `${game.scoreHome}:${game.scoreAway}`
                        : null
                )),
            ])
            .sort((left, right) => stableSerialize(left).localeCompare(stableSerialize(right)));
        return stableSerialize(completedResults);
    }

    function buildVisitSnapshot({ data = {}, player = null, team = null, nextGame = null } = {}) {
        const timestamps = ['leagues', 'rankings', 'clubs', 'archives'].reduce((result, domain) => {
            const timestamp = snapshotDate(data.timestamps && data.timestamps[domain]);
            if (timestamp) result[domain] = timestamp;
            return result;
        }, {});
        const snapshot = {
            version: VISIT_SNAPSHOT_VERSION,
            data: {
                key: snapshotText(data.key),
                timestamps,
                updatedAt: snapshotDate(data.updatedAt) || snapshotText(data.updatedAt),
            },
            player: player ? {
                canonicalName: snapshotText(player.canonicalName),
                displayName: snapshotText(player.displayName),
                rank: snapshotNumber(player.rank),
                points: snapshotNumber(player.points),
                rankingClass: snapshotText(player.rankingClass),
                sourceSeason: snapshotText(player.sourceSeason),
                sourceState: snapshotText(player.sourceState),
                sourceKey: snapshotText(player.sourceKey),
            } : null,
            team: team ? {
                id: snapshotText(team.id),
                name: snapshotText(team.name),
                resultCount: snapshotNumber(team.resultCount),
                resultFingerprint: snapshotText(team.resultFingerprint),
                sourceSeason: snapshotText(team.sourceSeason),
                sourceState: snapshotText(team.sourceState),
                sourceKey: snapshotText(team.sourceKey),
            } : null,
            nextGame: nextGame ? {
                key: snapshotText(nextGame.key),
                date: snapshotDate(nextGame.date),
                opponent: snapshotText(nextGame.opponent),
                location: snapshotText(nextGame.location),
            } : null,
        };
        return normalizeSnapshotValue(snapshot);
    }

    function isVisitSnapshot(value) {
        return Boolean(
            value && typeof value === 'object' && !Array.isArray(value) &&
            value.version === VISIT_SNAPSHOT_VERSION &&
            value.data && typeof value.data === 'object' &&
            (value.player === null || typeof value.player === 'object') &&
            (value.team === null || typeof value.team === 'object') &&
            (value.nextGame === null || typeof value.nextGame === 'object')
        );
    }

    function readVisitSnapshot(storage, key = VISIT_SNAPSHOT_STORAGE_KEY) {
        try {
            const raw = storage && storage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return isVisitSnapshot(parsed) ? buildVisitSnapshot(parsed) : null;
        } catch (_error) {
            return null;
        }
    }

    function persistVisitSnapshot(storage, snapshot, key = VISIT_SNAPSHOT_STORAGE_KEY) {
        try {
            if (!isVisitSnapshot(snapshot)) return false;
            storage.setItem(key, JSON.stringify(buildVisitSnapshot(snapshot)));
            return true;
        } catch (_error) {
            return false;
        }
    }

    function sameSnapshotIdentity(previous, current, field, key) {
        const before = previous[field];
        const now = current[field];
        if (!before && !now) return true;
        return Boolean(before && now && before[key] && before[key] === now[key]);
    }

    function diffVersionedVisitSnapshots(previous, current) {
        if (!isVisitSnapshot(previous) || !isVisitSnapshot(current)) return [];

        const changes = [];
        const timestampKeys = Array.from(new Set([
            ...Object.keys(previous.data.timestamps || {}),
            ...Object.keys(current.data.timestamps || {}),
        ])).sort();
        const hasNewerDomainTimestamp = timestampKeys.some((key) => {
            const before = Date.parse((previous.data.timestamps || {})[key] || '');
            const now = Date.parse((current.data.timestamps || {})[key] || '');
            return Number.isFinite(before) && Number.isFinite(now) && now > before;
        });
        const beforeTime = Date.parse(previous.data.updatedAt || '');
        const currentTime = Date.parse(current.data.updatedAt || '');
        const hasNewerSummaryTimestamp = Number.isFinite(beforeTime) &&
            Number.isFinite(currentTime) && currentTime > beforeTime;
        const hasNewerData = (
            previous.data.key !== current.data.key &&
            (hasNewerDomainTimestamp || hasNewerSummaryTimestamp)
        );

        const samePlayer = sameSnapshotIdentity(previous, current, 'player', 'canonicalName');
        const sameRankingSource = samePlayer && previous.player && current.player &&
            previous.player.sourceKey && previous.player.sourceKey === current.player.sourceKey &&
            previous.player.sourceSeason === current.player.sourceSeason &&
            previous.player.sourceState === current.player.sourceState &&
            previous.player.rankingClass === current.player.rankingClass;
        if (sameRankingSource && previous.player.rank !== current.player.rank) {
            changes.push({
                type: 'rank',
                message: `Dein Rang in der Saison ${current.player.sourceSeason}: ${previous.player.rank} → ${current.player.rank}.`,
            });
        }
        if (sameRankingSource && previous.player.points !== current.player.points) {
            changes.push({
                type: 'points',
                message: `Deine Punkte in der Saison ${current.player.sourceSeason}: ${previous.player.points} → ${current.player.points}.`,
            });
        }

        const sameTeam = sameSnapshotIdentity(previous, current, 'team', 'id');
        const sameTeamSource = sameTeam && previous.team && current.team &&
            previous.team.sourceKey && previous.team.sourceKey === current.team.sourceKey &&
            previous.team.sourceSeason === current.team.sourceSeason &&
            previous.team.sourceState === current.team.sourceState;
        if (sameTeamSource &&
            previous.team.resultCount !== current.team.resultCount) {
            const difference = current.team.resultCount - previous.team.resultCount;
            const message = difference > 0
                ? `Für ${current.team.name} ${difference === 1 ? 'liegt 1 neues Ergebnis' : `liegen ${difference} neue Ergebnisse`} vor.`
                : `Der Ergebnisstand für ${current.team.name} wurde korrigiert.`;
            changes.push({ type: 'results', message });
        } else if (sameTeamSource &&
            previous.team.resultFingerprint !== current.team.resultFingerprint) {
            changes.push({
                type: 'results',
                message: `Ergebnisse für ${current.team.name} wurden aktualisiert.`,
            });
        }

        if (sameTeamSource && !previous.nextGame && current.nextGame) {
            changes.push({
                type: 'nextGame',
                message: `Nächstes Spiel gegen ${current.nextGame.opponent} angesetzt.`,
            });
        } else if (sameTeamSource && previous.nextGame && !current.nextGame) {
            changes.push({
                type: 'nextGame',
                message: 'Dein nächstes Spiel wurde abgesagt oder entfernt.',
            });
        } else if (sameTeamSource && previous.nextGame && current.nextGame) {
            const sameGame = previous.nextGame.key && previous.nextGame.key === current.nextGame.key;
            const gameDetailsChanged = previous.nextGame.date !== current.nextGame.date ||
                previous.nextGame.location !== current.nextGame.location ||
                previous.nextGame.opponent !== current.nextGame.opponent;
            if (sameGame && gameDetailsChanged) {
                changes.push({
                    type: 'nextGame',
                    message: `Dein nächstes Spiel gegen ${current.nextGame.opponent} wurde neu terminiert.`,
                });
            } else if (!sameGame && stableSerialize(previous.nextGame) !== stableSerialize(current.nextGame)) {
                changes.push({
                    type: 'nextGame',
                    message: `Dein nächstes Spiel ist gegen ${current.nextGame.opponent}.`,
                });
            }
        }
        if (changes.length === 0 && hasNewerData) {
            changes.push({ type: 'data', message: 'Neue Daten seit deinem letzten Besuch.' });
        }
        return changes;
    }

    function renderVisitChangesCard(documentObject, container, changes) {
        if (!documentObject || !container || !Array.isArray(changes) || changes.length === 0) {
            return null;
        }
        const card = documentObject.createElement('section');
        const header = documentObject.createElement('div');
        const heading = documentObject.createElement('h2');
        const dismiss = documentObject.createElement('button');
        const list = documentObject.createElement('ul');

        card.className = 'visit-changes-card';
        card.setAttribute('aria-labelledby', 'visit-changes-title');
        header.className = 'visit-changes-card__header';
        heading.id = 'visit-changes-title';
        heading.className = 'visit-changes-card__title';
        heading.textContent = 'Seit deinem letzten Besuch';
        dismiss.type = 'button';
        dismiss.className = 'visit-changes-card__dismiss';
        dismiss.textContent = 'Schließen';
        dismiss.setAttribute('aria-label', 'Änderungen ausblenden');
        dismiss.addEventListener('click', () => card.remove());
        list.className = 'visit-changes-card__list';
        changes.forEach((change) => {
            const message = documentObject.createElement('li');
            message.textContent = String(change.message || '');
            list.appendChild(message);
        });
        header.append(heading, dismiss);
        card.append(header, list);
        container.appendChild(card);
        return card;
    }

    function startVisitChangesLifecycle({
        storage,
        buildCurrentSnapshot,
        comparePrevious = true,
        key = VISIT_SNAPSHOT_STORAGE_KEY,
    } = {}) {
        let currentSnapshot = null;
        try {
            currentSnapshot = typeof buildCurrentSnapshot === 'function'
                ? buildCurrentSnapshot()
                : null;
        } catch (_error) {
            currentSnapshot = null;
        }
        const validCurrentSnapshot = isVisitSnapshot(currentSnapshot)
            ? buildVisitSnapshot(currentSnapshot)
            : null;
        const previousSnapshot = comparePrevious && validCurrentSnapshot
            ? readVisitSnapshot(storage, key)
            : null;
        const changes = comparePrevious && validCurrentSnapshot
            ? diffVisitSnapshots(previousSnapshot, validCurrentSnapshot)
            : [];
        let rendered = false;
        let readyToConfirm = false;
        let confirmed = false;

        return {
            changes: changes.slice(),
            render(documentObject, container) {
                if (rendered || !validCurrentSnapshot) return null;
                rendered = true;
                let card = null;
                try {
                    card = renderVisitChangesCard(documentObject, container, changes);
                } catch (_error) {
                    card = null;
                }
                readyToConfirm = changes.length === 0 || Boolean(card);
                return card;
            },
            confirmVisible(isVisible) {
                if (
                    confirmed || !validCurrentSnapshot || !rendered ||
                    !readyToConfirm || !isVisible
                ) return false;
                persistVisitSnapshot(storage, validCurrentSnapshot, key);
                confirmed = true;
                return true;
            },
        };
    }

    function diffVisitSnapshots(previous, current) {
        if (
            !previous || typeof previous !== 'object' || Array.isArray(previous) ||
            !current || typeof current !== 'object' || Array.isArray(current)
        ) return [];

        if (previous.version !== undefined || current.version !== undefined) {
            return diffVersionedVisitSnapshots(previous, current);
        }

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
        VISIT_SNAPSHOT_VERSION,
        probePublishedData,
        buildVisitSnapshot,
        buildTeamResultsFingerprint,
        readVisitSnapshot,
        persistVisitSnapshot,
        renderVisitChangesCard,
        startVisitChangesLifecycle,
        isByeOpponent,
        selectUpcomingGames,
        mergeMatchPreviewGames,
        buildLigapokalArchiveEntries,
        buildMatchPreviewTeams,
        buildSeasonNotice,
        enrichRankingPlayersWithClubs,
        canonicalRankingPlayerName,
        matchRankingPlayer,
        filterAndSortRanking,
        buildIcsContent,
        parseAppHash,
        diffVisitSnapshots,
    };
});
