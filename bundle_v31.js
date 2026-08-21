// Global Error Handler
window.onerror = function (msg, url, line, col, error) {
    const div = document.createElement('div');
    div.style.position = 'fixed';
    div.style.top = '0';
    div.style.left = '0';
    div.style.width = '100%';
    div.style.background = '#ef4444';
    div.style.color = 'white';
    div.style.padding = '15px';
    div.style.zIndex = '99999';
    div.style.fontFamily = 'monospace';
    div.style.fontSize = '14px';
    div.textContent = `JS Error: ${msg} (Line ${line}:${col})`;
    document.body.appendChild(div);
    return false;
};

const dataStatus = window.DATA_STATUS || { domains: {} };
const DATA_STATUS_DOMAINS = [
    { key: 'leagues', label: 'Liga' },
    { key: 'rankings', label: 'Rangliste' },
    { key: 'clubs', label: 'Vereine' },
    { key: 'archives', label: 'Archiv' }
];

function formatGermanStatusTime(value) {
    if (typeof value !== 'string') return null;
    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) return null;

    return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Berlin'
    }).format(timestamp);
}

function getDomainState(domain) {
    if (!domain || typeof domain !== 'object') return 'unknown';
    const hasSeason = typeof domain.season === 'string' && domain.season.trim();
    const hasTimestamp = formatGermanStatusTime(domain.updated_at);
    return hasSeason && hasTimestamp && ['current', 'retained'].includes(domain.state)
        ? domain.state
        : 'unknown';
}

function formatDomainStatus(label, domain) {
    const state = getDomainState(domain);
    if (state === 'unknown') return `${label}: Status unbekannt`;

    const season = domain.season.trim();
    const updatedAt = formatGermanStatusTime(domain.updated_at);

    if (state === 'retained') {
        return `${label}: Vorjahresstand ${season} · Stand ${updatedAt}`;
    }

    const seasonLabel = season === 'current'
        ? 'aktuell'
        : season === 'historical'
            ? 'historischer Bestand'
            : season;
    return `${label}: ${seasonLabel} · aktualisiert ${updatedAt}`;
}

function renderDataStatus() {
    const statusList = document.getElementById('data-status-list');
    if (!statusList) return;

    const domains = dataStatus.domains && typeof dataStatus.domains === 'object'
        ? dataStatus.domains
        : {};

    DATA_STATUS_DOMAINS.forEach(({ key, label }) => {
        const domain = domains[key];
        const state = getDomainState(domain);
        const statusItem = document.createElement('li');
        const statusIcon = document.createElement('span');
        const statusText = document.createElement('span');

        statusItem.className = `data-status-item data-status-item--${state}`;
        statusIcon.className = 'data-status-icon';
        statusIcon.setAttribute('aria-hidden', 'true');
        statusIcon.textContent = state === 'current' ? '●' : state === 'retained' ? '◷' : '?';
        statusText.textContent = formatDomainStatus(label, domain);
        statusItem.append(statusIcon, statusText);
        statusList.appendChild(statusItem);
    });
}

function normalizeClubSearchText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ß/g, 'ss')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function filterClubEntries(clubs, query) {
    if (!Array.isArray(clubs)) return [];
    const normalizedQuery = normalizeClubSearchText(query);
    if (!normalizedQuery) return clubs;

    return clubs.filter((club) => normalizeClubSearchText([
        club && club.name,
        club && club.venue,
        club && club.street,
        club && club.city,
        club && club.address,
    ].filter(Boolean).join(' ')).includes(normalizedQuery));
}

function escapeHtmlText(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(new RegExp(String.fromCharCode(34), 'g'), '&quot;')
        .replace(new RegExp(String.fromCharCode(39), 'g'), '&#39;');
}

function replaceWithIconLabel(element, icon, label) {
    const iconElement = document.createElement('span');
    iconElement.setAttribute('aria-hidden', 'true');
    iconElement.textContent = String(icon ?? '');
    iconElement.style.marginRight = '6px';
    const labelElement = document.createElement('span');
    labelElement.textContent = String(label ?? '');
    element.replaceChildren(iconElement, labelElement);
}

function replaceWithSearchResultLabel(element, type, label, context) {
    const typeElement = document.createElement('span');
    typeElement.style.cssText = 'display:inline-block; width:60px; color:#64748b; font-size:0.8em; font-weight:bold;';
    typeElement.textContent = String(type ?? '');
    const labelElement = document.createElement('span');
    if (!type) {
        typeElement.style.display = 'none';
        labelElement.style.cssText = 'display:block; color:#f8fafc; font-weight:bold;';
    }
    labelElement.textContent = String(label ?? '');
    element.replaceChildren(typeElement, labelElement);
    if (context) {
        const contextElement = document.createElement('span');
        contextElement.style.cssText = 'color:#94a3b8; font-size:0.8em;';
        if (!type) contextElement.style.display = 'block';
        contextElement.textContent = `(${String(context)})`;
        element.appendChild(contextElement);
    }
}

function createPlayerProfileDraft(appUtils, initialResolution = null) {
    let selectedGroup = null;
    let selectedRecordKey = null;
    let selectedLabel = '';

    const selectGroup = (group, preferredRecordKey = null) => {
        selectedGroup = group && Array.isArray(group.records) ? group : null;
        selectedLabel = selectedGroup ? String(selectedGroup.name || '') : '';
        const requestedKey = String(preferredRecordKey == null ? '' : preferredRecordKey);
        const requestedIsValid = Boolean(selectedGroup && selectedGroup.records.some((record) => (
            record.recordKey === requestedKey
        )));
        selectedRecordKey = requestedIsValid
            ? requestedKey
            : selectedGroup && selectedGroup.records.length === 1
                ? selectedGroup.records[0].recordKey
                : null;
        return selectedGroup;
    };

    if (initialResolution && initialResolution.status === 'resolved') {
        selectGroup(initialResolution.group, initialResolution.profile.recordKey);
    }

    return {
        selectGroup,
        selectRecord(recordKey) {
            const requestedKey = String(recordKey == null ? '' : recordKey);
            selectedRecordKey = selectedGroup && selectedGroup.records.some((record) => (
                record.recordKey === requestedKey
            )) ? requestedKey : null;
            return selectedRecordKey;
        },
        updateInput(value) {
            const inputValue = String(value == null ? '' : value);
            if (selectedGroup && inputValue !== selectedLabel) {
                selectedGroup = null;
                selectedRecordKey = null;
                selectedLabel = '';
            }
        },
        createProfile(teamName) {
            if (!selectedGroup || !selectedRecordKey) return null;
            return appUtils.createPlayerProfile(selectedGroup, selectedRecordKey, teamName);
        },
        getSelection() {
            return { group: selectedGroup, recordKey: selectedRecordKey, label: selectedLabel };
        },
    };
}

function storeResolvedPlayerProfile(storage, appUtils, players, profile) {
    const resolution = appUtils.resolvePlayerProfile(players, profile);
    if (resolution.status !== 'resolved') return resolution;
    try {
        storage.setItem(appUtils.PLAYER_PROFILE_STORAGE_KEY, JSON.stringify(resolution.profile));
    } catch (_error) {
        return { status: 'write-failed', profile: null, group: null, player: null, records: [] };
    }
    ['myPlayerName', 'myTeamName'].forEach((key) => {
        try { storage.removeItem(key); } catch (_error) { /* new profile is already durable */ }
    });
    return resolution;
}

function clearStoredPlayerProfile(storage, appUtils) {
    [appUtils.PLAYER_PROFILE_STORAGE_KEY, 'myPlayerName', 'myTeamName'].forEach((key) => {
        try { storage.removeItem(key); } catch (_error) { /* reset remains best effort */ }
    });
}

function clubRankingSeasonLabel(status) {
    const season = status && typeof status.season === 'string' ? status.season.trim() : '';
    if (status && status.state === 'retained' && season) {
        return `Rangliste ${season} (letzte vollständige Saison)`;
    }
    return season && season !== 'current' ? `Rangliste ${season}` : 'Rangliste';
}

function createClubRankingSeasonNotice(status) {
    const notice = document.createElement('p');
    notice.className = 'club-ranking-season-notice';
    notice.setAttribute('role', 'note');
    notice.textContent = clubRankingSeasonLabel(status);
    return notice;
}

function createClubRankingStatsRow(playerCount, activeLeagues, totalPoints) {
    const statsRow = document.createElement('div');
    statsRow.className = 'club-ranking-stats';
    statsRow.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px;';
    [
        { value: playerCount, label: 'Spieler' },
        { value: activeLeagues, label: 'Ligen' },
        { value: totalPoints, label: 'Punkte (Ges.)', accent: true },
    ].forEach(({ value, label, accent }) => {
        const card = document.createElement('div');
        card.style.cssText = 'background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 15px; text-align: center;';
        const metric = document.createElement('div');
        metric.style.cssText = `font-weight: bold; color: ${accent ? '#4ade80' : '#f8fafc'}; font-size: 1.2em;`;
        metric.textContent = String(value ?? 0);
        const description = document.createElement('div');
        description.style.cssText = 'font-size: 0.75em; color: #94a3b8;';
        description.textContent = label;
        card.append(metric, description);
        statsRow.appendChild(card);
    });
    return statsRow;
}

function createClubRankingSection(status, statsRow, playerGrid, playerCount) {
    const section = document.createElement('section');
    section.className = 'club-ranking-season';
    section.setAttribute('aria-labelledby', 'club-ranking-season-label');
    const notice = createClubRankingSeasonNotice(status);
    notice.id = 'club-ranking-season-label';
    const heading = document.createElement('h3');
    heading.style.cssText = 'color: #f8fafc; font-size: 1.2em; margin-bottom: 15px;';
    heading.textContent = `Mannschaft (${playerCount})`;
    section.append(notice, statsRow, heading, playerGrid);
    return section;
}

function parseInertHtmlDocument(html) {
    return new DOMParser().parseFromString(String(html ?? ''), 'text/html');
}

function safePublishedSpan(value) {
    const normalized = String(value ?? '').trim();
    if (!/^[1-9]\d*$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return parsed <= 100 ? normalized : null;
}

function safeTableModelsFromHtml(tableHtml) {
    const parsedDocument = parseInertHtmlDocument(tableHtml);
    return Array.from(parsedDocument.querySelectorAll('table'))
        .filter((sourceTable) => !(
            sourceTable.parentElement &&
            typeof sourceTable.parentElement.closest === 'function' &&
            sourceTable.parentElement.closest('table')
        ))
        .map((sourceTable) => {
            const rows = Array.from(sourceTable.querySelectorAll('tr'))
                .filter((sourceRow) => (
                    typeof sourceRow.closest !== 'function' ||
                    sourceRow.closest('table') === sourceTable
                ))
                .map((sourceRow, rowIndex) => {
                    const cells = Array.from(sourceRow.children)
                        .filter((cell) => cell.tagName === 'TH' || cell.tagName === 'TD')
                        .map((cell) => ({
                            tagName: cell.tagName.toLowerCase(),
                            text: String(cell.textContent ?? ''),
                            rowspan: safePublishedSpan(cell.getAttribute('rowspan')),
                            colspan: safePublishedSpan(cell.getAttribute('colspan')),
                        }));
                    if (cells.length === 0) return null;
                    const sourceSection = String(
                        sourceRow.parentElement && sourceRow.parentElement.tagName || '',
                    ).toLowerCase();
                    const section = ['thead', 'tbody', 'tfoot'].includes(sourceSection)
                        ? sourceSection
                        : (rowIndex === 0 && cells.every((cell) => cell.tagName === 'th')
                            ? 'thead'
                            : 'tbody');
                    return { section, cells };
                })
                .filter(Boolean);
            return { rows };
        })
        .filter((model) => model.rows.length > 0);
}

function safeTableRowsFromHtml(tableHtml) {
    return safeTableModelsFromHtml(tableHtml).flatMap((model) => (
        model.rows.map((row) => row.cells.map((cell) => cell.text))
    ));
}

function createSafeTableFromModel(model) {
    const table = document.createElement('table');
    let activeSectionName = null;
    let activeSection = null;
    model.rows.forEach((sourceRow) => {
        if (sourceRow.section !== activeSectionName) {
            activeSectionName = sourceRow.section;
            activeSection = document.createElement(activeSectionName);
            table.appendChild(activeSection);
        }
        const row = document.createElement('tr');
        sourceRow.cells.forEach((sourceCell) => {
            const cell = document.createElement(sourceCell.tagName);
            cell.textContent = sourceCell.text;
            if (sourceCell.rowspan !== null) cell.setAttribute('rowspan', sourceCell.rowspan);
            if (sourceCell.colspan !== null) cell.setAttribute('colspan', sourceCell.colspan);
            row.appendChild(cell);
        });
        activeSection.appendChild(row);
    });
    return table;
}

function createSafeTablesFromHtml(tableHtml) {
    const fragment = document.createDocumentFragment();
    safeTableModelsFromHtml(tableHtml).forEach((model) => {
        fragment.appendChild(createSafeTableFromModel(model));
    });
    return fragment;
}

function createSafeTableFromHtml(tableHtml) {
    const fragment = createSafeTablesFromHtml(tableHtml);
    return fragment.firstElementChild || document.createElement('table');
}

function replaceWithSafeTables(container, tableHtml) {
    const fragment = createSafeTablesFromHtml(tableHtml);
    const tableCount = fragment.children.length;
    container.replaceChildren(fragment);
    return tableCount;
}

function createScrollableTableRegion(table) {
    const region = document.createElement('div');
    region.className = 'table-container table-scroll';
    region.appendChild(table);
    return region;
}

function replaceWithSafeCupTables(container, tableHtml, matchDays) {
    const safeTables = Array.from(createSafeTablesFromHtml(tableHtml).children);
    const roundNames = Object.keys(matchDays || {});
    const fragment = document.createDocumentFragment();
    safeTables.forEach((table, index) => {
        if (roundNames[index]) {
            const heading = document.createElement('h3');
            heading.textContent = roundNames[index];
            fragment.appendChild(heading);
        }
        fragment.appendChild(createScrollableTableRegion(table));
    });
    container.replaceChildren(fragment);
    return safeTables.length;
}

function findWithdrawnTeams(tableHtml) {
    const withdrawnTeams = [];
    safeTableRowsFromHtml(tableHtml).forEach((cells) => {
        if (!cells.join(' ').toLowerCase().includes('zurückgezogen')) return;
        if (cells.length < 2) return;
        const teamName = String(cells[1] || '').replace(/\u00a0/g, ' ').trim();
        if (teamName) withdrawnTeams.push(teamName);
    });
    return withdrawnTeams;
}

function createSafeLeagueTableSection(leagueName, tableHtml, clubName, matchesClub) {
    const section = document.createElement('div');
    section.className = 'club-current-table';
    section.style.cssText = 'margin-bottom: 25px; background: #1e293b; border: 1px solid #334155; border-radius: 8px; overflow: hidden;';
    const heading = document.createElement('div');
    heading.style.cssText = 'padding: 10px 15px; background: rgba(255,255,255,0.05); border-bottom: 1px solid #334155; font-weight: bold; color: #f8fafc;';
    heading.textContent = `Tabelle: ${String(leagueName ?? '')}`;
    const tableContainer = document.createElement('div');
    tableContainer.className = 'table-container table-scroll';
    tableContainer.style.cssText = 'padding: 0; border: none;';
    const table = createSafeTableFromHtml(tableHtml);
    Array.from(table.querySelectorAll('tbody tr')).forEach((row) => {
        if (typeof matchesClub === 'function' && matchesClub(clubName, row.textContent)) {
            row.style.background = 'rgba(59, 130, 246, 0.2)';
            row.style.fontWeight = 'bold';
            row.style.color = '#60a5fa';
        }
    });
    tableContainer.appendChild(table);
    section.append(heading, tableContainer);
    return section;
}

function createPlayerFormElement(rounds) {
    if (!rounds) return null;
    const data = [];
    for (let index = 1; index <= 18; index += 1) {
        const value = parseInt(rounds[`R${index}`]);
        if (!Number.isNaN(value)) data.push(value);
    }
    if (data.length < 2) return null;
    const width = 60;
    const height = 25;
    const maximum = Math.max(...data);
    const minimum = Math.min(...data);
    const range = maximum - minimum || 1;
    const points = data.map((value, index) => {
        const x = (index / (data.length - 1)) * width;
        const y = height - ((value - minimum) / range) * height;
        return `${x},${y}`;
    }).join(' ');
    const form = document.createElement('div');
    form.style.cssText = 'display: flex; flex-direction: column; align-items: center; margin: 0 15px;';
    const label = document.createElement('div');
    label.style.cssText = 'font-size: 0.65em; color: #64748b; text-transform: uppercase; margin-bottom: 2px;';
    label.textContent = 'Spielform';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'opacity: 0.8; overflow: visible;';
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', points);
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', '#4ade80');
    polyline.setAttribute('stroke-width', '2');
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(polyline);
    form.append(label, svg);
    return form;
}

function createClubPlayerCard(player, tierColor) {
    const card = document.createElement('div');
    card.className = 'club-player-card';
    card.style.cssText = 'background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 10px; display: flex; justify-content: space-between; align-items: center;';
    const identity = document.createElement('div');
    identity.style.flex = '1';
    const name = document.createElement('div');
    name.style.cssText = 'font-weight: bold; color: #f8fafc;';
    name.textContent = String(player && player.name || '');
    const league = document.createElement('div');
    const safeTierColor = /^#[0-9a-f]{6}$/i.test(String(tierColor || '')) ? tierColor : '#94a3b8';
    league.style.cssText = `font-size: 0.8em; color: ${safeTierColor};`;
    const leagueName = document.createElement('span');
    leagueName.textContent = String(player && player.league || '');
    const rank = document.createElement('span');
    rank.style.cssText = 'color: #cbd5e1; margin-left: 5px; background: rgba(255,255,255,0.1); padding: 1px 4px; border-radius: 3px;';
    rank.textContent = `Platz ${player && player.rank || '-'}`;
    league.append(leagueName, rank);
    identity.append(name, league);
    const score = document.createElement('div');
    score.style.cssText = 'text-align: right; margin-left: 10px;';
    const points = document.createElement('div');
    points.style.cssText = 'font-weight: bold; color: #4ade80; font-size: 1.1em;';
    points.textContent = String(player && player.points != null ? player.points : 0);
    const pointsLabel = document.createElement('div');
    pointsLabel.style.cssText = 'font-size: 0.75em; color: #64748b;';
    pointsLabel.textContent = 'Pkt';
    score.append(points, pointsLabel);
    card.appendChild(identity);
    const form = createPlayerFormElement(player && player.rounds);
    if (form) card.appendChild(form);
    card.appendChild(score);
    return card;
}

function canonicalClubId(value, clubCount) {
    const candidate = typeof value === 'number'
        ? value
        : typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)
            ? Number(value)
            : NaN;
    return Number.isSafeInteger(candidate) && candidate >= 0 && candidate < clubCount
        ? candidate
        : null;
}

function normalizeClubIdList(values, clubCount, limit = 5) {
    if (!Array.isArray(values)) return [];
    const normalized = [];
    values.forEach((value) => {
        const id = canonicalClubId(value, clubCount);
        if (id !== null && !normalized.includes(id) && normalized.length < limit) normalized.push(id);
    });
    return normalized;
}

const FAVORITE_ROUTE_TYPES = Object.freeze(['league', 'ranking', 'ligapokalArchive', 'club']);

function readFavoriteOwnData(value) {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const typeDescriptor = Object.getOwnPropertyDescriptor(value, 'type');
        const idDescriptor = Object.getOwnPropertyDescriptor(value, 'id');
        const nameDescriptor = Object.getOwnPropertyDescriptor(value, 'name');
        if (!typeDescriptor || !idDescriptor || !nameDescriptor ||
            typeDescriptor.get || typeDescriptor.set ||
            idDescriptor.get || idDescriptor.set ||
            nameDescriptor.get || nameDescriptor.set) return null;
        return {
            type: typeDescriptor.value,
            id: idDescriptor.value,
            name: nameDescriptor.value,
        };
    } catch (_error) {
        return null;
    }
}

function canonicalFavoriteRoute(type, id, clubCount) {
    if (!FAVORITE_ROUTE_TYPES.includes(type)) return null;
    if (type === 'club') {
        const normalizedId = canonicalClubId(id, clubCount);
        return normalizedId === null ? null : { type, id: normalizedId };
    }
    return typeof id === 'string' && id.trim() ? { type, id } : null;
}

function favoriteRouteKey(type, id) {
    return JSON.stringify([type, id]);
}

function normalizeFavorites(values, clubCount, favoriteRouteExists) {
    if (!Array.isArray(values)) return [];
    const normalized = [];
    const seenRoutes = new Set();
    values.forEach((favorite) => {
        let data;
        try {
            if (!favorite || typeof favorite !== 'object' || Array.isArray(favorite)) return;
            const typeDescriptor = Object.getOwnPropertyDescriptor(favorite, 'type');
            const idDescriptor = Object.getOwnPropertyDescriptor(favorite, 'id');
            const nameDescriptor = Object.getOwnPropertyDescriptor(favorite, 'name');
            if (!typeDescriptor || !idDescriptor || !nameDescriptor ||
                typeDescriptor.get || typeDescriptor.set ||
                idDescriptor.get || idDescriptor.set ||
                nameDescriptor.get || nameDescriptor.set) return;
            data = {
                type: typeDescriptor.value,
                id: idDescriptor.value,
                name: nameDescriptor.value,
            };
        } catch (_error) {
            return;
        }
        if (!['league', 'ranking', 'ligapokalArchive', 'club'].includes(data.type) ||
            typeof data.name !== 'string' || !data.name.trim()) return;
        const route = data.type === 'club'
            ? { type: data.type, id: canonicalClubId(data.id, clubCount) }
            : typeof data.id === 'string' && data.id.trim()
                ? { type: data.type, id: data.id }
                : null;
        if (!route || route.id === null || route.id === undefined) return;
        if (typeof favoriteRouteExists === 'function' &&
            route.type !== 'club' && !favoriteRouteExists(route.type, route.id)) return;
        const routeKey = JSON.stringify([route.type, route.id]);
        if (seenRoutes.has(routeKey)) return;
        seenRoutes.add(routeKey);
        normalized.push(Object.freeze({ type: route.type, id: route.id, name: data.name }));
    });
    return normalized;
}

function readLocalArray(storage, key) {
    try {
        const value = JSON.parse(storage.getItem(key));
        return Array.isArray(value) ? value : [];
    } catch (_error) {
        return [];
    }
}

function persistLocalValue(storage, key, value) {
    try {
        storage.setItem(key, JSON.stringify(value));
        return true;
    } catch (_error) {
        return false;
    }
}

function createSeasonNotice(context) {
    const rankingStatus = dataStatus.domains && dataStatus.domains.rankings;
    const noticeModel = typeof BwedlAppUtils !== 'undefined'
        ? BwedlAppUtils.buildSeasonNotice(rankingStatus)
        : null;
    if (!noticeModel || noticeModel.state !== 'retained') return null;

    const safeContext = typeof context === 'string'
        ? context.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '')
        : 'ranking';
    const notice = document.createElement('section');
    const heading = document.createElement('h2');
    const message = document.createElement('p');
    const detail = document.createElement('p');
    const headingId = `season-notice-${safeContext || 'ranking'}`;

    notice.className = 'season-notice';
    notice.dataset.seasonContext = safeContext || 'ranking';
    notice.setAttribute('role', 'note');
    notice.setAttribute('aria-labelledby', headingId);
    heading.id = headingId;
    heading.className = 'season-notice__title';
    heading.textContent = noticeModel.title;
    message.className = 'season-notice__message';
    message.textContent = noticeModel.message;
    detail.className = 'season-notice__detail';
    detail.textContent = 'Andere aktuelle Daten wie Spielpläne und Ergebnisse können weiterhin aktuell sein.';

    notice.appendChild(heading);
    notice.appendChild(message);
    notice.appendChild(detail);
    return notice;
}

window.BWEDL_STATUS_FORMATTERS = {
    formatDomainStatus,
    formatGermanStatusTime,
    getDomainState
};
document.addEventListener('DOMContentLoaded', renderDataStatus);

document.addEventListener('DOMContentLoaded', () => {
    const VISIT_SNAPSHOT_STORAGE_KEY = 'bwedl_visit_snapshot';
    const nav = document.getElementById('league-nav');
    const contentArea = document.getElementById('content-area');
    const topBarTitle = document.getElementById('current-league-title');
    const template = document.getElementById('league-view-template');

    const searchInput = document.getElementById('global-search');
    const searchResults = document.getElementById('search-results');
    const backBtn = document.getElementById('back-btn');

    if (searchInput) {
        searchInput.addEventListener('input', handleSearch);
        searchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeSearchResults(true);
            }
        });
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                closeSearchResults(false);
            }
        });
    }
    if (backBtn) {
        backBtn.addEventListener('click', goBack);
    }

    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.querySelector('.sidebar');

    // Favorites State (Hoisted to avoid TDZ)
    let favorites = readLocalArray(localStorage, 'bwedl_favorites');

    const RECENT_CLUBS_STORAGE_KEY = 'bwedl_recent_clubs';
    let recentClubIds = readLocalArray(localStorage, RECENT_CLUBS_STORAGE_KEY);
    let clubSidebarContainer = null;

    function createDisclosureButton(label, contentId, content, expanded = false) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'disclosure-button';
        button.setAttribute('aria-expanded', String(expanded));
        button.setAttribute('aria-controls', contentId);
        button.textContent = label;
        content.id = contentId;
        content.hidden = !expanded;
        button.addEventListener('click', () => {
            const isExpanded = button.getAttribute('aria-expanded') === 'true';
            button.setAttribute('aria-expanded', String(!isExpanded));
            content.hidden = isExpanded;
        });
        return button;
    }

    function closeSearchResults(restoreFocus = false, clearInput = restoreFocus) {
        searchResults.classList.add('hidden');
        searchInput.setAttribute('aria-expanded', 'false');
        if (clearInput) searchInput.value = '';
        if (restoreFocus) searchInput.focus();
    }

    function activateSearchResult(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeSearchResults(true);
            return;
        }
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.currentTarget.click();
    }

    function createProfileSuggestionItem(match, selectMatch, closeSuggestions) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        const name = document.createElement('span');
        const context = document.createElement('span');
        button.type = 'button';
        button.className = 'profile-suggestion-button';
        name.className = 'profile-suggestion-name';
        name.textContent = match.label;
        context.className = 'profile-suggestion-context';
        context.textContent = match.context || 'Vereinslos';
        button.appendChild(name);
        button.appendChild(context);
        button.addEventListener('click', () => selectMatch(match));
        button.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            closeSuggestions(true);
        });
        item.appendChild(button);
        return item;
    }

    function closeProfileSuggestions(suggestionsBox, input, restoreFocus = false) {
        suggestionsBox.style.display = 'none';
        input.setAttribute('aria-expanded', 'false');
        if (restoreFocus) input.focus();
    }

    function selectProfileSuggestion(match, input, suggestionsBox, updateSelection) {
        input.value = match.label;
        closeProfileSuggestions(suggestionsBox, input, true);
        updateSelection(match);
    }

    function configureAllTimeDetailButton(button, contentId, expanded, toggle) {
        button.type = 'button';
        button.className = 'alltime-detail-button';
        button.setAttribute('aria-controls', contentId);
        button.setAttribute('aria-expanded', String(expanded));
        button.textContent = expanded ? 'Schließen' : 'Details';
        button.addEventListener('click', toggle);
    }

    function rerenderAllTimeDetail(container, toggleId, render) {
        render();
        const matchingButtons = Array.from(container.querySelectorAll('.alltime-detail-button'))
            .filter(button => button.id === toggleId && !button.hidden);
        if (matchingButtons.length === 1) matchingButtons[0].focus();
    }

    // --- My Profile State ---
    let myPlayerProfile = null;
    let myPlayerResolution = { status: 'missing', profile: null, group: null, player: null, records: [] };
    let myPlayerName = localStorage.getItem('myPlayerName');
    let myTeamName = localStorage.getItem('myTeamName');
    let legacyProfileNeedsConfirmation = false;

    function applyPlayerResolution(resolution) {
        myPlayerResolution = resolution && resolution.status === 'resolved'
            ? resolution
            : { status: 'missing', profile: null, group: null, player: null, records: [] };
        myPlayerProfile = myPlayerResolution.profile;
        myPlayerName = myPlayerProfile ? myPlayerProfile.name : null;
        myTeamName = myPlayerProfile
            ? (myPlayerProfile.teamName || myPlayerResolution.player.company || null)
            : null;
    }

    function resolveMyCalendarSubscription() {
        try {
            if (!myPlayerProfile || typeof myTeamName !== 'string' || !myTeamName.trim()) return null;
            const index = window.BWEDL_CALENDAR_INDEX;
            const appUtils = window.BwedlAppUtils;
            if (!index || !appUtils || typeof appUtils.resolveCalendarFeed !== 'function' ||
                typeof appUtils.buildCalendarSubscriptionUrls !== 'function') return null;
            const feed = appUtils.resolveCalendarFeed(index, myTeamName);
            if (!feed || typeof feed.name !== 'string' || !feed.name.trim() ||
                typeof feed.path !== 'string' || !feed.path.trim()) return null;
            const urls = appUtils.buildCalendarSubscriptionUrls(feed.path, document.baseURI);
            if (!urls || typeof urls.https !== 'string' || typeof urls.webcal !== 'string' ||
                !urls.https || !urls.webcal) return null;
            const httpsUrl = new URL(urls.https);
            const webcalUrl = new URL(urls.webcal);
            if (httpsUrl.protocol !== 'https:' || webcalUrl.protocol !== 'webcal:' ||
                httpsUrl.host !== webcalUrl.host || httpsUrl.pathname !== webcalUrl.pathname) return null;
            const rawSeason = typeof index.season === 'string' ? index.season.trim() : '';
            const seasonMatch = rawSeason.match(/^(20\d{2})[-/](20\d{2})$/);
            return {
                name: feed.name.trim(),
                path: feed.path.trim(),
                https: urls.https,
                webcal: urls.webcal,
                season: seasonMatch ? `${seasonMatch[1]}/${seasonMatch[2]}` : null,
            };
        } catch (_error) {
            return null;
        }
    }

    function createCalendarSubscriptionCard(context = 'dashboard') {
        const safeContext = context === 'profile' ? 'profile' : 'dashboard';
        const card = document.createElement('section');
        const title = document.createElement('h2');
        const meta = document.createElement('p');
        const detail = document.createElement('p');
        card.className = 'calendar-subscription-card';
        card.classList.add(`calendar-subscription-card--${safeContext}`);
        card.setAttribute('aria-labelledby', `calendar-subscription-${safeContext}-title`);
        title.id = `calendar-subscription-${safeContext}-title`;
        title.className = 'calendar-subscription-card__title';
        meta.className = 'calendar-subscription-card__meta';
        detail.className = 'calendar-subscription-card__detail';
        title.textContent = safeContext === 'profile' ? 'Kalender-Abo' : 'Teamkalender';
        const subscription = resolveMyCalendarSubscription();

        if (!myPlayerProfile || typeof myTeamName !== 'string' || !myTeamName.trim()) {
            const action = document.createElement('button');
            meta.textContent = 'Richte dein Profil ein, um den Spielplan deiner Mannschaft zu abonnieren.';
            action.type = 'button';
            action.className = 'calendar-subscription-card__action';
            action.textContent = 'Mein Profil einrichten';
            action.addEventListener('click', () => navigateTo('profile'));
            card.append(title, meta, action);
            return card;
        }

        meta.textContent = myTeamName.trim();
        detail.textContent = 'Ligaspiele · aktuelle Saison';
        card.append(title, meta, detail);
        if (!subscription) {
            const status = document.createElement('p');
            status.className = 'calendar-subscription-card__status';
            status.setAttribute('role', 'status');
            status.textContent = 'Für diese Mannschaft ist aktuell kein Kalender verfügbar.';
            card.appendChild(status);
            return card;
        }

        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'calendar-subscription-card__action';
        action.textContent = 'Kalender hinzufügen';
        action.addEventListener('click', () => {
            if (navigator.onLine === false) {
                setAppStatus('Für das Kalender-Abo ist eine Internetverbindung erforderlich.');
                return;
            }
            openCalendarSubscriptionDialog(action, subscription);
        });
        card.appendChild(action);
        return card;
    }

    function openCalendarSubscriptionDialog(trigger, subscription) {
        if (navigator.onLine === false) {
            setAppStatus('Für das Kalender-Abo ist eine Internetverbindung erforderlich.');
            return null;
        }
        let expectedHttpsUrl;
        try {
            if (!subscription || typeof subscription.name !== 'string' || !subscription.name.trim() ||
                typeof subscription.path !== 'string' || !subscription.path.trim() ||
                typeof subscription.https !== 'string' || typeof subscription.webcal !== 'string') return null;
            const httpsUrl = new URL(subscription.https);
            const webcalUrl = new URL(subscription.webcal);
            if (httpsUrl.protocol !== 'https:' || webcalUrl.protocol !== 'webcal:' ||
                httpsUrl.host !== webcalUrl.host || httpsUrl.pathname !== webcalUrl.pathname) return null;
            expectedHttpsUrl = httpsUrl.href;
        } catch (_error) {
            return null;
        }

        const existing = document.querySelector('.calendar-subscription-dialog');
        if (existing) return existing;
        const dialog = document.createElement('dialog');
        const heading = document.createElement('h2');
        const description = document.createElement('p');
        const team = document.createElement('p');
        const season = document.createElement('p');
        const options = document.createElement('div');
        const automaticOption = document.createElement('section');
        const automaticBadge = document.createElement('p');
        const automaticHeading = document.createElement('h3');
        const automaticDescription = document.createElement('p');
        const automaticActions = document.createElement('div');
        const openLink = document.createElement('a');
        const copyButton = document.createElement('button');
        const staticOption = document.createElement('section');
        const staticBadge = document.createElement('p');
        const staticHeading = document.createElement('h3');
        const staticDescription = document.createElement('p');
        const staticWarning = document.createElement('p');
        const downloadButton = document.createElement('button');
        const actions = document.createElement('div');
        const closeButton = document.createElement('button');
        const status = document.createElement('p');
        const uniqueId = `calendar-subscription-title-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const descriptionId = uniqueId.replace('-title-', '-description-');
        let removed = false;
        let copyInFlight = false;
        let copyOperation = 0;
        let downloadInFlight = false;
        let downloadOperation = 0;
        let downloadController = null;
        const createInstructions = (label, text) => {
            const details = document.createElement('details');
            const summary = document.createElement('summary');
            const instructions = document.createElement('p');
            details.className = 'calendar-subscription-dialog__instructions';
            summary.textContent = label;
            instructions.textContent = text;
            details.append(summary, instructions);
            return details;
        };
        const updateStatus = (message) => {
            status.textContent = message;
            setAppStatus(message);
        };
        const removeOnce = () => {
            if (removed) return;
            removed = true;
            copyOperation += 1;
            downloadOperation += 1;
            if (downloadController) downloadController.abort();
            downloadController = null;
            dialog.remove();
            if (trigger && trigger.isConnected && typeof trigger.focus === 'function') trigger.focus();
        };

        dialog.className = 'calendar-subscription-dialog';
        dialog.setAttribute('aria-labelledby', uniqueId);
        dialog.setAttribute('aria-describedby', descriptionId);
        heading.id = uniqueId;
        heading.textContent = 'Teamkalender hinzufügen';
        description.id = descriptionId;
        description.className = 'calendar-subscription-dialog__intro';
        description.textContent = 'Wähle zwischen automatischer Aktualisierung und einer einmaligen Kopie.';
        team.className = 'calendar-subscription-dialog__team';
        team.textContent = `${subscription.name.trim()} · Ligaspiele · aktuelle Saison`;
        season.className = 'calendar-subscription-dialog__season';
        if (typeof subscription.season === 'string' && /^(20\d{2})\/(20\d{2})$/.test(subscription.season)) {
            season.textContent = `Saison ${subscription.season}`;
        }

        options.className = 'calendar-subscription-dialog__options';
        automaticOption.className = 'calendar-subscription-dialog__option calendar-subscription-dialog__option--recommended';
        automaticBadge.className = 'calendar-subscription-dialog__badge';
        automaticBadge.textContent = 'Empfohlen';
        automaticHeading.textContent = 'Automatisch aktuell bleiben';
        automaticDescription.textContent = 'Wird als eigener, schreibgeschützter Teamkalender hinzugefügt. Terminänderungen und Absagen werden automatisch übernommen.';
        automaticActions.className = 'calendar-subscription-dialog__option-actions';
        openLink.className = 'calendar-subscription-dialog__open-link';
        openLink.href = subscription.webcal;
        openLink.textContent = 'In Kalender-App öffnen';
        copyButton.type = 'button';
        copyButton.textContent = 'Abo-Link kopieren';

        staticOption.className = 'calendar-subscription-dialog__option';
        staticBadge.className = 'calendar-subscription-dialog__badge calendar-subscription-dialog__badge--secondary';
        staticBadge.textContent = 'Für bestehende oder gemeinsame Kalender';
        staticHeading.textContent = 'Termine einmalig übernehmen';
        staticDescription.textContent = 'Lädt alle zukünftigen, bereits terminierten Ligaspiele als eine gemeinsame ICS-Datei herunter.';
        staticWarning.className = 'calendar-subscription-dialog__warning';
        staticWarning.textContent = 'Keine automatische Aktualisierung: Verschiebungen und Absagen musst du anschließend selbst im Zielkalender ändern. Ein erneuter Import kann zu doppelten Terminen führen.';
        downloadButton.type = 'button';
        downloadButton.className = 'calendar-subscription-dialog__download';
        downloadButton.textContent = 'ICS-Datei herunterladen';

        actions.className = 'calendar-subscription-dialog__actions';
        closeButton.type = 'button';
        closeButton.textContent = 'Schließen';
        status.className = 'calendar-subscription-dialog__status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        copyButton.addEventListener('click', async () => {
            if (removed || copyInFlight || copyButton.disabled) return;
            copyInFlight = true;
            copyButton.disabled = true;
            const operation = ++copyOperation;
            const canUpdate = () => !removed && dialog.isConnected && operation === copyOperation;
            try {
                if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('clipboard unavailable');
                await navigator.clipboard.writeText(subscription.https);
                if (!canUpdate()) return;
                updateStatus('Abo-Link wurde kopiert.');
            } catch (_error) {
                if (!canUpdate()) return;
                updateStatus('Abo-Link konnte nicht kopiert werden.');
            } finally {
                if (operation !== copyOperation) return;
                copyInFlight = false;
                if (!removed && dialog.isConnected) copyButton.disabled = false;
            }
        });
        downloadButton.addEventListener('click', async () => {
            if (removed || downloadInFlight || downloadButton.disabled) return;
            if (navigator.onLine === false) {
                updateStatus('Die Kalenderdatei konnte nicht geladen werden. Prüfe deine Internetverbindung.');
                return;
            }
            downloadInFlight = true;
            downloadButton.disabled = true;
            downloadButton.textContent = 'ICS-Datei wird erstellt …';
            const operation = ++downloadOperation;
            const controller = new AbortController();
            downloadController = controller;
            const canUpdate = () => !removed && dialog.isConnected && operation === downloadOperation;
            let failureKind = 'load';
            try {
                const response = await fetch(subscription.https, { cache: 'no-store', signal: controller.signal });
                if (!canUpdate()) return;
                if (!response || response.ok !== true) throw new Error('calendar feed unavailable');
                let responseUrl;
                try {
                    responseUrl = new URL(response.url).href;
                } catch (_error) {
                    responseUrl = '';
                }
                if (responseUrl !== expectedHttpsUrl) {
                    failureKind = 'safe';
                    throw new Error('unexpected calendar feed URL');
                }
                const buffer = await response.arrayBuffer();
                if (!canUpdate()) return;
                failureKind = 'safe';
                const snapshot = window.BwedlAppUtils.buildStaticCalendarDownload(
                    new Uint8Array(buffer),
                    { now: new Date(), teamName: subscription.name, feedPath: subscription.path },
                );
                if (!snapshot || snapshot.ok !== true) {
                    if (snapshot && snapshot.reason === 'empty') {
                        updateStatus('Aktuell sind keine zukünftigen Spieltermine verfügbar.');
                        return;
                    }
                    throw new Error('calendar snapshot rejected');
                }
                if (typeof snapshot.content !== 'string' || !snapshot.content || snapshot.content.length > 1048576 ||
                    typeof snapshot.filename !== 'string' ||
                    !/^bwedl-[a-z0-9-]+-zukuenftige-spiele\.ics$/u.test(snapshot.filename) ||
                    !Number.isSafeInteger(snapshot.eventCount) || snapshot.eventCount < 1) {
                    throw new Error('calendar snapshot invalid');
                }

                let objectUrl = null;
                let anchor = null;
                try {
                    const blob = new Blob([snapshot.content], { type: 'text/calendar;charset=utf-8' });
                    objectUrl = URL.createObjectURL(blob);
                    anchor = document.createElement('a');
                    anchor.href = objectUrl;
                    anchor.download = snapshot.filename;
                    anchor.hidden = true;
                    document.body.appendChild(anchor);
                    anchor.click();
                    if (canUpdate()) updateStatus('ICS-Datei wurde heruntergeladen.');
                } finally {
                    if (anchor) anchor.remove();
                    if (objectUrl) URL.revokeObjectURL(objectUrl);
                }
            } catch (error) {
                if (!canUpdate() || (error && error.name === 'AbortError')) return;
                updateStatus(failureKind === 'safe'
                    ? 'Die Kalenderdatei konnte nicht sicher erstellt werden.'
                    : 'Die Kalenderdatei konnte nicht geladen werden. Prüfe deine Internetverbindung.');
            } finally {
                if (operation !== downloadOperation) return;
                downloadInFlight = false;
                if (downloadController === controller) downloadController = null;
                if (!removed && dialog.isConnected) {
                    downloadButton.disabled = false;
                    downloadButton.textContent = 'ICS-Datei herunterladen';
                }
            }
        });
        closeButton.addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', removeOnce);
        automaticActions.append(openLink, copyButton);
        automaticOption.append(
            automaticBadge,
            automaticHeading,
            automaticDescription,
            automaticActions,
            createInstructions(
                'Anleitung für iPhone',
                'Tippe auf „In Kalender-App öffnen“, bestätige das Abonnement und wähle bei Bedarf Name und Farbe. Falls sich keine App öffnet, kopiere den Abo-Link und füge ihn in Apple Kalender als Kalenderabonnement ein.',
            ),
            createInstructions(
                'Anleitung für Android / Google Kalender',
                'Kopiere den Abo-Link. Öffne Google Kalender am Computer und wähle unter „Weitere Kalender“ das Plus und „Per URL“. Danach erscheint der abonnierte Kalender auch in der Google-Kalender-App.',
            ),
        );
        staticOption.append(
            staticBadge,
            staticHeading,
            staticDescription,
            staticWarning,
            downloadButton,
            createInstructions(
                'Anleitung für iPhone',
                'Lade die ICS-Datei herunter und öffne sie über „Dateien“ oder als Anhang. Importiere die Termine in einen beschreibbaren Zielkalender. Für einen gemeinsam gepflegten Google-Kalender ist der Import am Computer zuverlässiger.',
            ),
            createInstructions(
                'Anleitung für Android / Google Kalender',
                'Lade die ICS-Datei herunter. Öffne Google Kalender am Computer, dann „Einstellungen“, „Importieren & Exportieren“, wähle die Datei und anschließend deinen bestehenden oder gemeinsamen Zielkalender. Die importierten Termine werden nicht automatisch aktualisiert.',
            ),
        );
        options.append(automaticOption, staticOption);
        actions.append(closeButton);
        dialog.append(heading, description, team);
        if (season.textContent) dialog.appendChild(season);
        dialog.append(options, actions, status);
        document.body.appendChild(dialog);
        dialog.showModal();
        copyButton.focus();
        return dialog;
    }

    function getMyPrimaryPlayer() {
        return myPlayerResolution.status === 'resolved' ? myPlayerResolution.player : null;
    }

    function getMyPlayerRecords() {
        return myPlayerResolution.status === 'resolved' ? [...myPlayerResolution.records] : [];
    }

    function isMyPlayerRecord(player) {
        if (!myPlayerProfile || !player) return false;
        const personKey = window.BwedlAppUtils.rankingPersonKey(player);
        const recordKey = window.BwedlAppUtils.rankingRecordKey(player);
        return personKey === myPlayerProfile.personKey && getMyPlayerRecords().some((record) => (
            record.recordKey === recordKey
        ));
    }

    function initializePlayerProfile() {
        let storedProfile = null;
        try {
            const rawProfile = localStorage.getItem(window.BwedlAppUtils.PLAYER_PROFILE_STORAGE_KEY);
            storedProfile = rawProfile ? JSON.parse(rawProfile) : null;
        } catch (_error) {
            storedProfile = null;
        }

        const storedResolution = window.BwedlAppUtils.resolvePlayerProfile(
            rankingData.players || [],
            storedProfile,
        );
        if (storedResolution.status === 'resolved') {
            applyPlayerResolution(storedResolution);
            return;
        }

        const legacyName = localStorage.getItem('myPlayerName');
        const legacyTeam = localStorage.getItem('myTeamName');
        const migration = window.BwedlAppUtils.migrateLegacyPlayerProfile(
            rankingData.players || [],
            legacyName,
            legacyTeam,
        );
        if (migration.status === 'resolved') {
            const storedMigration = storeResolvedPlayerProfile(
                localStorage,
                window.BwedlAppUtils,
                rankingData.players || [],
                migration.profile,
            );
            if (storedMigration.status === 'resolved') {
                applyPlayerResolution(storedMigration);
                return;
            }
        }

        applyPlayerResolution(null);
        if (legacyName) {
            myPlayerName = legacyName;
            myTeamName = legacyTeam;
            legacyProfileNeedsConfirmation = migration.status === 'ambiguous';
        }
    }

    function createProfileOnboardingCard() {
        const card = document.createElement('section');
        const heading = document.createElement('h2');
        const benefit = document.createElement('p');
        const privacy = document.createElement('p');
        const action = document.createElement('button');

        card.className = 'profile-onboarding-card';
        card.setAttribute('aria-labelledby', 'profile-onboarding-title');
        heading.id = 'profile-onboarding-title';
        heading.className = 'profile-onboarding-card__title';
        heading.textContent = 'Deine persönliche Übersicht';
        benefit.className = 'profile-onboarding-card__benefit';
        benefit.textContent = 'Wähle deinen Spielernamen und sieh persönliche Saisonwerte, Form und nächste Spiele direkt auf dem Dashboard.';
        privacy.className = 'profile-onboarding-card__privacy';
        privacy.textContent = 'Deine Auswahl bleibt lokal in diesem Browser.';
        action.type = 'button';
        action.className = 'profile-onboarding-card__action';
        action.textContent = 'Spielerprofil auswählen';
        action.addEventListener('click', () => navigateTo('profile'));

        card.appendChild(heading);
        card.appendChild(benefit);
        card.appendChild(privacy);
        card.appendChild(action);
        return card;
    }

    const setMyPlayer = (profile) => {
        if (profile) {
            const stored = storeResolvedPlayerProfile(
                localStorage,
                window.BwedlAppUtils,
                rankingData.players || [],
                profile,
            );
            if (stored.status !== 'resolved') return false;
            applyPlayerResolution(stored);
            legacyProfileNeedsConfirmation = false;
        } else {
            clearStoredPlayerProfile(localStorage, window.BwedlAppUtils);
            applyPlayerResolution(null);
            legacyProfileNeedsConfirmation = false;
        }
        // Update Sidebar Link
        const link = document.getElementById('my-profile-link');
        if (link) {
            replaceWithIconLabel(link, '👤', myPlayerProfile ? myPlayerProfile.name : 'Mein Profil');
            link.style.color = myPlayerProfile ? "#f8fafc" : "#94a3b8";
        }
        if (typeof refreshVisitSnapshotBaseline === 'function') {
            refreshVisitSnapshotBaseline(false);
        }
        const dashboardState = { type: 'dashboard', id: null };
        history.replaceState(dashboardState, "", "#dashboard");
        navigateTo('dashboard', null, false);
        return true;
    };

    const mobileOverlay = document.getElementById('mobile-overlay');

    function closeMobileNavigation() {
        if (sidebar) sidebar.classList.remove('open');
        if (mobileOverlay) mobileOverlay.classList.remove('active');
        if (typeof menuToggle !== 'undefined' && menuToggle) {
            menuToggle.setAttribute('aria-expanded', 'false');
            menuToggle.setAttribute('aria-label', 'Navigation öffnen');
        }
    }

    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            if (mobileOverlay) mobileOverlay.classList.toggle('active');
            const isOpen = sidebar.classList.contains('open');
            menuToggle.setAttribute('aria-expanded', String(isOpen));
            menuToggle.setAttribute('aria-label', isOpen ? 'Navigation schließen' : 'Navigation öffnen');
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && sidebar.classList.contains('open')) {
                event.preventDefault();
                closeMobileNavigation();
                menuToggle.setAttribute('aria-expanded', 'false');
                menuToggle.setAttribute('aria-label', 'Navigation öffnen');
                menuToggle.focus();
            }
        });

        if (mobileOverlay) {
            mobileOverlay.addEventListener('click', closeMobileNavigation);
        }

        // Close mobile navigation when clicking outside (fallback)
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768 &&
                sidebar.classList.contains('open') &&
                !sidebar.contains(e.target) &&
                e.target !== menuToggle &&
                (!mobileOverlay || !mobileOverlay.contains(e.target))) {
                closeMobileNavigation();
            }
        });

        // Close mobile navigation when a link inside it is clicked
        sidebar.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                // If clicked element is a link or clickable item (league-item)
                if (e.target.classList.contains('league-item') || e.target.tagName === 'A') {
                    closeMobileNavigation();
                }
            }
        });
    }

    // State Variables
    let leagueData = {};
    let rankingData = {};
    let clubData = {};
    let archiveData = {};
    let ligapokalArchive = {};

    // Search & Navigation Globals
    window.searchIndex = [];
    // let searchIndex = window.searchIndex; // Removed to prevent TDZ issues
    let historyStack = [];
    let isNavigatingBack = false;
    let currentState = null;
    let visitChangesLifecycle = null;

    // Load Data
    if (typeof LEAGUE_DATA !== 'undefined') leagueData = LEAGUE_DATA;
    else if (window.LEAGUE_DATA) leagueData = window.LEAGUE_DATA;

    if (typeof RANKING_DATA !== 'undefined') rankingData = RANKING_DATA;
    else if (window.RANKING_DATA) rankingData = window.RANKING_DATA;

    if (typeof CLUB_DATA !== 'undefined') clubData = CLUB_DATA;
    else if (window.CLUB_DATA) clubData = window.CLUB_DATA;
    const clubCount = Array.isArray(clubData.clubs) ? clubData.clubs.length : 0;
    recentClubIds = normalizeClubIdList(recentClubIds, clubCount, 5);
    persistLocalValue(localStorage, RECENT_CLUBS_STORAGE_KEY, recentClubIds);

    if (typeof ARCHIVE_DATA !== 'undefined') archiveData = ARCHIVE_DATA;
    else if (window.ARCHIVE_DATA) archiveData = window.ARCHIVE_DATA;

    // Load Ligapokal Archive Data
    if (typeof LIGAPOKAL_ARCHIVE !== 'undefined') ligapokalArchive = LIGAPOKAL_ARCHIVE;
    else if (window.LIGAPOKAL_ARCHIVE) ligapokalArchive = window.LIGAPOKAL_ARCHIVE;
    if (window.BwedlAppUtils && typeof window.BwedlAppUtils.buildLigapokalArchiveEntries === 'function') {
        const derivedLigapokalArchive = window.BwedlAppUtils.buildLigapokalArchiveEntries(window.ARCHIVE_TABLES);
        ligapokalArchive = { ...derivedLigapokalArchive, ...ligapokalArchive };
    }
    initializePlayerProfile();

    function routeExists(type, id) {
        if (type === 'league') {
            return Object.prototype.hasOwnProperty.call(leagueData.leagues || {}, id);
        }
        if (type === 'ranking') {
            return Object.prototype.hasOwnProperty.call(rankingData.rankings || {}, id);
        }
        if (type === 'ligapokalArchive') {
            return Object.prototype.hasOwnProperty.call(ligapokalArchive || {}, id);
        }
        if (type === 'club') {
            const clubIndex = Number(id);
            return /^(0|[1-9]\d*)$/.test(String(id)) &&
                Number.isSafeInteger(clubIndex) &&
                clubIndex >= 0 &&
                clubIndex < (clubData.clubs || []).length;
        }
        return [
            'dashboard',
            'profile',
            'clubList',
            'comparison',
            'alltime',
            'tools',
            'matchPreview',
            'wiki'
        ].includes(type) && id == null;
    }

    favorites = normalizeFavorites(favorites, clubCount, routeExists);
    persistLocalValue(localStorage, 'bwedl_favorites', favorites);

    function routeHash(route) {
        const type = route && route.type ? route.type : 'dashboard';
        const id = route && route.id != null ? `/${encodeURIComponent(String(route.id))}` : '';
        return `#${type}${id}`;
    }

    function routesMatch(left, right) {
        if (!left || !right || left.type !== right.type) return false;
        const leftId = left.id == null ? null : String(left.id);
        const rightId = right.id == null ? null : String(right.id);
        return leftId === rightId;
    }

    function initializeRouteFromLocation() {
        const route = window.BwedlAppUtils.parseAppHash(window.location.hash, routeExists);
        const canonicalHash = routeHash(route);
        if (!routesMatch(history.state, route) || window.location.hash !== canonicalHash) {
            history.replaceState(route, "", canonicalHash);
        }
        const shouldRender = !routesMatch(currentState, route);
        currentState = route;
        if (shouldRender) navigateTo(route.type, route.id, false);
        return route;
    }

    function setAppStatus(message) {
        const status = document.getElementById('app-status');
        if (status) status.textContent = message;
    }

    async function shareCurrentView(summary, preferredRoute) {
        const route = preferredRoute && routeExists(preferredRoute.type, preferredRoute.id)
            ? preferredRoute
            : currentState && routeExists(currentState.type, currentState.id)
            ? currentState
            : window.BwedlAppUtils.parseAppHash(window.location.hash, routeExists);
        const url = new URL(window.location.href);
        url.hash = routeHash(route);
        const canonicalUrl = url.toString();
        const text = typeof summary === 'string' && summary.trim()
            ? summary.trim()
            : 'BWEDL Stats';

        if (typeof navigator.share === 'function') {
            try {
                await navigator.share({ title: document.title || 'BWEDL Stats', text, url: canonicalUrl });
                setAppStatus('Ansicht wurde geteilt.');
                return true;
            } catch (error) {
                if (error && error.name === 'AbortError') {
                    setAppStatus('Teilen wurde abgebrochen.');
                    return false;
                }
                // Continue with the clipboard fallback for genuine share failures.
            }
        }

        try {
            if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
                throw new Error('Clipboard API unavailable');
            }
            await navigator.clipboard.writeText(canonicalUrl);
            setAppStatus('Link wurde in die Zwischenablage kopiert.');
            return true;
        } catch (_error) {
            setAppStatus('Link konnte nicht geteilt oder kopiert werden.');
            return false;
        }
    }

    const MATCH_PREVIEW_SESSION_KEY = 'bwedl_match_preview_game';

    function rememberMatchPreviewGame(game) {
        if (!game || typeof game !== 'object') return false;
        try {
            sessionStorage.setItem(MATCH_PREVIEW_SESSION_KEY, JSON.stringify(game));
            return true;
        } catch (_error) {
            return false;
        }
    }

    function readMatchPreviewGame() {
        try {
            const value = sessionStorage.getItem(MATCH_PREVIEW_SESSION_KEY);
            sessionStorage.removeItem(MATCH_PREVIEW_SESSION_KEY);
            if (!value) return null;
            const game = JSON.parse(value);
            return game && typeof game === 'object' ? game : null;
        } catch (_error) {
            return null;
        }
    }

    function normalizeClubAlias(value) {
        if (typeof value !== 'string') return '';
        const tokens = value
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLocaleLowerCase('de-DE')
            .replace(/ß/g, 'ss')
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .filter(Boolean);
        const legalSuffixIndex = /^\d+$/.test(tokens[tokens.length - 1] || '')
            ? tokens.length - 3
            : tokens.length - 2;
        if (tokens[legalSuffixIndex] === 'e' && tokens[legalSuffixIndex + 1] === 'v') {
            tokens.splice(legalSuffixIndex, 2);
        }
        return tokens.join(' ');
    }

    function clubNameAliases(club) {
        if (!club || typeof club !== 'object') return [];
        const knownAliases = {
            'alla haeeeehr': ['Alla Häeeehr'],
            'heavy weigths brotzingen': ['Heavy Weights Brötzingen'],
            'dc lightning arrows': ['DC Ligthning Arrows'],
            'dc mephistos': ["DC Mephisto's"],
            'dc striker s': ['DC Strikers'],
            'dc underground fool s': ['DC Underground Fools'],
        };
        const configured = Array.isArray(club.aliases)
            ? club.aliases
            : typeof club.aliases === 'string'
                ? [club.aliases]
                : [];
        const canonical = normalizeClubAlias(club.name);
        return [club.name, ...configured, ...(knownAliases[canonical] || [])]
            .map(normalizeClubAlias)
            .filter(Boolean);
    }

    function resolveHomeClub(game) {
        const homeAlias = normalizeClubAlias(game && game.home);
        if (!homeAlias || !clubData || !Array.isArray(clubData.clubs)) return null;
        const matches = [];
        clubData.clubs.forEach((club, index) => {
            clubNameAliases(club).forEach((clubAlias) => {
                const suffix = homeAlias.startsWith(`${clubAlias} `)
                    ? homeAlias.slice(clubAlias.length + 1)
                    : '';
                if (homeAlias === clubAlias || /^\d+$/.test(suffix)) {
                    matches.push({ club, index, matchLength: clubAlias.length });
                }
            });
        });
        if (matches.length === 0) return null;
        const longest = Math.max(...matches.map((match) => match.matchLength));
        const winners = matches.filter((match) => match.matchLength === longest);
        const uniqueIndexes = [...new Set(winners.map((match) => match.index))];
        return uniqueIndexes.length === 1 ? winners[0] : null;
    }

    function gameAddress(game) {
        if (!game || typeof game !== 'object') return '';
        const direct = [game.address, game.location]
            .find((value) => typeof value === 'string' && value.trim());
        if (direct) return direct.trim();

        const resolved = resolveHomeClub(game);
        const homeClub = resolved && resolved.club;
        if (!homeClub) return '';
        return [homeClub.venue, homeClub.street, homeClub.city]
            .filter((value) => typeof value === 'string' && value.trim() && value !== '-')
            .map((value) => value.trim())
            .join(', ');
    }

    function gameCompetition(game) {
        if (!game || typeof game !== 'object') return '';
        return [game.competition, game.league, game.leagueKey, game.leagueName]
            .find((value) => typeof value === 'string' && value.trim())?.trim() || '';
    }

    function buildMapsUrl(game) {
        const address = gameAddress(game);
        return address
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
            : '';
    }

    function gameShareText(game) {
        const matchup = [game && game.home, game && game.away]
            .filter((value) => typeof value === 'string' && value.trim())
            .join(' gegen ');
        const date = game && typeof game.dateStr === 'string' && game.dateStr.trim()
            ? game.dateStr.trim()
            : 'Termin offen';
        const competition = gameCompetition(game);
        const location = gameAddress(game);
        return [matchup || 'BWEDL-Spiel', date, competition, location].filter(Boolean).join(' · ');
    }

    function bestShareRoute(game) {
        const resolved = resolveHomeClub(game);
        return resolved ? { type: 'club', id: resolved.index } : null;
    }

    function buildGameActions(game) {
        if (!game || typeof game !== 'object') return [];
        const league = game.leagueKey || game.leagueName || game.league;
        const actions = [{
            key: 'preview',
            label: 'Match Preview',
            ariaLabel: `Match Preview für ${gameShareText(game)} öffnen`,
            activate: () => {
                rememberMatchPreviewGame(game);
                navigateTo('matchPreview');
            },
        }];
        if (league) {
            actions.unshift({
                key: 'league',
                label: 'Liga öffnen',
                ariaLabel: `${league} öffnen`,
                activate: () => navigateTo('league', league),
            });
        }
        actions.push({
            key: 'share',
            label: 'Teilen',
            ariaLabel: `${gameShareText(game)} teilen`,
            activate: () => shareCurrentView(gameShareText(game), bestShareRoute(game)),
        });
        const mapsUrl = buildMapsUrl(game);
        if (mapsUrl) {
            actions.push({
                key: 'maps',
                label: 'Route',
                ariaLabel: `Route zum Spielort für ${gameShareText(game)} öffnen`,
                href: mapsUrl,
                target: '_blank',
                rel: 'noopener noreferrer',
            });
        }
        return actions;
    }

    function createGameActionsElement(game) {
        const group = document.createElement('div');
        group.className = 'game-actions';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', `Aktionen für ${gameShareText(game)}`);
        buildGameActions(game).forEach((action) => {
            const control = document.createElement(action.href ? 'a' : 'button');
            control.className = `game-actions__button game-actions__button--${action.key}`;
            control.textContent = action.label;
            control.setAttribute('aria-label', action.ariaLabel);
            if (action.href) {
                control.href = action.href;
                control.target = action.target;
                control.rel = action.rel;
            } else {
                control.type = 'button';
                control.addEventListener('click', (event) => {
                    event.stopPropagation();
                    action.activate();
                });
            }
            control.addEventListener('click', (event) => event.stopPropagation());
            group.appendChild(control);
        });
        return group;
    }

    if (Object.keys(leagueData).length === 0) {
        const contentArea = document.getElementById('content-area');
        if (contentArea) {
            contentArea.innerHTML = `
                <div style="padding: 20px;">
                    <div class="skeleton-row" style="width: 40%; height: 30px; margin-bottom: 30px;"></div>
                    <div class="skeleton-row" style="width: 100%; height: 50px;"></div>
                    <div class="skeleton-row" style="width: 100%; height: 40px;"></div>
                    <div class="skeleton-row" style="width: 100%; height: 40px;"></div>
                    <div class="skeleton-row" style="width: 80%; height: 40px;"></div>
                </div>
            `;
        }
        fetch('league_data.json')
            .then(res => res.json())
            .then(data => {
                leagueData = data;
                init();
            })
            .catch(e => {
                console.error("Fetch failed", e);
                init();
            });
    } else {
        // Let the DOMContentLoaded callback finish defining route-specific classes
        // before a deep link can render one of them (for example #tools).
        queueMicrotask(init);
    }

    function init() {
        // Inject Styles for Highlighting
        if (!document.getElementById('my-profile-styles')) {
            const style = document.createElement('style');
            style.id = 'my-profile-styles';
            style.innerHTML = `
                .my-player-row {
                    background-color: rgba(59, 130, 246, 0.15) !important;
                    border-left: 3px solid #3b82f6 !important;
                }
                .my-player-text {
                    color: #60a5fa !important;
                    font-weight: bold;
                }
            `;
            document.head.appendChild(style);
        }

        // 0. Pre-sort Clubs
        if (clubData.clubs && clubData.clubs.length > 0) {
            clubData.clubs.sort((a, b) => {
                if (!a.name) return 1;
                if (!b.name) return -1;
                return a.name.localeCompare(b.name);
            });
        }

        // Build Index immediately if data present
        try {
            buildSearchIndex();
        } catch (e) {
            console.error("Search Build Error", e);
        }

        // Safety Fallback: Re-build after 2 seconds to ensure data is settled
        setTimeout(() => {
            // Use global window.searchIndex to check
            if (!window.searchIndex || window.searchIndex.length < 50) {
                // Search index fallback: rebuild if initial build yielded too few entries
                buildSearchIndex();
            }
        }, 2000);

        // --- Render Sidebar ---
        // nav.innerHTML = ""; // Don't clear immediately if we want to show debug above.
        // Instead, clear only if we have data to show.
        if (leagueData.leagues) {
            nav.innerHTML = ""; // Clear for fresh render

            // --- Dashboard Link ---
            const dashboardLink = document.createElement('button');
            dashboardLink.type = 'button';
            dashboardLink.className = 'nav-section-header';
            dashboardLink.innerHTML = '🏠 DASHBOARD';
            dashboardLink.style.padding = "15px";
            dashboardLink.style.cursor = "pointer";
            dashboardLink.style.color = "#f8fafc";
            dashboardLink.style.fontWeight = "bold";
            dashboardLink.style.backgroundColor = "#1e293b";
            dashboardLink.style.borderBottom = "1px solid #334155";
            dashboardLink.onmouseover = () => dashboardLink.style.backgroundColor = "#334155";
            dashboardLink.onmouseout = () => dashboardLink.style.backgroundColor = "#1e293b";
            dashboardLink.onclick = () => navigateTo('dashboard');
            nav.appendChild(dashboardLink);

            // --- My Profile Link ---
            const profileLink = document.createElement('button');
            profileLink.type = 'button';
            profileLink.id = 'my-profile-link';
            profileLink.className = 'nav-section-header';
            replaceWithIconLabel(profileLink, '👤', myPlayerProfile ? myPlayerProfile.name : 'Mein Profil');
            profileLink.style.padding = "10px 15px";
            profileLink.style.cursor = "pointer";
            profileLink.style.color = "#94a3b8";
            profileLink.style.fontSize = "0.9em";
            profileLink.style.borderBottom = "1px solid #334155";
            profileLink.onmouseover = () => profileLink.style.color = "#f8fafc";
            profileLink.onmouseout = () => profileLink.style.color = "#94a3b8";
            profileLink.onclick = () => navigateTo('profile');
            nav.appendChild(profileLink);
        }

        // 1. Leagues
        if (leagueData.leagues) {
            const leagueHeader = document.createElement('button');
            leagueHeader.type = 'button';
            leagueHeader.className = 'nav-section-header';
            leagueHeader.innerHTML = '<span style="display:inline-block; width:15px; transition: transform 0.2s;">▶</span> LIGEN';
            leagueHeader.style.padding = "10px 15px 5px";
            leagueHeader.style.color = "#888";
            leagueHeader.style.fontSize = "0.8em";
            leagueHeader.style.fontWeight = "bold";
            leagueHeader.style.cursor = "pointer";
            nav.appendChild(leagueHeader);

            const container = document.createElement('div');
            container.id = 'sidebar-leagues';
            container.style.display = "none"; // Hidden by default
            container.style.paddingLeft = "0";
            leagueHeader.setAttribute('aria-controls', container.id);
            leagueHeader.setAttribute('aria-expanded', 'false');

            leagueHeader.addEventListener('click', () => {
                const isHidden = container.style.display === "none";
                container.style.display = isHidden ? "block" : "none";
                leagueHeader.setAttribute('aria-expanded', String(isHidden));
                leagueHeader.querySelector('span').style.transform = isHidden ? "rotate(90deg)" : "rotate(0deg)";
            });

            const leagues = Object.keys(leagueData.leagues).sort();

            // Group leagues by prefix
            const leagueGroups = {};
            const ligapokalGroup = [];
            leagues.forEach(leagueName => {
                if (leagueName.toLowerCase().includes('ligapokal')) {
                    ligapokalGroup.push(leagueName);
                    return;
                }
                let parts = leagueName.split(' ');
                let category = parts[0];
                if (leagueName.toLowerCase().includes('klasse')) {
                    category = parts[0]; // e.g. "A-Klasse"
                } else if (leagueName.toLowerCase().includes('liga')) {
                    // e.g. "Bezirksliga", "Kreisliga"
                    category = parts[0];
                } else {
                    category = "Sonstige";
                }

                if (!leagueGroups[category]) leagueGroups[category] = [];
                leagueGroups[category].push(leagueName);
            });

            Object.keys(leagueGroups).sort().forEach((category, categoryIndex) => {
                // Header
                const catHeader = document.createElement('button');
                catHeader.type = 'button';
                catHeader.className = 'sidebar-accordion-header';
                catHeader.innerHTML = `<span>${category}</span> <span class="sidebar-accordion-icon">▶</span>`;

                // Content
                const catContent = document.createElement('div');
                catContent.className = 'sidebar-accordion-content';
                catContent.id = `sidebar-league-group-${categoryIndex}`;
                catHeader.setAttribute('aria-controls', catContent.id);
                catHeader.setAttribute('aria-expanded', 'false');

                leagueGroups[category].forEach(leagueName => {
                    const el = document.createElement('button');
                    el.type = 'button';
                    el.className = 'league-item';
                    el.textContent = leagueName;
                    el.addEventListener('click', () => {
                        navigateTo('league', leagueName);
                    });
                    catContent.appendChild(el);
                });

                catHeader.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent parent toggle
                    catHeader.classList.toggle('active');
                    catContent.classList.toggle('open');
                    catHeader.setAttribute('aria-expanded', String(catContent.classList.contains('open')));
                });

                container.appendChild(catHeader);
                container.appendChild(catContent);
            });
            nav.appendChild(container); // Add the container to nav

            // 1b. Ligapokal (current + archive seasons)
            {
                const lpHeader = document.createElement('button');
                lpHeader.type = 'button';
                lpHeader.className = 'nav-section-header';
                lpHeader.innerHTML = '<span style="display:inline-block; width:15px; transition: transform 0.2s;">▶</span> LIGAPOKAL';
                lpHeader.style.padding = "10px 15px 5px";
                lpHeader.style.color = "#888";
                lpHeader.style.fontSize = "0.8em";
                lpHeader.style.fontWeight = "bold";
                lpHeader.style.cursor = "pointer";
                nav.appendChild(lpHeader);

                const lpContainer = document.createElement('div');
                lpContainer.id = 'sidebar-ligapokal';
                lpContainer.style.display = "none";
                lpContainer.style.paddingLeft = "0";
                lpHeader.setAttribute('aria-controls', lpContainer.id);
                lpHeader.setAttribute('aria-expanded', 'false');

                lpHeader.addEventListener('click', () => {
                    const isHidden = lpContainer.style.display === "none";
                    lpContainer.style.display = isHidden ? "block" : "none";
                    lpHeader.setAttribute('aria-expanded', String(isHidden));
                    lpHeader.querySelector('span').style.transform = isHidden ? "rotate(90deg)" : "rotate(0deg)";
                });

                const visibleLigapokalSeasons = new Set();

                // Current season Ligapokal entries
                ligapokalGroup.forEach(lpName => {
                    const el = document.createElement('button');
                    el.type = 'button';
                    el.className = 'league-item';
                    el.textContent = lpName;
                    el.addEventListener('click', () => {
                        navigateTo('league', lpName);
                    });
                    lpContainer.appendChild(el);
                    visibleLigapokalSeasons.add(lpName.toLocaleLowerCase('de-DE'));
                });

                // Historical Ligapokal seasons from archive
                if (ligapokalArchive && Object.keys(ligapokalArchive).length > 0) {
                    // Sort seasons descending (newest first)
                    const archiveSeasons = Object.keys(ligapokalArchive).sort().reverse();
                    archiveSeasons.forEach(seasonName => {
                        if (visibleLigapokalSeasons.has(seasonName.toLocaleLowerCase('de-DE'))) return;
                        const el = document.createElement('button');
                        el.type = 'button';
                        el.className = 'league-item';
                        el.textContent = seasonName;
                        el.style.color = '#94a3b8';
                        el.addEventListener('click', () => {
                            navigateTo('ligapokalArchive', seasonName);
                        });
                        lpContainer.appendChild(el);
                        visibleLigapokalSeasons.add(seasonName.toLocaleLowerCase('de-DE'));
                    });
                }

                nav.appendChild(lpContainer);
            }
        }

        // 2. Rankings
        if (rankingData.rankings) {
            const rankingHeader = document.createElement('button');
            rankingHeader.type = 'button';
            rankingHeader.className = 'nav-section-header';
            rankingHeader.innerHTML = '<span style="display:inline-block; width:15px; transition: transform 0.2s;">▶</span> RANGLISTEN';
            rankingHeader.style.padding = "15px 15px 5px";
            rankingHeader.style.color = "#888";
            rankingHeader.style.fontSize = "0.8em";
            rankingHeader.style.fontWeight = "bold";
            rankingHeader.style.cursor = "pointer";
            nav.appendChild(rankingHeader);

            const container = document.createElement('div');
            container.id = 'sidebar-rankings';
            container.style.display = "none";
            container.style.paddingLeft = "0";
            rankingHeader.setAttribute('aria-controls', container.id);
            rankingHeader.setAttribute('aria-expanded', 'false');

            rankingHeader.addEventListener('click', () => {
                const isHidden = container.style.display === "none";
                container.style.display = isHidden ? "block" : "none";
                rankingHeader.setAttribute('aria-expanded', String(isHidden));
                rankingHeader.querySelector('span').style.transform = isHidden ? "rotate(90deg)" : "rotate(0deg)";
            });

            const ranks = Object.keys(rankingData.rankings).sort();
            ranks.forEach(rankName => {
                const el = document.createElement('button');
                el.type = 'button';
                el.className = 'league-item';
                el.textContent = rankName;
                el.addEventListener('click', () => {
                    navigateTo('ranking', rankName);
                });
                container.appendChild(el);
            });
            nav.appendChild(container);
        }

        // 3. Clubs: compact access instead of the complete club catalogue.
        if (clubData.clubs && clubData.clubs.length > 0) {
            const container = document.createElement('div');
            const header = createDisclosureButton('VEREINE', 'club-sidebar-shortcuts', container, false);
            header.className = 'nav-section-header club-sidebar-disclosure';
            header.style.padding = "15px 15px 5px";
            header.style.color = "#888";
            header.style.fontSize = "0.8em";
            header.style.fontWeight = "bold";
            header.style.cursor = "pointer";
            header.title = "Vereinszugänge ein- oder ausklappen";
            nav.appendChild(header);

            container.style.paddingLeft = "0";
            clubSidebarContainer = container;

            renderClubSidebarShortcuts();
            nav.appendChild(container);
        }

        // 4. Comparison (New)
        const compareLink = document.createElement('button');
        compareLink.type = 'button';
        compareLink.className = 'nav-section-header';
        compareLink.innerHTML = '🆚 H2H VERGLEICH';
        compareLink.style.padding = "15px 15px 5px";
        compareLink.style.color = "#888";
        compareLink.style.fontSize = "0.8em";
        compareLink.style.fontWeight = "bold";
        compareLink.style.cursor = "pointer";
        compareLink.onclick = () => navigateTo('comparison');
        nav.appendChild(compareLink);

        // 5. All-Time Table (New)
        const allTimeLink = document.createElement('button');
        allTimeLink.type = 'button';
        allTimeLink.className = 'nav-section-header';
        allTimeLink.innerHTML = '🏆 EWIGE TABELLE';
        allTimeLink.style.padding = "10px 15px 5px";
        allTimeLink.style.color = "#888";
        allTimeLink.style.fontSize = "0.8em";
        allTimeLink.style.fontWeight = "bold";
        allTimeLink.style.cursor = "pointer";
        allTimeLink.onclick = () => navigateTo('alltime');
        nav.appendChild(allTimeLink);

        // 6. Tools (New)
        const toolsLink = document.createElement('button');
        toolsLink.type = 'button';
        toolsLink.className = 'nav-section-header';
        toolsLink.innerHTML = '🧮 TOOLS';
        toolsLink.style.padding = "10px 15px 5px";
        toolsLink.style.color = "#888";
        toolsLink.style.fontSize = "0.8em";
        toolsLink.style.fontWeight = "bold";
        toolsLink.style.cursor = "pointer";
        toolsLink.onclick = () => navigateTo('tools');
        nav.appendChild(toolsLink);

        // 7. Wiki / Help (New)
        const wikiLink = document.createElement('button');
        wikiLink.type = 'button';
        wikiLink.className = 'nav-section-header';
        wikiLink.innerHTML = '📘 ANLEITUNG / WIKI';
        wikiLink.style.padding = "10px 15px 5px";
        wikiLink.style.color = "#888";
        wikiLink.style.fontSize = "0.8em";
        wikiLink.style.fontWeight = "bold";
        wikiLink.style.cursor = "pointer";
        wikiLink.onclick = () => navigateTo('wiki');
        nav.appendChild(wikiLink);

        // Show Favorites
        renderFavoritesSidebar();

        // VERSION FOOTER

        // Compare only after every bundled/fetched data source has been initialized.
        refreshVisitSnapshotBaseline(true);

        // Resolve the initial view from the URL after all route data is available.
        initializeRouteFromLocation();

        // Check for Update Snapshot (show summary if recently updated)
        try {
            if (typeof checkUpdateSnapshot === 'function') {
                checkUpdateSnapshot();
            }
        } catch (e) { console.error(e); }
    }

    // --- Search & Navigation Globals (Moved to Top) ---
    // window.searchIndex = []; 
    // let searchIndex = window.searchIndex; 
    // let historyStack = [];
    // let isNavigatingBack = false;
    // let currentState = null;



    function buildSearchIndex() {
        window.searchIndex = [];
        const searchIndex = window.searchIndex; // Local ref for pusb operations



        // 1. Leagues
        if (leagueData.leagues) {
            Object.keys(leagueData.leagues).forEach(l => {
                searchIndex.push({ label: l, type: "Liga", category: 'league', id: l });
            });
        }

        // 2. Clubs
        if (clubData.clubs) {
            clubData.clubs.forEach((c, idx) => {
                searchIndex.push({ label: c.name, type: "Verein", category: 'club', id: idx });
            });
        }

        // 3. Players (grouped by exact person identity)
        if (rankingData.players) {
            // Pre-build club lookup maps for O(1) access instead of O(n) per player
            const clubNameMap = new Map();
            const clubIdxMap = new Map();
            if (clubData.clubs) {
                clubData.clubs.forEach((c, idx) => {
                    clubNameMap.set(c.number, c.name);
                    clubIdxMap.set(c.number, idx);
                });
            }

            window.BwedlAppUtils.groupRankingPeople(rankingData.players).forEach((group) => {
                const representative = group.records[0];
                const clubIdx = clubIdxMap.get(representative.v_nr);
                const clubName = clubNameMap.get(representative.v_nr) || representative.company || 'Vereinslos';
                searchIndex.push({
                    label: group.name,
                    type: "Spieler",
                    context: `${clubName} · ${group.categories.join(', ')}`,
                    category: clubIdx === undefined ? 'player' : 'club',
                    id: clubIdx === undefined ? group.personKey : clubIdx,
                    profileGroup: group,
                });
            });
        }

        if (searchInput) {
            searchInput.placeholder = `Suche (${searchIndex.length} Einträge)...`;
        }
    }



    // --- Favorites Logic ---
    // (favorites state moved to top of file)

    function appendClubSidebarLink(parent, label, action, modifier = '') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `league-item club-sidebar-link ${modifier}`.trim();
        button.textContent = label;
        button.addEventListener('click', action);
        parent.appendChild(button);
    }

    function renderClubSidebarShortcuts() {
        if (!clubSidebarContainer) return;
        clubSidebarContainer.replaceChildren();

        appendClubSidebarLink(
            clubSidebarContainer,
            'Vereinsübersicht',
            () => navigateTo('clubList', null),
            'club-sidebar-link--primary',
        );
        appendClubSidebarLink(clubSidebarContainer, 'Verein suchen', () => {
            navigateTo('clubList', null);
            const clubSearch = document.getElementById('club-search');
            if (clubSearch) clubSearch.focus();
        });

        const appendGroup = (title, entries) => {
            const heading = document.createElement('div');
            heading.className = 'club-sidebar-group-title';
            heading.textContent = title;
            clubSidebarContainer.appendChild(heading);

            if (entries.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'club-sidebar-empty';
                empty.textContent = 'Noch keine';
                clubSidebarContainer.appendChild(empty);
                return;
            }

            entries.forEach(({ club, index }) => {
                appendClubSidebarLink(clubSidebarContainer, club.name, () => navigateTo('club', index));
            });
        };

        const visibleFavorites = Object.freeze(normalizeFavorites(favorites, clubData.clubs.length, routeExists));
        const favoriteClubs = visibleFavorites
            .filter((favorite) => favorite.type === 'club')
            .map((favorite) => ({ club: clubData.clubs[Number(favorite.id)], index: Number(favorite.id) }))
            .filter(({ club, index }) => club && Number.isSafeInteger(index))
            .slice(0, 5);
        const recentClubs = recentClubIds
            .map((index) => ({ club: clubData.clubs[index], index }))
            .filter(({ club }) => club)
            .slice(0, 5);

        appendGroup('Favoriten', favoriteClubs);
        appendGroup('Zuletzt angesehen', recentClubs);
    }

    function rememberRecentClub(id) {
        const clubIndex = canonicalClubId(id, clubData.clubs.length);
        if (clubIndex === null) return;
        recentClubIds = [clubIndex, ...recentClubIds.filter((recentId) => recentId !== clubIndex)].slice(0, 5);
        persistLocalValue(localStorage, RECENT_CLUBS_STORAGE_KEY, recentClubIds);
        renderClubSidebarShortcuts();
    }

    function saveFavorites() {
        const normalizedFavorites = normalizeFavorites(favorites, clubCount, routeExists);
        favorites.splice(0, favorites.length, ...normalizedFavorites);
        persistLocalValue(localStorage, 'bwedl_favorites', favorites);
        renderFavoritesSidebar();
        renderClubSidebarShortcuts();
    }

    function toggleFavorite(type, id, name) {
        const route = canonicalFavoriteRoute(type, id, clubCount);
        if (!route || typeof name !== 'string' || !name.trim() ||
            typeof routeExists !== 'function' || !routeExists(route.type, route.id)) return;
        const normalizedFavorites = normalizeFavorites(favorites, clubCount, routeExists);
        const routeKey = favoriteRouteKey(route.type, route.id);
        const isAlreadyFavorite = normalizedFavorites.some((favorite) => (
            favoriteRouteKey(favorite.type, favorite.id) === routeKey
        ));
        const nextFavorites = isAlreadyFavorite
            ? normalizedFavorites.filter((favorite) => favoriteRouteKey(favorite.type, favorite.id) !== routeKey)
            : [...normalizedFavorites, Object.freeze({ type: route.type, id: route.id, name })];
        favorites.splice(0, favorites.length, ...nextFavorites);
        saveFavorites();

        const btn = document.getElementById('fav-btn');
        if (btn) {
            updateFavBtnState(btn, route.type, route.id);
        }
    }

    function isFavorite(type, id) {
        const route = canonicalFavoriteRoute(type, id, clubCount);
        if (!route || typeof routeExists !== 'function' || !routeExists(route.type, route.id)) return false;
        const routeKey = favoriteRouteKey(route.type, route.id);
        return normalizeFavorites(favorites, clubCount, routeExists).some((favorite) => (
            favoriteRouteKey(favorite.type, favorite.id) === routeKey
        ));
    }

    function updateFavBtnState(btn, type, id) {
        const isFav = isFavorite(type, id);
        btn.innerHTML = isFav ? "★" : "☆"; // Solid star or hollow star
        btn.style.color = isFav ? "#fbbf24" : "#94a3b8";
        btn.title = isFav ? "Von Favoriten entfernen" : "Zu Favoriten hinzufügen";
    }

    function renderFavoritesSidebar() {
        const existing = document.getElementById('fav-section');
        if (existing) existing.remove();

        const visibleFavorites = Object.freeze(normalizeFavorites(favorites, clubCount, routeExists));
        if (visibleFavorites.length === 0) return;

        const container = document.createElement('div');
        container.id = 'fav-section';
        container.style.borderBottom = "1px solid #334155";
        container.style.marginBottom = "10px";
        container.style.paddingBottom = "10px";

        const header = document.createElement('div');
        header.className = 'nav-section-header';
        header.textContent = "FAVORITEN";
        header.style.padding = "10px 15px 5px";
        header.style.color = "#fbbf24";
        header.style.fontSize = "0.8em";
        header.style.fontWeight = "bold";
        container.appendChild(header);

        visibleFavorites.forEach(fav => {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'league-item';
            replaceWithIconLabel(el, '★', fav.name);
            el.firstElementChild.style.color = '#fbbf24';
            el.addEventListener('click', () => {
                navigateTo(fav.type, fav.id);
            });
            container.appendChild(el);
        });

        if (nav.firstChild) {
            nav.insertBefore(container, nav.firstChild);
        } else {
            nav.appendChild(container);
        }
    }

    // --- Dashboard Logic ---
    function calculatePlayerStats(p) {
        let sum = 0;
        let count = 0;
        if (!p.rounds) return { avg: 0, count: 0 };

        for (let i = 1; i <= 18; i++) {
            const val = p.rounds[`R${i}`];
            if (val && val !== "&nbsp;" && val !== "x" && !isNaN(parseInt(val))) {
                sum += parseInt(val);
                count++;
            }
        }
        return {
            avg: count > 0 ? (sum / count) : 0,
            count: count
        };
    }

    function extractLeagueLeader(tableHtml) {
        const rows = safeTableRowsFromHtml(tableHtml);
        for (const cells of rows) {
            if (cells.length > 2) {
                const rankText = cells[0].trim().replace('.', '');
                if (rankText === '1') {
                    return cells[1].trim();
                }
            }
        }
        return null;
    }

    // --- Dashboard 2.0 Helpers ---

    function normalizeTeamName(name) {
        if (!name) return "";
        // Convert to lowercase, remove non-alphanumeric (keeping spaces), collapse spaces, trim
        // This ensures "Team" and "Team 2" are distinct ("team" vs "team 2")
        return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    }

    function parseGermanDate(dateStr) {
        if (!dateStr) return null;
        // Format example: "28.11.2025 20:00"
        // Try to match standard date with optional time
        /* 
           Regex Analysis:
           (\d{1,2})\.     -> Day (Group 1)
           \s*(\d{1,2})\.  -> Month (Group 2)
           \s*(\d{2,4})    -> Year (Group 3)
           .*?             -> Match anything in between (like spaces)
           (\d{1,2}:\d{2})? -> Optional Time (Group 4)
        */
        const match = dateStr.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})(?:\s+(\d{1,2}:\d{2}))?/);
        if (match) {
            let year = match[3];
            if (year.length === 2) year = "20" + year; // Handle 2-digit year

            let timeStr = match[4] || "00:00"; // Default to midnight if no time found
            let [hours, minutes] = timeStr.split(':').map(Number);

            // Construct Date object
            // Note: Date(y, m, d, h, m) constructor uses local time.
            // Month is 0-indexed in JS Date constructor (0=Jan, 11=Dec)
            return new Date(year, parseInt(match[2]) - 1, parseInt(match[1]), hours, minutes);
        }
        return null;
    }

    function getTeamSchedule(leagueKey, myTeamName) {
        const schedule = [];
        const league = leagueData.leagues[leagueKey];
        if (!league || !league.match_days) return schedule;

        const normMyTeam = normalizeTeamName(myTeamName);
        if (!normMyTeam || normMyTeam.length < 2) return schedule; // Guard against empty searches

        Object.keys(league.match_days).forEach(roundKey => {
            const roundText = league.match_days[roundKey];
            const lines = roundText.split('\n');

            lines.forEach(line => {
                const parts = line.split(/\s+-\s+/);
                if (parts.length < 2) return;

                // 1. Process Left Side (Date + Home Team)
                let leftRaw = parts[0].trim();
                let homeTeamRaw = leftRaw;
                let dateStr = "";

                // Regex for German Date+Time at start: "Do. 28.08.2025 20:00" or "18.1.26 0:00"
                const dateMatch = leftRaw.match(/^([A-Za-z]{2}\.?\s*)?(\d{1,2}\.\s*\d{1,2}\.\s*\d{2,4}\s+\d{1,2}:\d{2})/);
                if (dateMatch) {
                    dateStr = dateMatch[0]; // Capture full date string
                    homeTeamRaw = leftRaw.substring(dateMatch[0].length).trim();
                }

                // 2. Process Right Side (Away Team + Score)
                let rightRaw = parts[1].trim();
                let awayTeamRaw = rightRaw;
                let scoreStr = "---";

                // Extract score at the end: " 9:7", " ---", " : "
                const scoreMatch = rightRaw.match(/(\d+:\d+|---|:\s*)\s*$/);
                if (scoreMatch) {
                    scoreStr = scoreMatch[1];
                    awayTeamRaw = rightRaw.substring(0, scoreMatch.index).trim();
                }

                // 3. Strict Match Check
                const normHome = normalizeTeamName(homeTeamRaw);
                const normAway = normalizeTeamName(awayTeamRaw);

                // Strict equality on normalized strings
                // "dc schmbergereck" !== "dc schmbergereck 2"
                const isHome = normHome === normMyTeam;
                const isAway = normAway === normMyTeam;

                if (!isHome && !isAway) return;

                const opponent = isHome ? awayTeamRaw : homeTeamRaw;
                const dateObj = dateStr ? parseGermanDate(dateStr) : null;

                const myScore = isHome ? scoreStr.split(':')[0] : scoreStr.split(':')[1];
                const opScore = isHome ? scoreStr.split(':')[1] : scoreStr.split(':')[0];

                const isPending = scoreStr === '---' || !scoreStr.includes(':');

                const roundNum = parseInt(roundKey.match(/\d+/)[0]);

                schedule.push({
                    round: roundNum,
                    date: dateObj,
                    dateStr: dateStr,
                    home: homeTeamRaw,
                    away: awayTeamRaw,
                    opponent: opponent,
                    score: scoreStr,
                    isHome: isHome,
                    isPending: isPending,
                    myTeamResult: isPending ? 'pending' : (parseInt(myScore) > parseInt(opScore) ? 'Won' : (parseInt(myScore) < parseInt(opScore) ? 'Lost' : 'Draw'))
                });
            });
        });

        return schedule.sort((a, b) => a.round - b.round);
    }

    function buildCurrentVisitSnapshot() {
        if (!window.BwedlAppUtils) return null;

        const domains = dataStatus && dataStatus.domains ? dataStatus.domains : {};
        const domainTimestamps = Object.keys(domains).reduce((result, key) => {
            if (domains[key] && domains[key].updated_at) result[key] = domains[key].updated_at;
            return result;
        }, {});
        const timestamps = Object.values(domains)
            .map((domain) => domain && domain.updated_at)
            .filter(Boolean)
            .sort();
        const rankingStatus = domains.rankings || {};
        const leagueStatus = domains.leagues || {};
        let player = null;
        let team = null;
        let nextGame = null;

        if (myPlayerProfile && Array.isArray(rankingData.players)) {
            const selected = getMyPrimaryPlayer();
            if (selected) {
                const canonicalName = window.BwedlAppUtils.canonicalRankingPlayerName(selected.name);
                player = {
                    canonicalName,
                    displayName: selected.name,
                    rank: selected.rank,
                    points: selected.points,
                    rankingClass: selected.league,
                    sourceSeason: rankingStatus.season || null,
                    sourceState: rankingStatus.state || null,
                    sourceKey: ['rankings', rankingStatus.season || 'unknown'].join(':'),
                };

                const selectedTeam = myTeamName || selected.company || null;
                if (selectedTeam && leagueData.leagues) {
                    const schedule = [];
                    Object.keys(leagueData.leagues).forEach((leagueKey) => {
                        getTeamSchedule(leagueKey, selectedTeam).forEach((game) => {
                            schedule.push({ ...game, leagueKey });
                        });
                    });
                    const resultCount = schedule.filter((game) => !game.isPending).length;
                    team = {
                        id: `${selected.v_nr || 'team'}:${normalizeTeamName(selectedTeam)}`,
                        name: selectedTeam,
                        resultCount,
                        resultFingerprint: window.BwedlAppUtils.buildTeamResultsFingerprint(schedule),
                        sourceSeason: leagueStatus.season || null,
                        sourceState: leagueStatus.state || null,
                        sourceKey: ['leagues', leagueStatus.season || 'unknown'].join(':'),
                    };
                    const upcoming = window.BwedlAppUtils.selectUpcomingGames(schedule, new Date())[0];
                    if (upcoming) {
                        nextGame = {
                            key: [
                                upcoming.leagueKey || '',
                                upcoming.round || '',
                                normalizeTeamName(upcoming.home),
                                normalizeTeamName(upcoming.away),
                            ].join(':'),
                            date: upcoming.date,
                            opponent: upcoming.opponent,
                            location: gameAddress(upcoming) || null,
                        };
                    }
                }
            }
        }

        return window.BwedlAppUtils.buildVisitSnapshot({
            data: {
                key: timestamps.join('|'),
                timestamps: domainTimestamps,
                updatedAt: timestamps.length > 0 ? timestamps[timestamps.length - 1] : null,
            },
            player,
            team,
            nextGame,
        });
    }

    function refreshVisitSnapshotBaseline(compareWithPrevious = false) {
        if (!window.BwedlAppUtils) return;
        visitChangesLifecycle = window.BwedlAppUtils.startVisitChangesLifecycle({
            storage: localStorage,
            key: VISIT_SNAPSHOT_STORAGE_KEY,
            comparePrevious: compareWithPrevious,
            buildCurrentSnapshot: buildCurrentVisitSnapshot,
        });
    }

    function calculateTrend(p) {
        if (!p.rounds) return null;
        // Rounds are R1, R2, etc. convert to array
        const scores = [];
        for (let i = 1; i <= 18; i++) {
            const val = p.rounds[`R${i}`];
            if (val && val !== "&nbsp;" && val !== "x" && !isNaN(parseInt(val))) {
                scores.push({ r: i, s: parseInt(val) });
            }
        }
        scores.sort((a, b) => a.r - b.r);

        if (scores.length < 3) return { dir: 'flat', val: 0 };

        const last3 = scores.slice(-3);
        const last3Avg = last3.reduce((a, b) => a + b.s, 0) / 3;
        const totalAvg = parseFloat(String(p.avg || 0).replace(',', '.'));

        const diff = last3Avg - totalAvg;
        return {
            dir: diff > 0.5 ? 'up' : (diff < -0.5 ? 'down' : 'flat'),
            diff: Math.abs(diff).toFixed(1),
            last3Avg: last3Avg.toFixed(1)
        };
    }

    // --- Helper to extract ALL teams from all leagues ---
    function getAllLeagueTeams() {
        const teams = new Set();
        if (typeof leagueData === 'undefined' || !leagueData.leagues) return [];

        Object.values(leagueData.leagues).forEach(league => {
            if (league.match_days) {
                Object.values(league.match_days).forEach(dayContent => {
                    const lines = dayContent.split('\n');
                    lines.forEach(line => {
                        // Split strict by " - " to isolate home and away sides
                        const parts = line.split(/\s+-\s+/);
                        if (parts.length >= 2) {
                            let left = parts[0].trim();

                            // Aggressive regex to strip German Date/Time prefix
                            // Matches: "Di. 28.08.2025 20:00 " or "18.1.26 0:00 " etc.
                            // Components: Optional Day (Mo.|Di.|...), Date (D.M.YY or DD.MM.YYYY), Time (H:MM or HH:MM)
                            const dateTimeRegex = /^([A-Za-z]{2}\.?\s*)?(\d{1,2}\.\s*\d{1,2}\.\s*\d{2,4})\s+(\d{1,2}:\d{2})\s+/;
                            const match = left.match(dateTimeRegex);
                            if (match) {
                                left = left.replace(match[0], '').trim();
                            } else {
                                // Fallback: try simpler patterns if full date-time is missing but chunks exist
                                // e.g. Just date "28.08.2025 "
                                const dateOnly = /^(\d{1,2}\.\s*\d{1,2}\.\s*\d{2,4})\s+/;
                                const dMatch = left.match(dateOnly);
                                if (dMatch) left = left.replace(dMatch[0], '').trim();
                            }

                            let right = parts[1].trim();
                            // Strip score at the end: " 12:4" or " ---"
                            const scoreMatch = right.match(/(\s+\d+:\d+|\s+---|\s+:\s*|\s*:\s*)$/);
                            if (scoreMatch) {
                                right = right.substring(0, scoreMatch.index).trim();
                            }

                            if (left.length > 2) teams.add(left);
                            if (right.length > 2) teams.add(right);
                        }
                    });
                });
            }
        });
        return Array.from(teams).sort();
    }

    function findClubTeams(clubName) {
        const allTeams = getAllLeagueTeams();
        const normClub = normalizeTeamName(clubName);
        return allTeams.filter(t => normalizeTeamName(t).includes(normClub));
    }

    function renderProfileSelection() {
        topBarTitle.textContent = "Mein Profil";
        contentArea.innerHTML = '';

        const profileGroups = window.BwedlAppUtils.groupRankingPeople(rankingData.players || []);
        const draft = createPlayerProfileDraft(
            window.BwedlAppUtils,
            myPlayerResolution.status === 'resolved' ? myPlayerResolution : null,
        );

        const container = document.createElement('div');
        container.className = "fade-in";
        container.style.padding = "20px";
        container.style.maxWidth = "600px";
        container.style.margin = "0 auto";

        const card = document.createElement('div');
        card.style.background = "#1e293b";
        card.style.padding = "25px";
        card.style.borderRadius = "8px";
        card.style.border = "1px solid #334155";
        card.style.boxShadow = "0 4px 6px -1px rgba(0, 0, 0, 0.5)";

        const title = document.createElement('h2');
        title.textContent = "Spieler auswählen";
        title.style.color = "#f8fafc";
        title.style.marginBottom = "20px";
        title.style.textAlign = "center";
        card.appendChild(title);

        const desc = document.createElement('p');
        desc.textContent = "Wähle deinen Namen aus der Liste und bestätige deine Mannschaft, um dein Dashboard zu aktivieren.";
        desc.style.color = "#94a3b8";
        desc.style.textAlign = "center";
        desc.style.marginBottom = "30px";
        card.appendChild(desc);

        const profileStatus = document.createElement('p');
        profileStatus.className = 'profile-selection-status';
        profileStatus.setAttribute('role', 'status');
        profileStatus.setAttribute('aria-live', 'polite');
        if (legacyProfileNeedsConfirmation) {
            profileStatus.textContent = 'Der bisher gespeicherte Name ist nicht eindeutig. Bitte wähle den exakten Spielervorschlag und bestätige die primäre Klasse.';
            profileStatus.classList.add('profile-selection-status--warning');
        }
        card.appendChild(profileStatus);

        // --- Name Input Group ---
        const inputGroup = document.createElement('div');
        inputGroup.style.marginBottom = "20px";
        inputGroup.style.position = "relative";

        const label = document.createElement('label');
        label.textContent = "Name suchen";
        label.style.display = "block";
        label.style.color = "#e2e8f0";
        label.style.marginBottom = "8px";
        inputGroup.appendChild(label);

        const input = document.createElement('input');
        input.id = 'profile-player-search-input';
        input.type = "text";
        input.style.width = "100%";
        input.style.padding = "12px";
        input.style.borderRadius = "6px";
        input.style.border = "1px solid #475569";
        input.style.background = "#0f172a";
        input.style.color = "white";
        input.placeholder = "Z.B. Max Mustermann";
        input.value = myPlayerName || "";
        input.autocomplete = "off";
        input.setAttribute('aria-controls', 'profile-player-suggestions');
        input.setAttribute('aria-expanded', 'false');
        label.setAttribute('for', input.id);

        const suggestionsBox = document.createElement('ul');
        suggestionsBox.id = 'profile-player-suggestions';
        suggestionsBox.setAttribute('aria-label', 'Spielervorschläge');
        suggestionsBox.style.listStyle = 'none';
        suggestionsBox.style.position = "absolute";
        suggestionsBox.style.top = "100%";
        suggestionsBox.style.left = "0";
        suggestionsBox.style.right = "0";
        suggestionsBox.style.background = "#1e293b";
        suggestionsBox.style.border = "1px solid #475569";
        suggestionsBox.style.borderRadius = "0 0 6px 6px";
        suggestionsBox.style.zIndex = "100";
        suggestionsBox.style.maxHeight = "200px";
        suggestionsBox.style.overflowY = "auto";
        suggestionsBox.style.display = "none";

        // --- Primary ranking class (shown only for real multi-class people) ---
        const classGroup = document.createElement('div');
        classGroup.className = 'profile-primary-class';
        classGroup.style.display = 'none';
        const classLabel = document.createElement('label');
        classLabel.textContent = 'Primäre Klasse';
        const classSelect = document.createElement('select');
        classSelect.id = 'profile-primary-class-select';
        classSelect.className = 'profile-primary-class__select';
        classLabel.setAttribute('for', classSelect.id);
        classGroup.append(classLabel, classSelect);

        // --- Team Select Group (Hidden initially) ---
        const teamGroup = document.createElement('div');
        teamGroup.style.marginBottom = "30px";
        teamGroup.style.display = "none";

        const teamLabel = document.createElement('label');
        teamLabel.textContent = "Wähle deine Mannschaft";
        teamLabel.style.display = "block";
        teamLabel.style.color = "#e2e8f0";
        teamLabel.style.marginBottom = "8px";
        teamGroup.appendChild(teamLabel);

        const teamSelect = document.createElement('select');
        teamSelect.id = 'profile-team-select';
        teamSelect.style.width = "100%";
        teamSelect.style.padding = "12px";
        teamSelect.style.borderRadius = "6px";
        teamSelect.style.border = "1px solid #475569";
        teamSelect.style.background = "#0f172a";
        teamSelect.style.color = "white";
        teamLabel.setAttribute('for', teamSelect.id);
        teamGroup.appendChild(teamSelect);

        // Logic
        const populateTeams = (clubName) => {
            teamSelect.innerHTML = '';
            const possibleTeams = findClubTeams(clubName);

            if (possibleTeams.length === 0) {
                const opt = document.createElement('option');
                opt.value = clubName;
                opt.textContent = clubName + " (Keine spezifischen Teams gefunden)";
                teamSelect.appendChild(opt);
            } else {
                possibleTeams.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t;
                    opt.textContent = t;
                    teamSelect.appendChild(opt);
                });
            }
            teamGroup.style.display = 'block';
        };

        const clubNameForGroup = (group) => {
            const representative = group && group.records && group.records[0];
            if (!representative) return '';
            const club = clubData.clubs && clubData.clubs.find((candidate) => (
                String(candidate.number) === String(representative.v_nr)
            ));
            return club ? club.name : (representative.company || 'Unbekannt');
        };

        const populatePrimaryClasses = (group, preferredRecordKey = null) => {
            classSelect.replaceChildren();
            if (!group || group.records.length <= 1) {
                classGroup.style.display = 'none';
                return;
            }
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '-- Primäre Klasse wählen --';
            classSelect.appendChild(placeholder);
            group.records.forEach((record) => {
                const option = document.createElement('option');
                option.value = record.recordKey;
                option.textContent = record.category;
                classSelect.appendChild(option);
            });
            classSelect.value = preferredRecordKey || '';
            classGroup.style.display = 'block';
        };

        const showSelectedGroup = (group, preferredRecordKey = null) => {
            draft.selectGroup(group, preferredRecordKey);
            const selection = draft.getSelection();
            populatePrimaryClasses(group, selection.recordKey);
            populateTeams(clubNameForGroup(group));
            if (myTeamName) teamSelect.value = myTeamName;
            profileStatus.textContent = group.records.length > 1
                ? 'Mehrere Klassen gefunden. Bitte bestätige deine primäre Klasse.'
                : `${group.name} wurde eindeutig ausgewählt.`;
            profileStatus.classList.remove('profile-selection-status--error');
        };

        if (myPlayerResolution.status === 'resolved') {
            showSelectedGroup(myPlayerResolution.group, myPlayerProfile.recordKey);
        }

        const closeSuggestions = (restoreFocus = false) => (
            closeProfileSuggestions(suggestionsBox, input, restoreFocus)
        );

        const selectSuggestion = (match) => {
            selectProfileSuggestion(match, input, suggestionsBox, (selectedMatch) => {
                showSelectedGroup(selectedMatch.profileGroup);
            });
        };

        classSelect.addEventListener('change', () => {
            draft.selectRecord(classSelect.value);
            profileStatus.textContent = classSelect.value
                ? `Primäre Klasse: ${classSelect.options[classSelect.selectedIndex].textContent}`
                : 'Bitte wähle deine primäre Klasse.';
        });

        input.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            closeSuggestions(true);
        });

        input.addEventListener('input', () => {
            const val = input.value.toLowerCase().trim();
            draft.updateInput(input.value);
            suggestionsBox.replaceChildren();
            teamGroup.style.display = 'none';
            classGroup.style.display = 'none';
            profileStatus.textContent = '';

            if (val.length < 2) {
                closeSuggestions(false);
                return;
            }

            if (profileGroups.length > 0) {
                const matches = profileGroups.filter((group) => {
                    const clubName = clubNameForGroup(group);
                    return [group.name, clubName, ...group.categories]
                        .some((value) => String(value).toLowerCase().includes(val));
                }).slice(0, 10).map((group) => ({
                    label: group.name,
                    context: `${clubNameForGroup(group)} · ${group.categories.join(', ')}`,
                    profileGroup: group,
                }));

                if (matches.length > 0) {
                    suggestionsBox.style.display = 'block';
                    input.setAttribute('aria-expanded', 'true');
                    matches.forEach(m => {
                        suggestionsBox.appendChild(createProfileSuggestionItem(
                            m,
                            selectSuggestion,
                            closeSuggestions,
                        ));
                    });
                } else {
                    suggestionsBox.style.display = 'block';
                    input.setAttribute('aria-expanded', 'true');
                    const empty = document.createElement('li');
                    empty.setAttribute('role', 'status');
                    empty.style.cssText = 'padding:10px; color: #94a3b8;';
                    empty.textContent = 'Keine Spieler gefunden.';
                    suggestionsBox.appendChild(empty);
                }
            }
        });

        inputGroup.addEventListener('focusout', (event) => {
            if (!inputGroup.contains(event.relatedTarget)) {
                closeSuggestions(false);
            }
        });

        inputGroup.appendChild(input);
        inputGroup.appendChild(suggestionsBox);
        card.appendChild(inputGroup);
        card.appendChild(classGroup);
        card.appendChild(teamGroup);

        const btnRow = document.createElement('div');
        btnRow.style.display = "flex";
        btnRow.style.gap = "10px";
        btnRow.style.justifyContent = "center";

        const saveBtn = document.createElement('button');
        saveBtn.textContent = "Speichern";
        saveBtn.style.padding = "12px 30px";
        saveBtn.style.background = "#3b82f6";
        saveBtn.style.color = "white";
        saveBtn.style.border = "none";
        saveBtn.style.borderRadius = "6px";
        saveBtn.style.cursor = "pointer";
        saveBtn.style.fontWeight = "bold";
        saveBtn.onclick = () => {
            const profile = draft.createProfile(teamSelect.value);
            if (!profile) {
                profileStatus.textContent = draft.getSelection().group
                    ? 'Bitte wähle zuerst deine primäre Klasse.'
                    : 'Bitte wähle einen exakten Spielervorschlag aus der Liste.';
                profileStatus.classList.add('profile-selection-status--error');
                return;
            }
            if (setMyPlayer(profile)) {
                setAppStatus(`Profil gespeichert: ${profile.name}`);
            } else {
                profileStatus.textContent = 'Das Profil konnte in diesem Browser nicht gespeichert werden.';
                profileStatus.classList.add('profile-selection-status--error');
            }
        };

        const resetBtn = document.createElement('button');
        resetBtn.textContent = "Löschen";
        resetBtn.style.padding = "12px 30px";
        resetBtn.style.background = "transparent";
        resetBtn.style.color = "#ef4444";
        resetBtn.style.border = "1px solid #ef4444";
        resetBtn.style.borderRadius = "6px";
        resetBtn.style.cursor = "pointer";
        resetBtn.onclick = () => {
            setMyPlayer(null);
            input.value = "";
            teamGroup.style.display = 'none';
            classGroup.style.display = 'none';
        };

        btnRow.appendChild(saveBtn);
        if (myPlayerProfile || myPlayerName) btnRow.appendChild(resetBtn);
        card.appendChild(btnRow);

        container.appendChild(card);
        card.after(createCalendarSubscriptionCard('profile'));
        contentArea.appendChild(container); // Corrected
    }

    function renderDashboard() {
        topBarTitle.textContent = "Dashboard";
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.style.padding = "20px";
        container.style.maxWidth = "1200px";
        container.style.margin = "0 auto";

        if (typeof visitChangesLifecycle !== 'undefined' && visitChangesLifecycle) {
            visitChangesLifecycle.render(document, container);
        }

        const primaryPlayer = getMyPrimaryPlayer();
        if (!primaryPlayer) {
            container.appendChild(createProfileOnboardingCard());
            container.appendChild(createCalendarSubscriptionCard('dashboard'));
        }

        let myStats = null;
        // --- My Profile Section ---
        if (primaryPlayer) {
            // myStats is now outer scope
            let myLeagueKey = null;
            let mySchedule = [];
            let myTrend = null;
            let searchTeam = null;

            if (typeof rankingData !== 'undefined' && rankingData.players) {
                const p = primaryPlayer;
                if (p) {
                    const stats = calculatePlayerStats(p);
                    myStats = { ...p, ...stats };
                    // FIXED: Use myStats (with calculated avg) instead of p (raw) for correct trend diff
                    myTrend = calculateTrend(myStats);

                    // Find League and Schedule
                    searchTeam = myTeamName;

                    // Fallback: Resolve team from v_nr if myTeamName is missing (e.g. first load)
                    if (!searchTeam && p.v_nr && typeof CLUB_DATA !== 'undefined' && CLUB_DATA.clubs) {
                        const club = CLUB_DATA.clubs.find(c => c.number == p.v_nr);
                        if (club) searchTeam = club.name;
                    }

                    // Final Fallback: Company property
                    if (!searchTeam && p.company) searchTeam = p.company;

                    if (searchTeam && leagueData.leagues) {
                        const leagueKeys = Object.keys(leagueData.leagues);

                        // Aggregate matching schedules from ALL leagues
                        for (const key of leagueKeys) {
                            const sched = getTeamSchedule(key, searchTeam);
                            if (sched.length > 0) {
                                // Add league key for context
                                sched.forEach(s => s.leagueKey = key);
                                mySchedule = [...mySchedule, ...sched];
                            }
                        }

                        // Determine "My League" (for ranking context)
                        // Prioritize the league that matches p.league, or default to the first one found
                        if (mySchedule.length > 0) {
                            const mainLeagueMatch = mySchedule.find(s => s.leagueKey.includes(p.league));
                            myLeagueKey = mainLeagueMatch ? mainLeagueMatch.leagueKey : mySchedule[0].leagueKey;
                        }

                        // Sort ALL games by date
                        // Fallback to Round if no date, but Date is preferred for mixed leagues
                        mySchedule.sort((a, b) => {
                            if (a.date && b.date) return a.date - b.date;
                            return (a.round || 0) - (b.round || 0);
                        });
                    }

                }
            }


            if (myStats) {
                // --- Dashboard Grid ---
                const grid = document.createElement('div');
                grid.style.display = "grid";
                grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(350px, 1fr))";
                grid.style.gap = "25px";
                grid.style.marginBottom = "40px";

                // --- Helper to get Global Team Rank (Class-wide) ---
                let teamRank = null;
                let totalTeamsInClass = 0;

                if (myLeagueKey && leagueData.leagues && searchTeam) {
                    // 1. Identify "Class" (e.g., "District League", "B-Klasse")
                    // Assumption: League Key format is "B-Klasse Gruppe 3 - 2024/25" or similar.
                    // We split by "Gruppe" or just take the first part.
                    const leagueNameParts = myLeagueKey.split("Gruppe");
                    const leagueClass = leagueNameParts[0].trim(); // e.g. "B-Klasse"

                    // 2. Find all leagues matching this class
                    const matchingLeagues = Object.keys(leagueData.leagues).filter(k => k.startsWith(leagueClass));

                    // 3. Aggregate all teams
                    let allTeams = [];
                    const normMyTeam = normalizeTeamName(searchTeam);

                    matchingLeagues.forEach(lKey => {
                        const lData = leagueData.leagues[lKey];
                        if (lData && lData.table) {
                            const rows = safeTableRowsFromHtml(lData.table);

                            rows.forEach(cells => {
                                if (cells.length > 8) {
                                    // Extract Data
                                    // FIXED: Table usually has 10 columns (0-9).
                                    // Index 8 = Points. Index 7 = Diff. Index 2 = Games.
                                    // Last column (Index 9) is for penalties/notes (e.g. "(-1)" or "&nbsp;").

                                    const teamName = cells[1].trim();

                                    // Robust parsing
                                    const pointsText = cells[8].replace(/&nbsp;/g, '').trim();
                                    const points = parseInt(pointsText) || 0;

                                    const diffText = cells[7].replace(/&nbsp;/g, '').trim();
                                    const diff = parseInt(diffText) || 0;

                                    allTeams.push({
                                        name: teamName,
                                        normName: normalizeTeamName(teamName),
                                        points: points,
                                        diff: diff,
                                        league: lKey
                                    });
                                }
                            });
                        }
                    });

                    // 4. Sort Global List
                    // Points DESC, then Diff DESC
                    allTeams.sort((a, b) => {
                        if (b.points !== a.points) return b.points - a.points;
                        return b.diff - a.diff;
                    });

                    totalTeamsInClass = allTeams.length;

                    // 5. Find My Rank
                    const myTeamIdx = allTeams.findIndex(t => t.normName === normMyTeam);
                    if (myTeamIdx !== -1) {
                        teamRank = myTeamIdx + 1;
                    }
                }

                // --- 1. Hero Card ---
                const heroCard = document.createElement('div');
                heroCard.style.background = "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)";
                heroCard.style.padding = "25px";
                heroCard.style.borderRadius = "12px";
                heroCard.style.border = "1px solid #334155";
                heroCard.style.position = "relative";
                heroCard.style.overflow = "hidden";
                heroCard.style.boxShadow = "0 10px 15px -3px rgba(0, 0, 0, 0.3)";

                const trendIcon = myTrend && myTrend.dir === 'up' ? '↗' : (myTrend && myTrend.dir === 'down' ? '↘' : '→');
                const trendColor = myTrend && myTrend.dir === 'up' ? '#4ade80' : (myTrend && myTrend.dir === 'down' ? '#f87171' : '#94a3b8');
                // const trendText = myTrend ? `${trendIcon} ${myTrend.diff} (L3: ${myTrend.last3Avg})` : '';

                heroCard.innerHTML = `
                    <div style="position: relative; z-index: 2;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
                            <div>
                                <div style="color: #60a5fa; font-weight: bold; letter-spacing: 1px; font-size: 0.8em; text-transform: uppercase; margin-bottom: 5px;">Dein Profil</div>
                                <h1 style="margin: 0; font-size: 2.2em; color: white;">${escapeHtmlText(myStats.name)}</h1>
                                <div style="color: #94a3b8; font-size: 1.1em; margin-top: 5px;">
                                    ${escapeHtmlText(myLeagueKey ? myLeagueKey.split('202')[0] : (myStats.league || "Liga n/a"))} | ${escapeHtmlText(searchTeam || "Vereinslos")}
                                    ${teamRank ? `<span style="color: #fbbf24; margin-left: 10px; font-weight: bold; white-space: nowrap;">(Team-Platz: ${teamRank} <span style="font-size:0.7em; font-weight:normal; color:#64748b;">/ ${totalTeamsInClass}</span>)</span>` : ''}
                                </div>
                            </div>
                            <div style="text-align: right;">
                                <div style="background: #3b82f6; color: white; padding: 5px 15px; border-radius: 20px; font-weight: bold; font-size: 0.9em; display: inline-block; white-space: nowrap;">
                                    Rang ${escapeHtmlText(myStats.rank)}
                                </div>
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                            <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px;">
                                <div style="color: #94a3b8; font-size: 0.8em; margin-bottom: 5px;">Ø PUNKTE</div>
                                <div style="font-size: 2em; font-weight: bold; color: white; display: flex; align-items: center; gap: 10px;">
                                    ${myStats.avg.toFixed(2)}
                                    ${myTrend ? `
                                    <div style="display: flex; flex-direction: column; justify-content: center; font-size: 0.4em; color: ${trendColor}; font-weight: normal; line-height: 1.2;">
                                        <div style="white-space: nowrap;">Trend: ${trendIcon} ${myTrend.diff}</div>
                                        <div style="white-space: nowrap; opacity: 0.8;">Form: ${myTrend.last3Avg}</div>
                                    </div>` : ''}
                                </div>
                            </div>
                            <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px;">
                                <div style="color: #94a3b8; font-size: 0.8em; margin-bottom: 5px;">SPIELE</div>
                                <div style="font-size: 2em; font-weight: bold; color: white;">${myStats.count}</div>
                            </div>
                        </div>
                    </div>
                `;
                grid.appendChild(heroCard);

                // --- 1.1 Career Stats Card (New) ---
                let careerStats = {
                    totalPoints: 0,
                    titles: 0,
                    bestSeason: { points: 0, season: '' },
                    highestLeague: '',
                    seasonsPlayed: 0
                };

                if (typeof ARCHIVE_DATA !== 'undefined') {
                    let archiveEntries = [];
                    // ARCHIVE_DATA keys are IDs. myStats.id should match.
                    if (myStats.id && ARCHIVE_DATA[myStats.id]) {
                        archiveEntries = ARCHIVE_DATA[myStats.id];
                    }

                    // Add Current Season (Snapshot)
                    const currentPoints = Math.round(myStats.avg * myStats.count);
                    const currentLeagueClass = myLeagueKey ? myLeagueKey.split('Gruppe')[0].trim() : (myStats.league || "");

                    // 1. Total Points (Archive)
                    archiveEntries.forEach(entry => {
                        careerStats.totalPoints += (entry.points || 0);
                        if (entry.rank === 1) careerStats.titles++;

                        if (entry.points > careerStats.bestSeason.points) {
                            careerStats.bestSeason = { points: entry.points, season: entry.season };
                        }
                    });

                    // Add Current Season
                    careerStats.totalPoints += currentPoints;
                    if (currentPoints > careerStats.bestSeason.points) {
                        careerStats.bestSeason = { points: currentPoints, season: '24/25' };
                    }

                    // Highest League
                    // Hierarchy: Bezirksliga (Highest) > A-Klasse > B-Klasse > C-Klasse
                    const leagueHierarchy = ['Bezirksliga', 'A-Klasse', 'B-Klasse', 'C-Klasse'];
                    let highestLevelFound = 99;

                    // Check Archive
                    archiveEntries.forEach(entry => {
                        const idx = leagueHierarchy.findIndex(l => entry.league.includes(l));
                        if (idx !== -1 && idx < highestLevelFound) highestLevelFound = idx;
                    });

                    // Check Current
                    const currentIdx = leagueHierarchy.findIndex(l => currentLeagueClass.includes(l));
                    if (currentIdx !== -1 && currentIdx < highestLevelFound) highestLevelFound = currentIdx;

                    if (highestLevelFound !== 99) {
                        careerStats.highestLeague = leagueHierarchy[highestLevelFound];
                    }

                    careerStats.seasonsPlayed = archiveEntries.length + 1; // + Current
                }

                if (careerStats.seasonsPlayed > 0) {
                    const careerCard = document.createElement('div');
                    careerCard.style.background = "#1e293b";
                    careerCard.style.borderRadius = "12px";
                    careerCard.style.border = "1px solid #334155";
                    careerCard.style.padding = "20px";
                    careerCard.style.display = "grid";
                    careerCard.style.gridTemplateColumns = "repeat(auto-fit, minmax(80px, 1fr))";
                    careerCard.style.gap = "15px";
                    careerCard.style.textAlign = "center";

                    // Helper for items
                    const createItem = (label, val, sub) => `
                        <div style="display:flex; flex-direction:column; align-items:center;">
                            <div style="color:#94a3b8; font-size:0.75em; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:5px;">${escapeHtmlText(label)}</div>
                            <div style="color:white; font-size:1.4em; font-weight:bold;">${escapeHtmlText(val)}</div>
                            ${sub ? `<div style="color:#64748b; font-size:0.7em;">${escapeHtmlText(sub)}</div>` : ''}
                        </div>
                     `;

                    careerCard.innerHTML = `
                         ${createItem("Ewige Punkte", careerStats.totalPoints, `${careerStats.seasonsPlayed} Saisons`)}
                         ${createItem("Titel", careerStats.titles > 0 ? '🏆 ' + careerStats.titles : '0', "1. Plätze")}
                         ${createItem("Best-Wert", careerStats.bestSeason.points, `Saison ${careerStats.bestSeason.season}`)}
                         ${createItem("Höchste Liga", careerStats.highestLeague.replace('Liga', ''), "Karriere")}
                     `;
                    grid.appendChild(careerCard);
                }

                // --- 2. STATS & FORM CARD ---
                const statsCard = document.createElement('div');
                statsCard.style.background = "#1e293b";
                statsCard.style.padding = "20px";
                statsCard.style.borderRadius = "12px";
                statsCard.style.border = "1px solid #334155";
                statsCard.style.display = "flex";
                statsCard.style.flexDirection = "column";
                statsCard.style.gap = "20px";

                // --- A) League Benchmark ---
                if (myLeagueKey && rankingData.players) {
                    // Filter players in same league
                    const leaguePlayers = rankingData.players.filter(p => p.league === myStats.league);
                    if (leaguePlayers.length > 0) {
                        // Calculate Avg
                        const totalAvg = leaguePlayers.reduce((acc, p) => {
                            const s = calculatePlayerStats(p);
                            return acc + s.avg;
                        }, 0);
                        const leagueAvg = totalAvg / leaguePlayers.length;

                        // Find Best
                        const bestPlayer = leaguePlayers.reduce((max, p) => {
                            const s = calculatePlayerStats(p);
                            return s.avg > max.avg ? s : max;
                        }, { avg: 0 });

                        // My position % (max is slightly above best to give space)
                        const maxScale = Math.max(bestPlayer.avg * 1.1, 10); // Min 10 pts scale
                        const myPercent = (myStats.avg / maxScale) * 100;
                        const avgPercent = (leagueAvg / maxScale) * 100;

                        statsCard.innerHTML += `
                            <div>
                                <div style="display:flex; justify-content:space-between; margin-bottom: 10px;">
                                    <h3 style="color: #94a3b8; font-size: 0.8em; text-transform: uppercase;">⚖️ Liga-Vergleich (Ø Punkte)</h3>
                                    <div style="color: #fbbf24; font-size: 0.7em;">🏆 Top: ${bestPlayer.avg.toFixed(1)}</div>
                                </div>
                                <div style="position: relative; height: 30px; background: #0f172a; border-radius: 15px; margin-top: 15px;">
                                    
                                    <!-- League Avg Marker -->
                                    <div style="position: absolute; left: ${avgPercent}%; top: -5px; bottom: -5px; width: 2px; background: #cbd5e1; z-index: 1;"></div>
                                    <div style="position: absolute; left: ${avgPercent}%; top: 35px; transform: translateX(-50%); color: #94a3b8; font-size: 0.7em;">Ø ${leagueAvg.toFixed(1)}</div>
                                    
                                    <!-- My Bar -->
                                    <div style="position: absolute; left: 0; top: 0; bottom: 0; width: ${myPercent}%; background: linear-gradient(90deg, #3b82f6, #60a5fa); border-radius: 15px; z-index: 2;"></div>
                                    <div style="position: absolute; left: ${myPercent}%; top: 5px; transform: translateX(-50%); color: white; font-weight: bold; font-size: 0.8em; text-shadow: 0 1px 2px black; z-index: 3;">${myStats.avg.toFixed(1)}</div>
                                </div>
                            </div>
                        `;
                    }
                }

                // --- B) Form Curve (Spikes) ---
                if (myStats.rounds) {
                    const roundsData = [];
                    for (let i = 1; i <= 18; i++) {
                        const val = myStats.rounds[`R${i}`];
                        if (val && val !== "x" && val !== "&nbsp;" && val !== "-" && !isNaN(parseInt(val))) {
                            roundsData.push({ r: i, p: parseInt(val) });
                        }
                    }

                    if (roundsData.length > 0) {
                        // Take last 8 played rounds for display
                        const recentRounds = roundsData.slice(-8);
                        const maxPoints = Math.max(...recentRounds.map(d => d.p), myStats.avg + 10, 10);
                        const avgHeight = (myStats.avg / maxPoints) * 100;

                        let barsHtml = recentRounds.map(d => {
                            const h = (d.p / maxPoints) * 100;
                            const color = d.p >= myStats.avg ? '#4ade80' : '#f87171';

                            // Spike Visual
                            return `
                                <div style="display: flex; flex-direction: column; align-items: center; flex: 1; height: 100%; justify-content: flex-end; position: relative;">
                                    <div style="position: relative; width: 2px; height: ${h}%; background: ${color}; display: flex; justify-content: center; z-index: 2;">
                                        <!-- Dot -->
                                        <div style="position: absolute; top: 0; width: 8px; height: 8px; background: ${color}; border-radius: 50%; transform: translateY(-50%);"></div>
                                        <!-- Label -->
                                        <div style="position: absolute; top: -20px; color: white; font-size: 0.7em; font-weight: bold;">${d.p}</div>
                                    </div>
                                    <div style="color: #64748b; font-size: 0.7em; margin-top: 8px;">R${d.r}</div>
                                </div>
                            `;
                        }).join('');

                        statsCard.innerHTML += `
                            <div style="border-top: 1px solid #334155; padding-top: 15px;">
                                <h3 style="color: #94a3b8; font-size: 0.8em; text-transform: uppercase; margin-bottom: 25px;">📈 Formkurve</h3>
                                <div style="position: relative; height: 100px; padding-top: 20px;">
                                    <!-- Dashed Avg Line -->
                                    <div style="position: absolute; bottom: 20px; left: 0; right: 0; height: ${avgHeight}%; border-top: 1px dashed #475569; pointer-events: none; z-index: 0; opacity: 0.5;"></div>
                                    
                                    <div style="display: flex; height: 100%; align-items: flex-end; gap: 10px; position: relative; z-index: 1;">
                                        ${barsHtml}
                                    </div>
                                </div>
                            </div>
                        `;
                    }
                }

                grid.appendChild(statsCard);

                // --- 2. Action / Next Game Card ---
                const actionCard = document.createElement('div');
                actionCard.style.display = "flex";
                actionCard.style.flexDirection = "column";
                actionCard.style.gap = "20px";
                actionCard.style.gridColumn = "1 / -1"; // Span full width on desktop

                // The reviewed selector keeps dated games first, open dates last,
                // and removes byes before a primary card can be chosen.
                const upcomingGames = typeof window !== 'undefined' && window.BwedlAppUtils
                    ? window.BwedlAppUtils.selectUpcomingGames(mySchedule, new Date()).slice(0, 3)
                    : [];

                if (upcomingGames.length > 0) {
                    const nextGamesContainer = document.createElement('div');
                    nextGamesContainer.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; width: 100%;';
                    
                    upcomingGames.forEach((game, idx) => {
                        const nextCard = document.createElement('div');
                        const isPrimary = idx === 0;
                        
                        nextCard.style.cssText = isPrimary 
                            ? 'background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 20px; border-radius: 12px; border: 1px solid #3b82f6; position: relative; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);'
                            : 'background: #1e293b; padding: 15px 20px; border-radius: 12px; border: 1px solid #334155; opacity: 0.9; transition: all 0.2s;';
                        
                        if (!isPrimary) {
                            nextCard.onmouseover = () => { nextCard.style.borderColor = '#475569'; nextCard.style.opacity = '1'; };
                            nextCard.onmouseout = () => { nextCard.style.borderColor = '#334155'; nextCard.style.opacity = '0.9'; };
                        }

                        const dateStr = game.date 
                            ? game.date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) 
                            : 'Termin offen';

                        nextCard.innerHTML = `
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                                <div style="color: ${isPrimary ? '#60a5fa' : '#94a3b8'}; font-weight: bold; font-size: ${isPrimary ? '0.9em' : '0.7em'}; text-transform: uppercase; letter-spacing: 1px;">
                                    ${isPrimary ? '🚀 NÄCHSTES SPIEL' : `📅 SPIEL ${idx + 1}`}
                                </div>
                                <div style="color: #64748b; font-size: 0.7em;">${escapeHtmlText(game.leagueKey ? game.leagueKey.split('202')[0].trim() : '')}</div>
                            </div>
                            <div style="font-size: ${isPrimary ? '1.15em' : '1em'}; color: white; margin-bottom: 4px;">
                                Gegen <strong>${escapeHtmlText(game.opponent)}</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; color: #94a3b8; font-size: 0.85em;">
                                <span>${escapeHtmlText(dateStr)}</span>
                                <span>${game.isHome ? '(Heim)' : '(Auswärts)'}</span>
                            </div>
                        `;
                        nextCard.appendChild(createGameActionsElement(game));
                        
                        nextGamesContainer.appendChild(nextCard);
                    });
                    
                    actionCard.appendChild(nextGamesContainer);
                } else {
                    // Season finished fallback
                    const nextCard = document.createElement('div');
                    nextCard.style.background = "#1e293b";
                    nextCard.style.padding = "20px";
                    nextCard.style.borderRadius = "12px";
                    nextCard.style.border = "1px solid #334155";
                    nextCard.innerHTML = `<div style="color:#94a3b8; text-align:center;">Keine offenen Spiele gefunden.<br>Saison beendet?</div>`;
                    actionCard.appendChild(nextCard);
                }

                // Match Preview Teaser inside grid
                const previewTeaser = document.createElement('div');
                previewTeaser.style.background = "#1e293b";
                previewTeaser.style.padding = "20px";
                previewTeaser.style.borderRadius = "12px";
                previewTeaser.style.border = "1px solid #334155";
                previewTeaser.style.cursor = "pointer";
                previewTeaser.style.display = "flex";
                previewTeaser.style.alignItems = "center";
                previewTeaser.style.justifyContent = "space-between";
                previewTeaser.onclick = () => navigateTo('matchPreview');
                previewTeaser.innerHTML = `
                    <div>
                        <h3 style="margin: 0; color: #f8fafc; font-size: 1em;">⚔️ Match Preview Tool</h3>
                        <div style="color: #64748b; font-size: 0.8em; margin-top: 5px;">Analysiere Gegner</div>
                    </div>
                    <span style="color: #3b82f6; font-size: 1.5em;">→</span>
                `;
                actionCard.appendChild(previewTeaser);

                grid.appendChild(createCalendarSubscriptionCard('dashboard'));
                grid.appendChild(actionCard);
                const profileSeasonNotice = createSeasonNotice('dashboard-profile');
                if (profileSeasonNotice) container.appendChild(profileSeasonNotice);
                container.appendChild(grid);

                // --- 3. Season Log Table ---
                if (mySchedule.length > 0) {
                    const logContainer = document.createElement('div');
                    logContainer.className = "fade-in";
                    logContainer.innerHTML = `<h3 style="color: #f8fafc; margin-bottom: 15px; border-bottom: 2px solid #334155; padding-bottom: 10px;">📋 Saisonverlauf</h3>`;

                    const table = document.createElement('table');
                    table.style.width = "100%";
                    table.style.borderCollapse = "collapse";
                    table.style.fontSize = "0.9em";

                    const thead = document.createElement('thead');
                    thead.innerHTML = `
                        <tr style="text-align: left; color: #94a3b8;">
                            <th style="padding: 10px;">Runde</th>
                            <th style="padding: 10px;">Gegner</th>
                            <th style="padding: 10px; text-align: center;">Team</th>
                            <th style="padding: 10px; text-align: center;">Mein Score</th>
                        </tr>
                     `;
                    table.appendChild(thead);

                    const tbody = document.createElement('tbody');

                    // Show only PAST games in log, excluding Ligapokal
                    const pastGames = mySchedule.filter(g => !g.isPending && !g.leagueKey.includes("Ligapokal"));

                    pastGames.forEach((game, idx) => {
                        // Find personal score for this round
                        // ONLY if the match league matches the player's ranked league
                        // This avoids showing N/A or wrong scores for Cup games
                        let personalScore = '-';
                        if (game.leagueKey && myStats.league && game.leagueKey.includes(myStats.league)) {
                            personalScore = myStats.rounds ? myStats.rounds[`R${game.round}`] : '-';
                        }

                        const isPlayed = personalScore && personalScore !== 'x' && personalScore !== '&nbsp;' && personalScore !== '-' && !isNaN(parseInt(personalScore));

                        const row = document.createElement('tr');
                        row.style.borderBottom = "1px solid #334155";
                        row.style.background = idx % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent";

                        // Determine Team Result Color
                        let resColor = "#94a3b8";
                        if (game.myTeamResult === "Won") resColor = "#4ade80";
                        if (game.myTeamResult === "Lost") resColor = "#f87171";

                        // Determine Personal Score Style
                        let pScoreStyle = "color: #94a3b8;";
                        if (isPlayed) {
                            const ps = parseInt(personalScore);
                            if (ps >= myStats.avg) pScoreStyle = "color: #4ade80; font-weight: bold;"; // Above Average
                            else pScoreStyle = "color: #fca5a5;"; // Below Average
                        }

                        row.innerHTML = `
                            <td style="padding: 12px 10px; color: #cbd5e1;">Runde ${escapeHtmlText(game.round)} <span style="font-size:0.7em; color:#64748b">(${escapeHtmlText(game.leagueKey ? game.leagueKey.split(' ')[0] : '')})</span></td>
                            <td style="padding: 12px 10px;">
                                <div style="color: white; font-weight: 500;">${escapeHtmlText(game.opponent)}</div>
                                <div style="color: #64748b; font-size: 0.8em;">${game.date ? game.date.toLocaleDateString('de-DE') : ''} ${game.isHome ? '(H)' : '(A)'}</div>
                            </td>
                            <td style="padding: 12px 10px; text-align: center;">
                                <span style="color: ${resColor}; font-weight: bold; background: rgba(0,0,0,0.2); padding: 4px 8px; border-radius: 4px;">
                                    ${escapeHtmlText(game.score)}
                                </span>
                            </td>
                            <td style="padding: 12px 10px; text-align: center; ${pScoreStyle}">
                                ${escapeHtmlText(personalScore || '-')}
                            </td>
                         `;
                        tbody.appendChild(row);
                    });
                    table.appendChild(tbody);
                    const tableScroll = document.createElement('div');
                    tableScroll.className = 'table-scroll profile-season-history';
                    tableScroll.tabIndex = 0;
                    tableScroll.setAttribute('aria-label', 'Saisonverlauf');
                    tableScroll.appendChild(table);
                    logContainer.appendChild(tableScroll);
                    container.appendChild(logContainer);
                }
            }
        }

        // --- TOP 20 PLAYERS (Latest Matchday) ---
        const topPlayersSection = document.createElement('div');
        topPlayersSection.style.marginTop = "40px";

        // 1. Determine Latest Active Round
        let latestRound = 0;
        if (rankingData && rankingData.players) {
            for (let i = 1; i <= 18; i++) {
                const hasData = rankingData.players.some(p => {
                    const val = p.rounds[`R${i}`];
                    return val && val !== "&nbsp;" && val !== "x" && !isNaN(parseInt(val));
                });
                if (hasData) latestRound = i;
            }
        }

        // 2. Helper to get Top 20 for a specific league
        const getTopPlayers = (leagueName) => {
            if (!rankingData || !rankingData.players) return [];
            return rankingData.players
                .filter(p => p.league && p.league.includes(leagueName))
                .map(p => {
                    const val = p.rounds[`R${latestRound}`];
                    const score = (val && val !== "&nbsp;" && val !== "x" && !isNaN(parseInt(val))) ? parseInt(val) : 0;
                    return { ...p, currentScore: score };
                })
                .filter(p => p.currentScore > 0)
                .sort((a, b) => b.currentScore - a.currentScore)
                .slice(0, 20);
        };

        // 3. UI Construction
        const topTitle = `<h2 style="color: #60a5fa; border-bottom: 2px solid #334155; padding-bottom: 10px; margin-bottom: 20px; display:flex; justify-content:space-between; align-items:center;">
                            <span>🏆 Spieltags-Sieger (Top 20)</span>
                            <span style="font-size:0.6em; color:#94a3b8; background:#1e293b; padding:2px 8px; border-radius:4px;">Spieltag ${latestRound}</span>
                          </h2>`;

        // Tabs
        const leagues = ["Bezirksliga", "A-Klasse", "B-Klasse", "C-Klasse"];
        // Default to user's league or first one
        let activeTab = leagues[0];
        if (myStats && myStats.league) {
            const match = leagues.find(l => myStats.league.includes(l));
            if (match) activeTab = match;
        }

        const renderTopList = (league) => {
            const list = getTopPlayers(league);
            if (list.length === 0) return `<div style="text-align:center; padding:20px; color:#94a3b8;">Keine Daten für Spieltag ${latestRound}</div>`;

            return `
            <div class="table-scroll" style="background: #1e293b; border-radius: 8px; border: 1px solid #334155;">
                <table style="width: 100%; border-collapse: collapse; color: #e2e8f0; font-size: 0.9em;">
                    <thead>
                        <tr style="background: #0f172a; text-align: left; color: #94a3b8; font-size: 0.8em; text-transform: uppercase;">
                            <th style="padding: 10px 15px; width: 40px;">#</th>
                            <th style="padding: 10px 15px;">Name</th>
                            <th style="padding: 10px 15px;">Verein</th>
                            <th style="padding: 10px 15px; text-align: right;">Punkte</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${(() => {
                    let lastScore = -1;
                    let lastRank = 0;

                    return list.map((p, idx) => {
                        const isMyPlayer = isMyPlayerRecord(p);
                        const rowBg = isMyPlayer ? 'rgba(59, 130, 246, 0.1)' : (idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)');

                        // Rank Logic
                        let displayRank = idx + 1;
                        if (p.currentScore === lastScore) {
                            displayRank = lastRank;
                        } else {
                            lastScore = p.currentScore;
                            lastRank = displayRank;
                        }

                        const rankColor = displayRank <= 3 ? '#fbbf24' : '#94a3b8';
                        const scoreColor = displayRank <= 3 ? '#4ade80' : '#f8fafc';

                        // Find full club name
                        let clubName = p.company || "-";
                        if (typeof clubData !== 'undefined' && clubData.clubs) {
                            const c = clubData.clubs.find(cl => cl.number == p.v_nr);
                            if (c) clubName = c.name;
                        }

                        return `
                                <tr style="background: ${rowBg}; border-bottom: 1px solid #334155;">
                                    <td style="padding: 10px 15px; font-weight: bold; color: ${rankColor};">${displayRank}.</td>
                                    <td style="padding: 10px 15px; font-weight: 600; color: ${isMyPlayer ? '#60a5fa' : '#f8fafc'};">${escapeHtmlText(p.name)}</td>
                                    <td style="padding: 10px 15px; color: #94a3b8; font-size: 0.9em;">${escapeHtmlText(clubName)}</td>
                                    <td style="padding: 10px 15px; text-align: right; font-weight: bold; color: ${scoreColor}; font-size: 1.1em;">${p.currentScore}</td>
                                </tr>
                                `;
                    }).join('');
                })()}
                    </tbody>
                </table>
            </div>`;
        };

        const containerDiv = document.createElement('div');
        containerDiv.innerHTML = topTitle;
        const topPlayersSeasonNotice = createSeasonNotice('top-20');
        if (topPlayersSeasonNotice) containerDiv.appendChild(topPlayersSeasonNotice);

        // Tab Container
        const tabContainer = document.createElement('div');
        tabContainer.style.display = "flex";
        tabContainer.style.gap = "10px";
        tabContainer.style.marginBottom = "15px";
        tabContainer.style.overflowX = "auto";
        tabContainer.style.paddingBottom = "5px";

        const contentDiv = document.createElement('div');

        leagues.forEach(l => {
            const btn = document.createElement('button');
            btn.textContent = l;
            btn.style.padding = "8px 16px";
            btn.style.borderRadius = "20px";
            btn.style.border = "1px solid #334155";
            btn.style.background = (l === activeTab) ? "#3b82f6" : "#1e293b";
            btn.style.color = (l === activeTab) ? "white" : "#94a3b8";
            btn.style.cursor = "pointer";
            btn.style.fontWeight = "bold";
            btn.style.fontSize = "0.9em";
            btn.style.whiteSpace = "nowrap";

            btn.onclick = () => {
                // Reset all
                Array.from(tabContainer.children).forEach(b => {
                    b.style.background = "#1e293b";
                    b.style.color = "#94a3b8";
                });
                // Set active
                btn.style.background = "#3b82f6";
                btn.style.color = "white";
                activeTab = l;
                contentDiv.innerHTML = "Lade...";
                setTimeout(() => {
                    contentDiv.innerHTML = renderTopList(l); // Render content
                }, 10);
            };
            tabContainer.appendChild(btn);
        });

        // Initial Render
        contentDiv.innerHTML = renderTopList(activeTab);

        topPlayersSection.appendChild(containerDiv);
        topPlayersSection.appendChild(tabContainer);
        topPlayersSection.appendChild(contentDiv);
        container.appendChild(topPlayersSection);

        contentArea.appendChild(container);
        if (typeof visitChangesLifecycle !== 'undefined' && visitChangesLifecycle) {
            visitChangesLifecycle.confirmVisible(container.parentElement === contentArea);
        }

        // Update Nav Active State
        document.querySelectorAll('.nav-section-header').forEach(el => {
            el.style.backgroundColor = "transparent";
            el.style.color = "#94a3b8";
        });
        // Highlight logic can be added here if needed, but nav usually static.
    }

    function handleSearch(e) {
        const query = e.target.value.toLowerCase();
        searchResults.innerHTML = "";

        if (query.length < 2) {
            searchResults.classList.add('hidden');
            searchInput.setAttribute('aria-expanded', 'false');
            return;
        }

        const matches = window.searchIndex.filter(item => item.label.toLowerCase().includes(query)).slice(0, 10);

        if (matches.length > 0) {
            searchResults.classList.remove('hidden');
            searchInput.setAttribute('aria-expanded', 'true');
            matches.forEach(m => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'search-result-item';
                button.style.padding = "8px 10px";
                button.style.borderBottom = "1px solid #334155";
                button.style.cursor = "pointer";
                button.style.color = "#e2e8f0";
                button.style.fontSize = "0.9em";
                button.style.backgroundColor = "#1e293b";
                button.style.zIndex = "2000";

                replaceWithSearchResultLabel(button, m.type, m.label, m.context);

                button.addEventListener('click', () => {
                    if (m.category === 'league') navigateTo('league', m.id);
                    else if (m.category === 'club') navigateTo('club', m.id);
                    closeSearchResults(false, true);
                });
                button.addEventListener('keydown', activateSearchResult);

                button.addEventListener('mouseenter', () => button.style.background = "#334155");
                button.addEventListener('mouseleave', () => button.style.background = "#1e293b");

                searchResults.appendChild(button);
            });
        } else {
            searchResults.classList.remove('hidden');
            searchInput.setAttribute('aria-expanded', 'true');
            const div = document.createElement('div');
            div.setAttribute('role', 'status');
            div.style.padding = "8px 10px";
            div.style.color = "#94a3b8";
            div.style.fontSize = "0.9em";
            div.style.backgroundColor = "#1e293b";
            div.textContent = "Keine Treffer";
            searchResults.appendChild(div);
        }
    }


    function navigateTo(type, id, addToHistory = true) {
        closeMobileNavigation();
        if (type === 'club') rememberRecentClub(id);

        // 1. Handle history
        if (addToHistory) {
            history.pushState({ type, id }, "", routeHash({ type, id }));
        }

        // 2. Render
        currentState = { type, id };

        if (type === 'league') renderLeague(id);
        else if (type === 'ligapokalArchive') renderLigapokalArchive(id);
        else if (type === 'ranking') renderRanking(id);
        else if (type === 'club') renderClub(id);
        else if (type === 'clubList') renderClubList();
        else if (type === 'dashboard') renderDashboard();
        else if (type === 'matchPreview') renderMatchPreview();
        else if (type === 'comparison') renderComparisonView();
        else if (type === 'alltime') renderAllTimeView();
        else if (type === 'tools') renderToolsView();
        else if (type === 'profile') renderProfileSelection();
        else if (type === 'wiki') renderWiki();

        // 3. Update back button visibility
        // Show back button everywhere except Dashboard
        if (backBtn) {
            backBtn.style.display = (type === 'dashboard') ? 'none' : 'block';
        }

        // Scroll to top
        window.scrollTo(0, 0);
    }

    // Both browser navigation and manually edited hashes use the same resolver.
    window.addEventListener('popstate', initializeRouteFromLocation);
    window.addEventListener('hashchange', initializeRouteFromLocation);

    function goBack() {
        history.back();
    }
    // Expose to window for inline onclick handlers
    window.navigateTo = navigateTo;
    window.shareCurrentView = shareCurrentView;

    function renderComparisonView() {
        topBarTitle.textContent = "H2H Vergleich";
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.className = "fade-in";
        container.style.padding = "20px";
        container.style.maxWidth = "800px";
        container.style.margin = "0 auto";

        // --- State ---
        let p1 = null;
        let p2 = null;

        // --- UI ---
        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(300px, 1fr))';
        grid.style.gap = '20px';
        grid.style.marginBottom = '30px';

        const createSide = (label, id) => {
            const wrapper = document.createElement('div');
            wrapper.style.background = "#1e293b";
            wrapper.style.padding = "20px";
            wrapper.style.borderRadius = "8px";
            wrapper.style.border = "1px solid #334155";

            wrapper.innerHTML = `
                <h3 style="color: #94a3b8; margin-bottom: 15px;">${label}</h3>
                <input type="text" id="search-${id}" placeholder="Name suchen..." 
                    style="width: 100%; padding: 10px; background: #0f172a; border: 1px solid #475569; color: white; border-radius: 4px; margin-bottom: 10px;">
                <div id="results-${id}" style="max-height: 200px; overflow-y: auto;"></div>
                <div id="selected-${id}" style="margin-top: 10px; display: none;"></div>
            `;
            return wrapper;
        };

        const side1 = createSide("Spieler 1", "p1");
        const side2 = createSide("Spieler 2", "p2");

        grid.appendChild(side1);
        grid.appendChild(side2);
        container.appendChild(grid);

        const comparisonArea = document.createElement('div');
        comparisonArea.id = "comparison-area";
        comparisonArea.style.display = "none";
        const comparisonSeasonNotice = createSeasonNotice('h2h');
        if (comparisonSeasonNotice) container.appendChild(comparisonSeasonNotice);
        container.appendChild(comparisonArea);

        contentArea.appendChild(container);

        // --- Logic ---
        const handleSearch = (query, resultsId, onSelect) => {
            const resEl = document.getElementById(resultsId);
            resEl.innerHTML = "";
            if (query.length < 2) return;

            // Search in SearchIndex
            const matches = (window.searchIndex || []).filter(item =>
                item.type === 'Spieler' && item.label.toLowerCase().includes(query.toLowerCase())
            ).slice(0, 10);

            matches.forEach(m => {
                const div = document.createElement('div');
                div.style.padding = "8px";
                div.style.borderBottom = "1px solid #334155";
                div.style.cursor = "pointer";
                replaceWithSearchResultLabel(div, '', m.label, m.context);
                div.onmouseover = () => div.style.backgroundColor = "#334155";
                div.onmouseout = () => div.style.backgroundColor = "transparent";
                div.onclick = () => {
                    resEl.innerHTML = "";
                    document.getElementById(resultsId.replace("results-", "search-")).value = "";
                    onSelect(m);
                };
                resEl.appendChild(div);
            });
        };

        const updateSelected = (sideId, player) => {
            const selEl = document.getElementById(`selected-${sideId}`);
            if (player) {
                selEl.style.display = "block";
                const selectedCard = document.createElement('div');
                selectedCard.style.cssText = 'background:rgba(59, 130, 246, 0.2); border:1px solid #3b82f6; padding:10px; border-radius:4px; align-items:center; display:flex; justify-content:space-between;';
                const selectedName = document.createElement('span');
                selectedName.style.cssText = 'font-weight:bold; color:#60a5fa;';
                selectedName.textContent = String(player.label ?? '');
                const removeButton = document.createElement('button');
                removeButton.type = 'button';
                removeButton.style.cssText = 'background:none; border:none; color:#94a3b8; cursor:pointer;';
                removeButton.textContent = '✕';
                removeButton.addEventListener('click', () => { selEl.style.display = 'none'; });
                selectedCard.append(selectedName, removeButton);
                selEl.replaceChildren(selectedCard);
            } else {
                selEl.style.display = "none";
            }
        };

        const renderComparison = () => {
            if (!p1 || !p2) {
                comparisonArea.style.display = "none";
                return;
            }

            const getFullData = (searchItem) => {
                let current = null;
                if (rankingData && rankingData.players) {
                    current = rankingData.players.find(p => p.name === searchItem.label);
                }
                return { name: searchItem.label, current, searchItem };
            };

            const d1 = getFullData(p1);
            const d2 = getFullData(p2);

            const getHistory = (d) => {
                let hist = [];
                // 1. Try ID Match (Exact)
                if (d.current && d.current.id && archiveData && archiveData[d.current.id]) {
                    hist = archiveData[d.current.id];
                }

                // 2. Fallback: Try Name Match (if no ID match found)
                if (hist.length === 0 && d.name) {
                    const searchName = d.name.toLowerCase().trim();
                    // Iterate over all archive entries
                    Object.values(archiveData).forEach(seasons => {
                        // Check if any season in this history block has this player's name
                        const match = seasons.some(s => s.name && s.name.toLowerCase().trim() === searchName);
                        if (match) {
                            // potential merge if multiple IDs found? For now just take the first robust match
                            // or append? Let's just take it if we found nothing yet.
                            if (hist.length === 0) hist = seasons;
                        }
                    });
                }
                return hist;
            };

            const h1 = getHistory(d1);
            const h2 = getHistory(d2);

            const calcAvg = (p) => {
                if (!p) return 0;
                const stats = calculatePlayerStats(p);
                return stats.avg;
            };

            const avg1 = calcAvg(d1.current);
            const avg2 = calcAvg(d2.current);

            const getBestStats = (hist) => {
                if (!hist || hist.length === 0) return { points: 0, season: '' };
                const best = hist.reduce((prev, current) => ((current.points || 0) > (prev.points || 0)) ? current : prev, { points: 0, season: '' });
                return { points: best.points || 0, season: best.season || '' };
            };

            const getBestRank = (hist) => {
                if (!hist || hist.length === 0) return { rank: 999, season: '' };
                const best = hist.reduce((prev, current) => ((current.rank || 999) < (prev.rank || 999)) ? current : prev, { rank: 999, season: '' });
                return { rank: best.rank || 999, season: best.season || '' };
            };

            const getSeasonList = (hist) => {
                if (!hist || hist.length === 0) return "";
                // Sort seasons if needed? They usually come in order or reverse order.
                // dedupe just in case
                const seasons = [...new Set(hist.map(e => e.season))].sort().join(", ");
                return seasons;
            };

            const best1Stats = getBestStats(h1); // Max Points
            const best2Stats = getBestStats(h2);

            const bestRank1 = getBestRank(h1); // Best Rank
            const bestRank2 = getBestRank(h2);

            const seasons1 = getSeasonList(h1);
            const seasons2 = getSeasonList(h2);

            const card = (val1, val2, label, subLabel, detail1 = "", detail2 = "", isFloat = false, invertWin = false) => {
                const v1 = isFloat ? val1.toFixed(2) : val1;
                const v2 = isFloat ? val2.toFixed(2) : val2;
                const safeDetail1 = escapeHtmlText(detail1);
                const safeDetail2 = escapeHtmlText(detail2);

                // Winner color logic
                let c1 = '#94a3b8';
                let c2 = '#94a3b8';

                if (val1 !== val2) {
                    let win1 = val1 > val2;
                    if (invertWin) win1 = val1 < val2; // Lower is better for Rank

                    if (win1) c1 = '#4ade80';
                    else c2 = '#4ade80';
                }

                // Small detail line style
                const detailStyle = "font-size: 0.7em; color: #64748b; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 80px;";

                return `
                 <div style="display: flex; justify-content: space-between; align-items: start; padding: 15px; border-bottom: 1px solid #334155;">
                    <div style="display: flex; flex-direction: column; align-items: center; width: 90px;">
                        <div style="font-size: 1.2em; font-weight: bold; color: ${c1};">${escapeHtmlText(v1)}</div>
                        ${detail1 ? `<div style="${detailStyle}" title="${safeDetail1}">${safeDetail1}</div>` : ''}
                    </div>
                    
                    <div style="flex: 1; text-align: center; padding: 0 10px;">
                        <div style="color: #cbd5e1; font-size: 0.9em; text-transform: uppercase;">${escapeHtmlText(label)}</div>
                        <div style="color: #64748b; font-size: 0.75em; margin-top: 2px;">${escapeHtmlText(subLabel)}</div>
                    </div>

                    <div style="display: flex; flex-direction: column; align-items: center; width: 90px;">
                         <div style="font-size: 1.2em; font-weight: bold; color: ${c2};">${escapeHtmlText(v2)}</div>
                         ${detail2 ? `<div style="${detailStyle}" title="${safeDetail2}">${safeDetail2}</div>` : ''}
                    </div>
                 </div>`;
            };

            let html = `<div style="background: #1e293b; border-radius: 8px; border: 1px solid #334155; overflow: hidden; margin-top: 20px;">
                <div style="padding: 15px; background: #0f172a; text-align: center; color: #94a3b8; font-weight: bold; border-bottom: 1px solid #334155;">
                    DIREKTER VERGLEICH
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; border-bottom: 1px solid #334155; background: rgba(15, 23, 42, 0.5); font-size: 0.9em; color: #f8fafc;">
                     <div style="width: 40%; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: bold;">${escapeHtmlText(d1.name)}</div>
                     <div style="width: 20%; text-align: center; color: #64748b; font-size: 0.8em;">vs</div>
                     <div style="width: 40%; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: bold;">${escapeHtmlText(d2.name)}</div>
                </div>
                ${card(avg1, avg2, "Ø Aktuell", "Durchschnitt dieser Saison", "", "", true)}
                
                <div style="display: flex; justify-content: space-between; align-items: start; padding: 15px; border-bottom: 1px solid #334155;">
                   <div style="width: 45%; text-align: center; font-size: 0.9em; font-weight: bold; color: #f8fafc; overflow: hidden; text-overflow: ellipsis;">${escapeHtmlText(d1.searchItem.context || '-')}</div>
                   <div style="width: 10%; text-align: center; color: #64748b; font-size: 0.8em;">Team</div>
                   <div style="width: 45%; text-align: center; font-size: 0.9em; font-weight: bold; color: #f8fafc; overflow: hidden; text-overflow: ellipsis;">${escapeHtmlText(d2.searchItem.context || '-')}</div>
                </div>

                ${card(h1.length, h2.length, "Erfahrung", "Anzahl gespielter Saisons im Archiv", seasons1, seasons2)}

                ${(() => {
                    const getTitles = (hist) => hist.filter(s => s.rank === 1).length;
                    const t1 = getTitles(h1);
                    const t2 = getTitles(h2);
                    return card(t1, t2, "Titel (Platz 1)", "Meisterschaften im Archiv", t1 > 0 ? "🏆" : "", t2 > 0 ? "🏆" : "");
                })()}

                ${(() => {
                    const leagueOrder = { "Bezirksliga": 4, "A-Klasse": 3, "B-Klasse": 2, "C-Klasse": 1 };
                    const getHighestLeague = (hist) => {
                        if (!hist || hist.length === 0) return "-";
                        let best = { name: "-", val: 0 };
                        hist.forEach(s => {
                            let lName = s.league || "";
                            // Simple normalized matching
                            let val = 0;
                            if (lName.includes("Bezirksliga")) val = 4;
                            else if (lName.includes("A-Klasse")) val = 3;
                            else if (lName.includes("B-Klasse")) val = 2;
                            else if (lName.includes("C-Klasse")) val = 1;

                            if (val > best.val) best = { name: lName, val: val };
                        });
                        return best.name;
                    };
                    const l1 = getHighestLeague(h1);
                    const l2 = getHighestLeague(h2);

                    // Custom Card for Text comparison
                    let c1 = '#94a3b8'; let c2 = '#94a3b8';
                    const getVal = (name) => {
                        if (name.includes("Bezirksliga")) return 4;
                        if (name.includes("A-Klasse")) return 3;
                        if (name.includes("B-Klasse")) return 2;
                        if (name.includes("C-Klasse")) return 1;
                        return 0;
                    }
                    const v1 = getVal(l1);
                    const v2 = getVal(l2);
                    if (v1 > v2) c1 = '#4ade80';
                    else if (v2 > v1) c2 = '#4ade80';

                    return `
                     <div style="display: flex; justify-content: space-between; align-items: start; padding: 15px; border-bottom: 1px solid #334155;">
                        <div style="width: 45%; text-align: center; font-size: 0.9em; font-weight: bold; color: ${c1}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtmlText(l1)}</div>
                        <div style="flex: 1; text-align: center; padding: 0 5px;">
                            <div style="color: #cbd5e1; font-size: 0.9em; text-transform: uppercase;">Höchste Klasse</div>
                            <div style="color: #64748b; font-size: 0.75em; margin-top: 2px;">Bisher gespielt</div>
                        </div>
                        <div style="width: 45%; text-align: center; font-size: 0.9em; font-weight: bold; color: ${c2}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtmlText(l2)}</div>
                      </div>`;
                })()}



                ${card(best1Stats.points, best2Stats.points, "Meiste Punkte", "Rekord in einer Saison (Archiv)", best1Stats.season, best2Stats.season)}
                ${card(bestRank1.rank === 999 ? '-' : bestRank1.rank + '.', bestRank2.rank === 999 ? '-' : bestRank2.rank + '.', "Beste Platzierung", "Bester Liga-Rang (Archiv)", bestRank1.season, bestRank2.season, false, true)}

                ${(() => {
                    // --- PREDICTION ALGORITHM ---
                    const getRecentForm = (p) => {
                        if (!p || !p.rounds) return 0;
                        let sum = 0;
                        let count = 0;
                        // Iterate backwards from R18 to R1
                        for (let i = 18; i >= 1; i--) {
                            const val = p.rounds[`R${i}`];
                            if (val && val !== "&nbsp;" && val !== "x" && !isNaN(parseInt(val))) {
                                sum += parseInt(val);
                                count++;
                                if (count >= 5) break; // Last 5 matches
                            }
                        }
                        return count > 0 ? sum / count : 0;
                    };

                    const form1 = getRecentForm(d1.current); // Avg of last 5 stats
                    const form2 = getRecentForm(d2.current);

                    // Normalize Inputs
                    // - Average: 40-70 range
                    // - Form: 40-70 range
                    // - Exp: 0-10 range

                    const safeDiv = (a, b) => (a + b === 0) ? 0.5 : (a / (a + b));

                    const pAvg = safeDiv(avg1, avg2) * 0.4; // 40% Weight for Season Avg
                    const pForm = safeDiv(form1, form2) * 0.5; // 50% Weight for Recent Form (Current Strength)
                    const pExp = safeDiv(h1.length, h2.length) * 0.1; // 10% Weight for Experience

                    let winProb1 = pAvg + pForm + pExp;

                    // Calibration: If data is missing (e.g. no form), fallback to 50/50
                    if (avg1 === 0 && avg2 === 0) winProb1 = 0.5;
                    else if (avg1 === 0) winProb1 = 0.2; // Penalize no data
                    else if (avg2 === 0) winProb1 = 0.8;

                    let winProb2 = 1 - winProb1;

                    // Clamping (never 100% or 0%)
                    if (winProb1 > 0.95) winProb1 = 0.95;
                    if (winProb1 < 0.05) winProb1 = 0.05;
                    winProb2 = 1 - winProb1;

                    const percent1 = Math.round(winProb1 * 100);
                    const percent2 = Math.round(winProb2 * 100);

                    // Text Prediction
                    let predictionText = "Ausgeglichenes Match";
                    let winnerName = "";
                    if (winProb1 > 0.6) { winnerName = d1.name; predictionText = `Vorteil für <strong>${escapeHtmlText(d1.name)}</strong>`; }
                    else if (winProb2 > 0.6) { winnerName = d2.name; predictionText = `Vorteil für <strong>${escapeHtmlText(d2.name)}</strong>`; }
                    else {
                        if (winProb1 >= 0.5) predictionText = "Knappes Ding (Leichter Vorteil Links)";
                        else predictionText = "Knappes Ding (Leichter Vorteil Rechts)";
                    }

                    return `
                     <div style="padding: 15px; margin-top: 20px; border-top: 1px solid #334155; text-align: center;">
                        <div style="font-size: 0.9em; text-transform: uppercase; color: #94a3b8; margin-bottom: 10px; letter-spacing: 1px;">Match Prediction 🔮</div>
                        
                        <div style="font-size: 1.1em; color: white; margin-bottom: 15px;">${predictionText}</div>

                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px;">
                            <div style="font-weight: bold; color: ${winProb1 > 0.5 ? '#4ade80' : '#94a3b8'};">${percent1}%</div>
                            <div style="font-weight: bold; color: ${winProb2 > 0.5 ? '#4ade80' : '#94a3b8'};">${percent2}%</div>
                        </div>

                        <div style="height: 12px; background: #334155; border-radius: 6px; overflow: hidden; display: flex;">
                             <div style="width: ${percent1}%; background: ${winProb1 > 0.5 ? '#3b82f6' : '#64748b'}; transition: width 1s ease-out;"></div>
                             <div style="width: ${percent2}%; background: ${winProb2 > 0.5 ? '#3b82f6' : '#64748b'}; transition: width 1s ease-out;"></div>
                        </div>
                        <div style="font-size: 0.7em; color: #64748b; margin-top: 8px;">
                            Basiert auf: Ø Saison (40%), Form (Last 5) (50%), Erfahrung (10%)
                        </div>
                     </div>
                    `;
                })()}
             </div>
             <div style="margin-top: 20px; text-align: center; padding: 10px; background: rgba(59, 130, 246, 0.1); border: 1px solid #3b82f6; border-radius: 6px; color: #60a5fa; font-size: 0.9em;">
                ℹ️ <strong>Erklärung:</strong><br>
                Daten basieren auf der aktuellen Saison und der verknüpften Historie.
                <br><em>Fehlende Daten können an Namen-/Vereinswechseln liegen.</em>
             </div>`;

            comparisonArea.innerHTML = html;
            comparisonArea.style.display = "block";
        };

        // Listeners
        document.getElementById('search-p1').addEventListener('input', (e) => handleSearch(e.target.value, 'results-p1', (p) => {
            p1 = p;
            updateSelected('p1', p);
            renderComparison();
        }));
        document.getElementById('search-p2').addEventListener('input', (e) => handleSearch(e.target.value, 'results-p2', (p) => {
            p2 = p;
            updateSelected('p2', p);
            renderComparison();
        }));
    }

    function renderAllTimeView() {
        topBarTitle.textContent = "Ewige Tabelle";
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.className = "fade-in";
        container.style.padding = "20px";
        container.style.maxWidth = "900px";
        container.style.margin = "0 auto";

        // --- Empty State ---
        if (!archiveData || Object.keys(archiveData).length === 0) {
            container.innerHTML = `<div style="text-align:center; padding: 40px; color: #94a3b8;">
                <h2>📭 Keine Archiv-Daten</h2>
                <p>Es wurden noch keine historischen Daten geladen.</p>
                </div>`;
            contentArea.appendChild(container);
            return;
        }

        // --- Liga-Tier Color Helper ---
        const leagueTierColor = (league) => {
            if (!league) return '#64748b';
            const l = league.toLowerCase();
            if (l.includes('bezirksoberliga')) return '#f59e0b';
            if (l.includes('bezirksliga')) return '#fbbf24';
            if (l.includes('a-klasse') || l.includes('a klasse')) return '#94a3b8';
            if (l.includes('b-klasse') || l.includes('b klasse')) return '#cd7f32';
            if (l.includes('c-klasse') || l.includes('c klasse')) return '#64748b';
            return '#64748b';
        };

        const leagueTierLabel = (league) => {
            if (!league) return '';
            const l = league.toLowerCase();
            if (l.includes('bezirksoberliga')) return 'BOL';
            if (l.includes('bezirksliga')) return 'BZ';
            if (l.includes('a-klasse') || l.includes('a klasse')) return 'A';
            if (l.includes('b-klasse') || l.includes('b klasse')) return 'B';
            if (l.includes('c-klasse') || l.includes('c klasse')) return 'C';
            return '';
        };

        // --- Season sort helper (ascending) ---
        const seasonOrder = (s) => {
            const m = (s || '').match(/(\d{2})/);
            return m ? parseInt(m[1]) : 0;
        };

        // --- Aggregation ---
        const allPlayers = [];
        const allLeagues = new Set();
        const allSeasons = new Set();

        // Build a map of archive players by key for later merging
        const playerMap = new Map();

        Object.entries(archiveData).forEach(([playerKey, seasons]) => {
            const name = seasons[0].name || "Unbekannt";
            const id = playerKey;
            const playerLeagues = new Set();

            // Sort seasons for trend calculation
            const sorted = [...seasons].sort((a, b) => seasonOrder(a.season) - seasonOrder(b.season));

            sorted.forEach(s => {
                allSeasons.add(s.season);
                if (s.league) {
                    playerLeagues.add(s.league);
                    allLeagues.add(s.league);
                }
            });

            playerMap.set(id, {
                id, name, leagues: playerLeagues,
                seasons: sorted
            });
        });

        // --- Merge current season from rankingData ---
        // Determine current season label from ranking last_updated
        let currentSeasonLabel = 'Aktuell';
        if (rankingData && rankingData.last_updated) {
            const m = rankingData.last_updated.match(/(\d{2})\.(\d{2})\.(\d{4})/);
            if (m) {
                const month = parseInt(m[2]);
                const year = parseInt(m[3]);
                // Season runs Aug-Jul: if month >= 8, season is year/(year+1), else (year-1)/year
                const startYear = month >= 8 ? year : year - 1;
                const endYear = startYear + 1;
                currentSeasonLabel = (startYear % 100).toString().padStart(2, '0') + '/' + (endYear % 100).toString().padStart(2, '0');
            }
        }

        if (rankingData && rankingData.players && rankingData.players.length > 0) {
            allSeasons.add(currentSeasonLabel);

            // Group ranking players by id (Nr.) — pick highest total if player appears in multiple leagues
            const bestByNr = new Map();
            rankingData.players.forEach(rp => {
                const nr = rp.id;
                const pts = parseInt(rp.points) || 0;
                if (!nr) return;
                const existing = bestByNr.get(nr);
                if (!existing || pts > (parseInt(existing.points) || 0)) {
                    bestByNr.set(nr, rp);
                }
            });

            bestByNr.forEach((rp, nr) => {
                const pts = parseInt(rp.points) || 0;
                const rank = parseInt(rp.rank) || 999;
                const league = rp.league || '';
                const seasonEntry = {
                    season: currentSeasonLabel,
                    rank: rank === 999 ? '-' : rank,
                    points: pts,
                    league: league,
                    name: rp.name,
                    isCurrent: true
                };

                if (playerMap.has(nr)) {
                    // Existing archive player — add current season
                    const p = playerMap.get(nr);
                    // Only add if not already present (avoid duplicates on re-render)
                    if (!p.seasons.some(s => s.season === currentSeasonLabel)) {
                        p.seasons.push(seasonEntry);
                    }
                    if (league) {
                        p.leagues.add(league);
                        allLeagues.add(league);
                    }
                } else {
                    // New player not in archive — create entry
                    const playerLeagues = new Set();
                    if (league) {
                        playerLeagues.add(league);
                        allLeagues.add(league);
                    }
                    playerMap.set(nr, {
                        id: nr,
                        name: rp.name || 'Unbekannt',
                        leagues: playerLeagues,
                        seasons: [seasonEntry]
                    });
                }
            });
        }

        // --- Finalize player stats ---
        playerMap.forEach((p) => {
            let totalPoints = 0;
            let totalSeasons = p.seasons.length;
            let bestSeasonRank = 999;
            let bestSeasonYearRank = '';
            let bestSeasonLeague = '';
            let maxPoints = 0;
            let maxPointsYear = '';
            let maxPointsLeague = '';

            p.seasons.forEach(s => {
                const pts = parseInt(s.points) || 0;
                totalPoints += pts;

                const r = parseInt(s.rank) || 999;
                if (r < bestSeasonRank) {
                    bestSeasonRank = r;
                    bestSeasonYearRank = s.season;
                    bestSeasonLeague = s.league || '';
                }
                if (pts > maxPoints) {
                    maxPoints = pts;
                    maxPointsYear = s.season;
                    maxPointsLeague = s.league || '';
                }
            });

            // Trend: compare last two seasons' points
            let trend = 'stable';
            if (p.seasons.length >= 2) {
                const last = parseInt(p.seasons[p.seasons.length - 1].points) || 0;
                const prev = parseInt(p.seasons[p.seasons.length - 2].points) || 0;
                if (last > prev + 5) trend = 'up';
                else if (last < prev - 5) trend = 'down';
            }

            const avgPoints = totalSeasons > 0 ? totalPoints / totalSeasons : 0;

            allPlayers.push({
                id: p.id, name: p.name, totalPoints, totalSeasons, avgPoints,
                bestSeasonRank, bestSeasonRankDisplay: (bestSeasonRank === 999 ? '-' : bestSeasonRank + '.'),
                bestSeasonYearRank, bestSeasonLeague,
                maxPoints, maxPointsYear, maxPointsLeague,
                trend, leagues: p.leagues,
                seasons: p.seasons
            });
        });

        // --- State ---
        let sortMode = 'totalPoints';
        let searchQuery = '';
        let pageSize = 50;
        let currentPage = 1;
        let expandedId = null;

        // --- Sort & Filter Logic ---
        const getFiltered = () => {
            let list = [...allPlayers];

            // Sort first to assign global ranks
            if (sortMode === 'totalPoints') list.sort((a, b) => b.totalPoints - a.totalPoints);
            else if (sortMode === 'avgPoints') list.sort((a, b) => b.avgPoints - a.avgPoints);
            else if (sortMode === 'bestRank') list.sort((a, b) => a.bestSeasonRank - b.bestSeasonRank);
            else if (sortMode === 'seasons') list.sort((a, b) => b.totalSeasons - a.totalSeasons || b.totalPoints - a.totalPoints);

            // Assign global rank before filtering
            list.forEach((p, idx) => { p.globalRank = idx + 1; });

            // Then filter by search (ranks stay from full list)
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                list = list.filter(p => p.name.toLowerCase().includes(q));
            }

            return list;
        };

        // --- Render Function ---
        const render = () => {
            container.innerHTML = '';

            const filtered = getFiltered();
            const shown = filtered.slice(0, currentPage * pageSize);
            const hasMore = shown.length < filtered.length;

            // --- Feature 6: Stats Header ---
            const totalPlayersCount = allPlayers.length;
            const activeSeasonCount = allSeasons.size;
            const veteranCount = allPlayers.filter(p => p.totalSeasons >= activeSeasonCount).length;

            let statsHtml = `<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;">`;
            const statCard = (icon, value, label) => `
                <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 15px; text-align: center;">
                    <div style="font-size: 1.6em; margin-bottom: 4px;">${icon}</div>
                    <div style="font-size: 1.4em; font-weight: bold; color: #f8fafc;">${value}</div>
                    <div style="font-size: 0.75em; color: #94a3b8; margin-top: 2px;">${label}</div>
                </div>`;
            statsHtml += statCard('👥', totalPlayersCount, 'Spieler gesamt');
            statsHtml += statCard('📅', activeSeasonCount, 'Saisons im Archiv');
            statsHtml += statCard('🎖️', veteranCount, `Veteranen (${activeSeasonCount}/${activeSeasonCount})`);
            statsHtml += `</div>`;
            container.insertAdjacentHTML('beforeend', statsHtml);

            // --- Feature 1: Controls (Sort, Filter, Search) ---
            const controlsDiv = document.createElement('div');
            controlsDiv.style.cssText = 'display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; align-items: center;';

            // Search
            const searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = '🔍 Spieler suchen...';
            searchInput.value = searchQuery;
            searchInput.style.cssText = 'flex: 1; min-width: 160px; padding: 10px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f8fafc; font-size: 0.9em;';
            searchInput.addEventListener('input', (e) => {
                searchQuery = e.target.value;
                currentPage = 1;
                render();
            });

            // Sort select
            const sortSelect = document.createElement('select');
            sortSelect.style.cssText = 'padding: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f8fafc; font-size: 0.85em; cursor: pointer;';
            const sortOptions = [
                { value: 'totalPoints', label: '⬇ Gesamtpunkte' },
                { value: 'avgPoints', label: '⬇ Ø Punkte/Saison' },
                { value: 'bestRank', label: '⬆ Beste Platzierung' },
                { value: 'seasons', label: '⬇ Meiste Saisons' }
            ];
            sortOptions.forEach(o => {
                const opt = document.createElement('option');
                opt.value = o.value;
                opt.textContent = o.label;
                if (o.value === sortMode) opt.selected = true;
                sortSelect.appendChild(opt);
            });
            sortSelect.addEventListener('change', (e) => {
                sortMode = e.target.value;
                currentPage = 1;
                render();
            });

            controlsDiv.appendChild(searchInput);
            controlsDiv.appendChild(sortSelect);
            container.appendChild(controlsDiv);

            // --- Result count ---
            const countDiv = document.createElement('div');
            countDiv.style.cssText = 'color: #64748b; font-size: 0.8em; margin-bottom: 10px;';
            countDiv.textContent = `${filtered.length} Spieler${searchQuery ? ` für "${searchQuery}"` : ''}`;
            container.appendChild(countDiv);

            // --- Table ---
            const tableDiv = document.createElement('div');
            tableDiv.style.cssText = 'background: #1e293b; border-radius: 8px; overflow: hidden; border: 1px solid #334155;';

            // Header
            let headerHtml = `<div style="display: flex; padding: 10px 12px; background: #0f172a; color: #94a3b8; font-size: 0.75em; font-weight: bold; border-bottom: 1px solid #334155; text-transform: uppercase; letter-spacing: 0.5px;">
                <div style="width: 36px; text-align: center;">#</div>
                <div style="flex: 1; padding-left: 8px;">Name</div>
                <div style="width: 40px; text-align: center;" title="Trend">📈</div>
                <div style="width: 50px; text-align: center;">Saisons</div>
                <div style="width: 70px; text-align: right;">Ø / Saison</div>
                <div style="width: 80px; text-align: right; padding-right: 10px;">Gesamt</div>
            </div>`;
            tableDiv.insertAdjacentHTML('beforeend', headerHtml);

            // Rows
            shown.forEach((p, idx) => {
                const rank = p.globalRank;
                let medal = '';
                if (rank === 1) medal = '🥇';
                else if (rank === 2) medal = '🥈';
                else if (rank === 3) medal = '🥉';
                else medal = `${rank}.`;

                const rankColor = rank <= 3 ? '#fbbf24' : '#cbd5e1';

                // Trend icon
                let trendIcon = '➡️';
                let trendColor = '#94a3b8';
                if (p.trend === 'up') { trendIcon = '↗️'; trendColor = '#4ade80'; }
                else if (p.trend === 'down') { trendIcon = '↘️'; trendColor = '#ef4444'; }

                // Current league tier badge (most recent season)
                const lastSeason = p.seasons[p.seasons.length - 1];
                const tierBadge = leagueTierLabel(lastSeason ? lastSeason.league : '');
                const tierColor = leagueTierColor(lastSeason ? lastSeason.league : '');

                const isExpanded = expandedId === p.id;
                const detailId = `alltime-detail-${String(p.id).replace(/[^A-Za-z0-9_-]/g, '-')}`;
                const toggleId = `${detailId}-toggle`;

                // Row
                const row = document.createElement('div');
                row.style.cssText = 'border-bottom: 1px solid #334155; transition: background 0.15s;';

                let rowHtml = `<div style="display: flex; padding: 12px; align-items: center;" class="alltime-row">
                    <div style="width: 36px; text-align: center; font-weight: bold; color: ${rankColor}; font-size: 0.95em;">${medal}</div>
                    <div style="flex: 1; padding-left: 8px; min-width: 0;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-weight: 600; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtmlText(p.name)}</span>
                            ${tierBadge ? `<span style="font-size: 0.65em; font-weight: bold; color: ${tierColor}; border: 1px solid ${tierColor}; padding: 1px 5px; border-radius: 3px; flex-shrink: 0;">${tierBadge}</span>` : ''}
                        </div>
                        <div style="font-size: 0.7em; color: #64748b; margin-top: 2px;">
                            Bester Rang: ${p.bestSeasonRankDisplay} (${escapeHtmlText(p.bestSeasonYearRank)}) • Max: ${p.maxPoints} Pkt (${escapeHtmlText(p.maxPointsYear)})
                        </div>
                    </div>
                    <div style="width: 40px; text-align: center; font-size: 0.9em;" title="${p.trend === 'up' ? 'Aufwärtstrend' : p.trend === 'down' ? 'Abwärtstrend' : 'Stabil'}">${trendIcon}</div>
                    <div style="width: 50px; text-align: center; color: #cbd5e1; font-size: 0.9em;">${p.totalSeasons}</div>
                    <div style="width: 70px; text-align: right; color: #60a5fa; font-weight: 500; font-size: 0.9em;">${p.avgPoints.toFixed(1)}</div>
                    <div style="width: 80px; text-align: right; padding-right: 10px; font-weight: bold; color: #4ade80; font-size: 1em;">${p.totalPoints}</div>
                    <button type="button" class="alltime-detail-button"></button>
                </div>`;

                // Feature 4: Expandable detail
                rowHtml += `<div id="${detailId}" class="alltime-detail-content" ${isExpanded ? '' : 'hidden'}>`;
                if (isExpanded) {
                    rowHtml += `<div class="table-scroll alltime-detail-table" tabindex="0" aria-label="Saisondetails von ${escapeHtmlText(p.name)}">
                        <table>
                            <thead>
                                <tr style="color: #94a3b8; text-align: left;">
                                    <th style="padding: 6px 8px; border-bottom: 1px solid #334155;">Saison</th>
                                    <th style="padding: 6px 8px; border-bottom: 1px solid #334155;">Liga</th>
                                    <th style="padding: 6px 8px; border-bottom: 1px solid #334155; text-align: center;">Rang</th>
                                    <th style="padding: 6px 8px; border-bottom: 1px solid #334155; text-align: right;">Punkte</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${p.seasons.map(s => {
                        const sc = leagueTierColor(s.league);
                        const sl = leagueTierLabel(s.league);
                        const isCur = s.isCurrent;
                        const rowBg = isCur ? 'background: rgba(74, 222, 128, 0.07);' : '';
                        return `<tr style="color: #e2e8f0; ${rowBg}">
                                        <td style="padding: 5px 8px; border-bottom: 1px solid #1e293b;">${escapeHtmlText(s.season)}${isCur ? ' ⚡' : ''}</td>
                                        <td style="padding: 5px 8px; border-bottom: 1px solid #1e293b;">
                                            <span style="color: ${sc}; font-weight: 500;">${escapeHtmlText(s.league || '-')}</span>
                                            ${sl ? `<span style="font-size: 0.75em; color: ${sc}; margin-left: 4px; border: 1px solid ${sc}; padding: 0 3px; border-radius: 2px;">${sl}</span>` : ''}
                                        </td>
                                        <td style="padding: 5px 8px; border-bottom: 1px solid #1e293b; text-align: center;">${escapeHtmlText(s.rank || '-')}</td>
                                        <td style="padding: 5px 8px; border-bottom: 1px solid #1e293b; text-align: right; font-weight: bold; color: #4ade80;">${escapeHtmlText(s.points || 0)}</td>
                                    </tr>`;
                    }).join('')}
                            </tbody>
                        </table>
                    </div>`;
                }
                rowHtml += '</div>';

                row.innerHTML = rowHtml;
                const detailButton = row.querySelector('.alltime-detail-button');
                detailButton.id = toggleId;

                configureAllTimeDetailButton(
                    detailButton,
                    detailId,
                    isExpanded,
                    () => {
                        expandedId = expandedId === p.id ? null : p.id;
                        rerenderAllTimeDetail(container, toggleId, render);
                    },
                );

                // Hover effect
                row.addEventListener('mouseenter', () => { row.style.background = 'rgba(51, 65, 85, 0.3)'; });
                row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });

                tableDiv.appendChild(row);
            });

            container.appendChild(tableDiv);

            // --- Feature 7: Pagination ---
            if (hasMore) {
                const loadMoreBtn = document.createElement('button');
                loadMoreBtn.textContent = `Mehr laden (${shown.length} / ${filtered.length})`;
                loadMoreBtn.style.cssText = 'display: block; width: 100%; margin-top: 16px; padding: 14px; background: #1e293b; border: 1px solid #334155; color: #60a5fa; font-weight: 600; font-size: 0.9em; border-radius: 8px; cursor: pointer; transition: all 0.2s;';
                loadMoreBtn.addEventListener('mouseenter', () => { loadMoreBtn.style.background = '#334155'; });
                loadMoreBtn.addEventListener('mouseleave', () => { loadMoreBtn.style.background = '#1e293b'; });
                loadMoreBtn.addEventListener('click', () => {
                    currentPage++;
                    render();
                });
                container.appendChild(loadMoreBtn);
            }

            // Re-focus search input if user was typing
            if (searchQuery) {
                const newInput = container.querySelector('input[type="text"]');
                if (newInput) {
                    newInput.focus();
                    newInput.setSelectionRange(searchQuery.length, searchQuery.length);
                }
            }
        };

        contentArea.appendChild(container);
        render();
    }



    // =============================================
    // MATCH SCORER ENGINE
    // =============================================
    class MatchScorer {
        constructor(container) {
            this.container = container;
            this.players = []; // { name, score, history: [], legs: 0 }
            this.currentTurnDarts = []; // Track individual darts (max 3)
            this.activePlayerIndex = 0;
            this.gameMode = 'DO'; // 'DO' (Double Out) or 'MO' (Master Out)
            this.isLeagueMode = false; // New: 2vs2 League Mode
            this.startScore = 501;
            this.recognition = null;
            this.isListening = false;

            this.initSpeech();
            this.currentTurnMults = []; // Track multipliers for validation

            // Audio Unlock Strategy
            this.audioCtx = null;
            this.unlockAudioBind = this.unlockAudio.bind(this);
            document.addEventListener('click', this.unlockAudioBind, { once: true });
            document.addEventListener('touchstart', this.unlockAudioBind, { once: true });
        }

        unlockAudio() {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            if (!this.audioCtx) this.audioCtx = new AudioContext();
            if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

            // Play silent buffer to unlock strict browsers
            const buffer = this.audioCtx.createBuffer(1, 1, 22050);
            const source = this.audioCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(this.audioCtx.destination);
            source.start(0);
        }

        initSpeech() {
            if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                this.recognition = new SpeechRecognition();
                this.recognition.continuous = false;
                this.recognition.lang = 'de-DE';
                this.recognition.interimResults = false;
                this.recognition.maxAlternatives = 1;

                this.recognition.onresult = (event) => {
                    const last = event.results.length - 1;
                    const text = event.results[last][0].transcript;
                    console.log('Voice Input:', text);
                    this.handleVoiceInput(text);
                };

                this.recognition.onend = () => {
                    if (this.isListening) this.recognition.start();
                };

                this.recognition.onerror = (e) => {
                    console.error('Speech Error:', e.error);
                    this.isListening = false;
                    this.updateVoiceUI();
                };
            }
        }

        toggleVoice() {
            if (!this.recognition) {
                alert("Spracherkennung wird von diesem Browser nicht unterstützt (probiere Chrome/Edge).");
                return;
            }
            this.isListening = !this.isListening;
            if (this.isListening) {
                try {
                    this.recognition.start();
                } catch (e) { console.warn("Mic start error", e); }
            } else {
                this.recognition.stop();
            }
            this.updateVoiceUI();
        }

        updateVoiceUI() {
            const btn = document.getElementById('voice-toggle-btn');
            if (btn) {
                btn.style.background = this.isListening ? '#ef4444' : '#334155';
                btn.innerHTML = this.isListening ? '🎤 An' : '🎤 Aus';
                if (this.isListening) btn.classList.add('pulse-animation');
                else btn.classList.remove('pulse-animation');
            }
        }

        handleVoiceInput(text) {
            // Simple parser (German numbers)
            const map = {
                'eins': 1, 'zwei': 2, 'drei': 3, 'vier': 4, 'fünf': 5,
                'sechs': 6, 'sieben': 7, 'acht': 8, 'neun': 9, 'zehn': 10,
                'elf': 11, 'zwölf': 12, 'hundert': 100, 'hundertachtzig': 180,
                'bull': 50, 'bullseye': 50, 'doppel': 'D', 'triple': 'T'
            };

            let val = parseInt(text);
            if (isNaN(val)) {
                // Try to parse text numbers if parseInt fails
                const lower = text.toLowerCase().trim();
                // Check map
                if (map[lower]) val = map[lower];
                // Check if it ends with words in map (e.g. "hundert zwanzig")
                // Keep it simple for now
            }

            if (!isNaN(val) && val >= 0 && val <= 180) {
                // assume voice gives total turn score
                this.currentTurnDarts = [val];
                this.confirmTurn();

                // Show feedback
                const feedback = document.createElement('div');
                feedback.textContent = `🎤 ${val}`;
                feedback.style.cssText = "position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:rgba(0,0,0,0.8); color:#00e0ff; padding:20px; border-radius:10px; font-size:2em; z-index:9999; pointer-events:none; animation: fadeUp 1s forwards;";
                document.body.appendChild(feedback);
                setTimeout(() => feedback.remove(), 1000);

                // Auto-stop voice to avoid interference with output
                if (this.isListening) {
                    this.toggleVoice();
                }
            }
        }

        renderSetup() {
            this.container.innerHTML = '';

            const card = document.createElement('div');
            card.className = "setup-card";
            card.style.cssText = "background: #1e293b; padding: 25px; border-radius: 12px; max-width: 500px; margin: 0 auto; border: 1px solid #334155;";

            card.innerHTML = `
                <h2 style="text-align:center; margin-bottom: 20px; color: #60a5fa;">Match Setup</h2>
                
                <div style="margin-bottom: 20px;">
                    <label style="display:block; color:#94a3b8; margin-bottom:8px;">Modus</label>
                    <div style="display:flex; gap:10px;">
                        <button id="mode-do" class="mode-btn active" style="flex:1; padding:10px; border-radius:6px; border:none; background:#3b82f6; color:white; font-weight:bold; cursor:pointer;">Double Out</button>
                        <button id="mode-mo" class="mode-btn" style="flex:1; padding:10px; border-radius:6px; border:none; background:#334155; color:#94a3b8; font-weight:bold; cursor:pointer;">Master Out</button>
                    </div>
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="display:block; color:#94a3b8; margin-bottom:8px;">Team Modus</label>
                    <button id="mode-league" class="mode-btn" style="width:100%; padding:10px; border-radius:6px; border:none; background:#334155; color:#94a3b8; font-weight:bold; cursor:pointer;">
                        Liga (2vs2)
                    </button>
                    <div id="league-hint" style="display:none; color:#f59e0b; font-size:0.8em; margin-top:5px;">
                        ⚠️ Benötigt genau 4 Spieler. (Team A: Sp 1+3, Team B: Sp 2+4)<br>
                        Regel: Check nur möglich, wenn Partner < Gegner-Summe.
                    </div>
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="display:block; color:#94a3b8; margin-bottom:8px;">Start Punkte</label>
                    <select id="start-points" style="width:100%; padding:10px; background:#0f172a; color:white; border:1px solid #334155; border-radius:6px;">
                        <option value="301">301</option>
                        <option value="501" selected>501</option>
                        <option value="701">701</option>
                    </select>
                </div>

                <div style="margin-bottom: 25px;">
                    <label style="display:block; color:#94a3b8; margin-bottom:8px;">Spieler</label>
                    <div id="player-list" style="margin-bottom:10px; display:flex; flex-direction:column; gap:8px;"></div>
                    <div style="display:flex; gap:10px;">
                        <input type="text" id="new-player-name" placeholder="Name (z.B. Tobi)" style="flex:1; padding:10px; background:#0f172a; color:white; border:1px solid #334155; border-radius:6px;">
                        <button id="add-player-btn" style="padding:10px 15px; background:#10b981; color:white; border:none; border-radius:6px; cursor:pointer;">+</button>
                    </div>
                </div>

                <button id="start-match-btn" style="width:100%; padding:15px; background:#3b82f6; color:white; border:none; border-radius:8px; font-size:1.1em; font-weight:bold; cursor:pointer; opacity: 0.5; pointer-events: none;">Match Starten</button>
            `;

            this.container.appendChild(card);

            // Logic
            const btnDO = card.querySelector('#mode-do');
            const btnMO = card.querySelector('#mode-mo');
            const btnLeague = card.querySelector('#mode-league');
            const leagueHint = card.querySelector('#league-hint');
            const playerList = card.querySelector('#player-list');
            const inputName = card.querySelector('#new-player-name');
            const btnAdd = card.querySelector('#add-player-btn');
            const btnStart = card.querySelector('#start-match-btn');
            const startPoints = card.querySelector('#start-points');

            const updateStartBtn = () => {
                if (this.isLeagueMode) {
                    if (this.players.length === 4) {
                        btnStart.style.opacity = "1";
                        btnStart.style.pointerEvents = "all";
                        btnStart.textContent = `Liga-Match Starten`;
                    } else {
                        btnStart.style.opacity = "0.5";
                        btnStart.style.pointerEvents = "none";
                        btnStart.textContent = `Benötigt 4 Spieler (${this.players.length}/4)`;
                    }
                } else {
                    if (this.players.length > 0) {
                        btnStart.style.opacity = "1";
                        btnStart.style.pointerEvents = "all";
                        btnStart.textContent = `Match Starten (${this.players.length} Spieler)`;
                    } else {
                        btnStart.style.opacity = "0.5";
                        btnStart.style.pointerEvents = "none";
                        btnStart.textContent = "Match Starten";
                    }
                }
            };

            const renderPlayers = () => {
                playerList.innerHTML = '';
                this.players.forEach((p, i) => {
                    const div = document.createElement('div');
                    div.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:#334155; padding:8px 12px; border-radius:6px;";
                    const playerName = document.createElement('span');
                    playerName.style.color = 'white';
                    playerName.textContent = String(p.name ?? '');
                    const removeButton = document.createElement('button');
                    removeButton.type = 'button';
                    removeButton.dataset.idx = String(i);
                    removeButton.className = 'remove-p-btn';
                    removeButton.style.cssText = 'background:transparent; color:#ef4444; border:none; cursor:pointer;';
                    removeButton.textContent = '✕';
                    div.append(playerName, removeButton);
                    playerList.appendChild(div);
                });

                playerList.querySelectorAll('.remove-p-btn').forEach(b => {
                    b.onclick = (e) => {
                        this.players.splice(parseInt(e.target.dataset.idx), 1);
                        renderPlayers();
                        updateStartBtn();
                    };
                });
            };

            // Pre-fill with "Ich" if empty
            if (this.players.length === 0 && myPlayerProfile) {
                this.players.push({ name: myPlayerProfile.name, score: 501, history: [], legs: 0 });
                renderPlayers();
                updateStartBtn();
            } else {
                renderPlayers();
                updateStartBtn();
            }

            btnAdd.onclick = () => {
                const name = inputName.value.trim();
                if (name) {
                    this.players.push({ name: name, score: parseInt(startPoints.value), history: [], legs: 0 });
                    inputName.value = '';
                    renderPlayers();
                    updateStartBtn();
                }
            };

            inputName.onkeypress = (e) => {
                if (e.key === 'Enter') btnAdd.click();
            }

            btnDO.onclick = () => { this.gameMode = 'DO'; btnDO.className = 'mode-btn active'; btnMO.className = 'mode-btn'; btnDO.style.background = '#3b82f6'; btnDO.style.color = 'white'; btnMO.style.background = '#334155'; btnMO.style.color = '#94a3b8'; };
            btnMO.onclick = () => { this.gameMode = 'MO'; btnMO.className = 'mode-btn active'; btnDO.className = 'mode-btn'; btnMO.style.background = '#3b82f6'; btnMO.style.color = 'white'; btnDO.style.background = '#334155'; btnDO.style.color = '#94a3b8'; };

            btnLeague.onclick = () => {
                this.isLeagueMode = !this.isLeagueMode;
                if (this.isLeagueMode) {
                    btnLeague.style.background = '#8b5cf6'; // Purple
                    btnLeague.style.color = 'white';
                    leagueHint.style.display = 'block';
                } else {
                    btnLeague.style.background = '#334155';
                    btnLeague.style.color = '#94a3b8';
                    leagueHint.style.display = 'none';
                }
                updateStartBtn();
            };

            startPoints.onchange = () => {
                this.startScore = parseInt(startPoints.value);
                this.players.forEach(p => p.score = this.startScore); // Reset scores if changed
            };

            btnStart.onclick = () => {
                this.startScore = parseInt(startPoints.value); // Confirm start score
                // Reset scores to start score
                this.players.forEach(p => {
                    p.score = this.startScore;
                    p.history = [];
                });
                this.activePlayerIndex = 0;
                this.renderBoard();

                // Voice Feedback for First Player
                if (this.players.length > 0 && this.players[0].score > 0) {
                    this.speakScore(this.players[0].score);
                }
            };
        }

        renderBoard() {
            this.container.innerHTML = '';
            this.renderGameUI();
        }

        getCheckout(val) {
            const outsDO = {
                170: "T20 - T20 - Bull", 167: "T20 - T19 - Bull", 164: "T20 - T18 - Bull", 161: "T20 - T17 - Bull", 160: "T20 - T20 - D20",
                158: "T20 - T20 - D19", 157: "T20 - T19 - D20", 156: "T20 - T20 - D18", 155: "T20 - T19 - D19", 154: "T20 - T18 - D20",
                153: "T20 - T19 - D18", 152: "T20 - T20 - D16", 151: "T20 - T17 - D20", 150: "T20 - T18 - D18", 149: "T20 - T19 - D16",
                148: "T20 - T16 - D20", 147: "T20 - T17 - D18", 146: "T20 - T18 - D16", 145: "T20 - T15 - D20", 144: "T20 - T20 - D12",
                143: "T20 - T17 - D16", 142: "T20 - T14 - D20", 141: "T20 - T19 - D12", 140: "T20 - T16 - D16", 139: "T19 - T14 - D20",
                138: "T20 - T18 - D12", 137: "T19 - T16 - D16", 136: "T20 - T20 - D8", 135: "25 - T20 - Bull", 134: "T20 - T14 - D16",
                133: "T20 - T19 - D8", 132: "25 - T19 - Bull", 131: "T20 - T13 - D16", 130: "T20 - T18 - D8", 129: "T19 - T20 - D6",
                128: "T18 - T14 - D16", 127: "T20 - T17 - D8", 126: "T19 - T19 - D6", 125: "Bull - 25 - Bull", 124: "T20 - D16 - D16",
                123: "T19 - T16 - D9", 122: "T18 - 18 - Bull", 121: "T20 - 11 - Bull", 120: "T20 - 20 - D20", 119: "T19 - 12 - Bull",
                118: "T20 - 18 - D20", 117: "T20 - 17 - D20", 116: "T20 - 16 - D20", 115: "T20 - 15 - D20", 114: "T20 - 14 - D20",
                113: "T20 - 13 - D20", 112: "T20 - 20 - D16", 111: "T20 - 19 - D16", 110: "T20 - 18 - D16", 109: "T20 - 17 - D16",
                108: "T20 - 16 - D16", 107: "T19 - 10 - D20", 106: "T20 - 14 - D16", 105: "T20 - 13 - D16", 104: "T18 - 10 - D20",
                103: "T20 - 3 - D20", 102: "T20 - 10 - D16", 101: "T17 - 10 - D20", 100: "T20 - D20",
                99: "T19 - 10 - D16", 98: "T20 - D19", 97: "T19 - D20", 96: "T20 - D18", 95: "T19 - D19", 94: "T18 - D20", 93: "T19 - D18", 92: "T20 - D16", 91: "T17 - D20",
                90: "T18 - D18", 89: "T19 - D16", 88: "T16 - D20", 87: "T17 - D18", 86: "T18 - D16", 85: "T15 - D20", 84: "T20 - D12", 83: "T17 - D16", 82: "T14 - D20", 81: "T15 - D18",
                80: "T20 - D10", 79: "T13 - D20", 78: "T18 - D12", 77: "T19 - D10", 76: "T20 - D8", 75: "T13 - D18", 74: "T14 - D16", 73: "T19 - D8", 72: "T16 - D12", 71: "T13 - D16",
                70: "T18 - D8", 69: "T15 - D12", 68: "T20 - D4", 67: "T17 - D8", 66: "T10 - D18", 65: "T15 - D10", 64: "D16 - D16", 63: "T13 - D12", 62: "T10 - D16", 61: "T15 - D8",
                60: "20 - D20", 59: "19 - D20", 58: "18 - D20", 57: "17 - D20", 56: "16 - D20", 55: "15 - D20", 54: "14 - D20", 53: "13 - D20", 52: "12 - D20", 51: "11 - D20",
                50: "10 - D20", 49: "9 - D20", 48: "16 - D16", 47: "15 - D16", 46: "6 - D20", 45: "13 - D16", 44: "12 - D16", 43: "3 - D20", 42: "10 - D16", 41: "9 - D16",
                40: "D20", 39: "7 - D16", 38: "D19", 37: "5 - D16", 36: "D18", 35: "3 - D16", 34: "D17", 33: "9 - D12", 32: "D16", 31: "15 - D8",
                30: "D15", 29: "13 - D8", 28: "D14", 27: "11 - D8", 26: "D13", 25: "9 - D8", 24: "D12", 23: "7 - D8", 22: "D11", 21: "5 - D8",
                20: "D10", 19: "3 - D8", 18: "D9", 17: "1 - D8", 16: "D8", 15: "7 - D4", 14: "D7", 13: "5 - D4", 12: "D6", 11: "3 - D4",
                10: "D5", 9: "1 - D4", 8: "D4", 7: "3 - D2", 6: "D3", 5: "1 - D2", 4: "D2", 3: "1 - D1", 2: "D1"
            };
            const outsMO = {
                ...outsDO,
                180: "T20 - T20 - T20", 179: "T20 - T19 - T20", 178: "T20 - T20 - T18", 177: "T20 - T19 - T18", 176: "T20 - T20 - T16", 175: "T20 - T19 - T16",
                174: "T20 - T20 - T14", 173: "T20 - T19 - T14", 172: "T20 - T20 - T12", 171: "T20 - T19 - T12",
                // 61-99 Low number overrides
                99: "T19 - 10 - D16",
                // Multiples of 3 can be finished on Triple
                3: "T1", 6: "T2", 9: "T3", 12: "T4", 15: "T5", 18: "T6", 21: "T7", 24: "T8", 27: "T9", 30: "T10", 33: "T11", 36: "T12",
                39: "T13", 42: "T14", 45: "T15", 48: "T16", 51: "T17", 54: "T18", 57: "T19", 60: "T20"
            };

            let res = null;
            if (this.gameMode === 'MO' && outsMO[val]) res = outsMO[val];
            else if (outsDO[val]) res = outsDO[val];

            if (res) return res;
            if (val <= 1 && val !== 0) return "Nicht checkbar";
            if (val === 0) return "Check!";
            if (this.gameMode === 'DO' && val > 170) return "Nicht checkbar";

            return "Kein Standard-Finish";
        }

        renderGameUI() {
            const activePlayer = this.players[this.activePlayerIndex];

            // Calculate remaining for dynamic checkout
            const currentTurnTotal = this.currentTurnDarts.reduce((a, b) => a + b, 0);
            const remaining = activePlayer.score - currentTurnTotal;

            // Visual Checkout Logic
            const checkoutStr = this.getCheckout(remaining);
            const highlightIds = this.getCheckoutSegments(checkoutStr);
            const dartboardSVG = this.renderDartboardSVG(highlightIds);

            this.container.innerHTML = `
                <style>
                    .scorer-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; max-width: 350px; margin: 0 auto; }
                    .scorer-btn { padding: 15px; font-size: 1.5em; background: #334155; color: white; border: none; border-radius: 8px; cursor: pointer; touch-action: manipulation; }
                    .scorer-btn:active { background: #475569; transform: scale(0.98); }
                    .scorer-action { background: #475569; font-size: 1em; font-weight: bold; }
                    .scorer-enter { background: #22c55e; grid-row: span 2; display: flex; align-items: center; justify-content: center; }
                    
                    /* Dartboard specific */
                    .board-segment { transition: all 0.3s ease; cursor: pointer; }
                    .board-segment:hover { opacity: 0.8; }
                    .highlighted { filter: drop-shadow(0 0 10px #00e0ff); stroke: #00e0ff; stroke-width: 3 !important; z-index: 10; opacity: 1 !important; }
                    .highlighted text { fill: black !important; font-weight: 900; font-size: 14px; }
                    
                    .checkout-text-box {
                        font-family: 'Courier New', monospace;
                        background: rgba(0,0,0,0.3);
                        padding: 10px;
                        border-radius: 8px;
                        border: 1px solid #334155;
                        text-shadow: 0 0 10px rgba(0, 224, 255, 0.5);
                    }
                    
                    .pulse-animation { animation: pulse 1.5s infinite; }
                    @keyframes pulse {
                         0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
                         70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
                         100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
                    }

                    @media (max-width: 700px) {
                        .match-layout { flex-direction: column; align-items: center; }
                        .dartboard-container { margin-bottom: 20px; }
                        .current-score-box { font-size: 2em; }
                        /* Grid-like wrapping */
                        .player-score-container { 
                            flex-direction: row !important; 
                            flex-wrap: wrap !important; 
                            justify-content: center !important; 
                            align-items: stretch !important;
                            overflow-x: visible !important; 
                        }
                        .player-card { 
                            width: auto !important;
                            flex: 1 1 140px !important; /* Grow/shrink, min 140px */
                            max-width: 200px !important; 
                            margin-bottom: 10px; 
                            box-sizing: border-box; 
                        }
                    }
                </style>
                
                 <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                      <button id="back-setup-btn" style="background:#334155; color:white; border:none; padding:8px 15px; border-radius:6px; cursor:pointer; font-weight:bold;">🆕 Neues Spiel</button>
                      
                      <div class="checkout-text-box" style="margin: 0 15px; flex: 1; text-align: center;">
                          <div style="font-size: 0.8em; color: #94a3b8; margin-bottom: 2px;">CHECKOUT WEG</div>
                          <div style="font-size: 1.8em; font-weight:bold; color: ${checkoutStr && !checkoutStr.includes('Nicht') && !checkoutStr.includes('Kein') ? '#00e0ff' : '#64748b'};">
                              ${checkoutStr || '-'}
                          </div>
                      </div>

                      <button id="voice-toggle-btn" style="background:#334155; color:white; border:none; padding:8px 15px; border-radius:6px; cursor:pointer; font-weight:bold;">🎤 Aus</button>
                 </div>
                
                <div class="match-layout" style="display: flex; gap: 20px; align-items: flex-start; justify-content: center;">
                    
                    <!-- Left: Dartboard + Controls -->
                    <div class="dartboard-container" style="flex: 0 0 auto; display: flex; flex-direction: column; align-items: center;">
                        ${dartboardSVG}
                        
                        <div style="margin-top: 20px; display: flex; gap: 10px; width: 100%; justify-content: center;">
                             <button id="undo-btn" style="background:#475569; color:white; border:none; padding:12px 20px; border-radius:8px; font-size:1.1em; cursor:pointer; display:flex; align-items:center; gap:8px; flex: 1; justify-content: center; max-width: 160px; transition: background 0.2s;">
                                 <span>↩️</span> Rückgängig
                             </button>
                             <button id="confirm-btn" style="background:#22c55e; color:white; border:none; padding:12px 20px; border-radius:8px; font-size:1.1em; cursor:pointer; display:flex; align-items:center; gap:8px; font-weight:bold; flex: 1; justify-content: center; max-width: 160px; transition: background 0.2s;">
                                 <span>✅</span> Bestätigen
                             </button>
                        </div>
                    </div>

                    <!-- Right: Scorer & Players -->
                    <div style="flex: 1; min-width: 300px; max-width: 400px;">
                        <!-- Player Scores -->
                        <div class="player-score-container" style="display:flex; gap:10px; overflow-x:auto; margin-bottom:20px; padding-bottom:10px;">
                            ${this.players.map((p, i) => {
                let teamBadge = '';
                if (this.isLeagueMode && this.players.length === 4) {
                    const isTeamA = i % 2 === 0;
                    const teamColor = isTeamA ? '#3b82f6' : '#ef4444';
                    const teamName = isTeamA ? 'TEAM A' : 'TEAM B';
                    teamBadge = `<div style="font-size:0.7em; background:${teamColor}; color:white; padding:2px 6px; border-radius:4px; margin-bottom:5px; display:inline-block;">${teamName}</div>`;
                }

                return `
                                <div class="player-card" style="min-width:100px; background:${i === this.activePlayerIndex ? '#3b82f6' : '#1e293b'}; padding:10px; border-radius:10px; text-align:center; transition:all 0.3s ease; transform:${i === this.activePlayerIndex ? 'scale(1.05)' : 'scale(1)'}; border:2px solid ${i === this.activePlayerIndex ? '#60a5fa' : '#334155'}; position: relative;">
                                    ${teamBadge}
                                    <div style="font-size:0.8em; color:${i === this.activePlayerIndex ? 'white' : '#94a3b8'}">${escapeHtmlText(p.name)}</div>
                                    <div style="font-size:2em; font-weight:bold; color:white;">
                                        ${i === this.activePlayerIndex ? (p.score - currentTurnTotal) : p.score}
                                    </div>
                                    <div style="font-size:0.7em; color:#cbd5e1;">Legs: ${p.legs} | Avg: ${this.calculateAvg(p)}</div>
                                </div>
                            `;
            }).join('')}
                        </div>
                        
                        <!-- Active Turn Input -->
                        <div style="background:#1e293b; padding:15px; border-radius:12px; margin-bottom:15px; text-align:center; position: relative;">
                            <div style="color:#94a3b8; font-size: 0.9em; margin-bottom:5px;">Aufnahme für <strong>${escapeHtmlText(activePlayer.name)}</strong></div>
                            
                            <!-- 3-Dart Display -->
                            <div style="display:flex; justify-content:center; gap:10px; margin-bottom:10px;">
                                ${[0, 1, 2].map(i => `
                                    <div style="width:60px; height:60px; background:${this.currentTurnDarts[i] !== undefined ? '#334155' : '#0f172a'}; border:1px solid #475569; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.5em; font-weight:bold; color:white;">
                                        ${this.currentTurnDarts[i] !== undefined ? this.currentTurnDarts[i] : ''}
                                    </div>
                                `).join('')}
                            </div>
                            
                            <!-- Current Sum & Input Buffer -->
                            <div style="text-align:left; font-size:0.7em; color:#94a3b8; margin-bottom:2px; margin-left:5px;">Manuelle Eingabe (Summe):</div>
                            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:#0f172a; border-radius:8px;">
                                <div style="font-size:0.8em; color:#94a3b8;">Summe: <span style="font-size:1.5em; color:#4ade80; font-weight:bold;">${this.currentTurnDarts.reduce((a, b) => a + b, 0)}</span></div>
                                <div id="current-input-buffer" style="font-size:1.5em; color:white; min-width:50px; text-align:right;"></div>
                            </div>

                        </div>

                        <!-- Numpad -->
                        <div class="scorer-grid">
                            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="scorer-btn" onclick="window.matchScorer.addInput(${n})">${n}</button>`).join('')}
                            <button class="scorer-btn" onclick="window.matchScorer.addInput(0)">0</button>
                            <button class="scorer-btn scorer-action" onclick="window.matchScorer.backspace()">⌫</button>
                            <button class="scorer-btn scorer-enter" style="${this.currentTurnDarts.length === 3 ? 'background:#ec4899;' : ''}" onclick="window.matchScorer.submitInput()">${this.currentTurnDarts.length === 3 ? 'WEITER' : 'Enter'}</button>
                        </div>
                    </div>
                </div>
             `;

            // Re-bind listeners
            this.container.querySelector('#back-setup-btn').onclick = () => this.renderSetup();
            this.container.querySelector('#voice-toggle-btn').onclick = () => this.toggleVoice();
            this.container.querySelector('#undo-btn').onclick = () => this.backspace();
            this.container.querySelector('#confirm-btn').onclick = () => this.confirmTurn();

            // Add click listeners to board segments
            this.container.querySelectorAll('.board-segment').forEach(seg => {
                seg.onclick = (e) => {
                    e.stopPropagation();
                    const val = parseInt(seg.dataset.val);
                    const mult = parseInt(seg.dataset.mult || 1);
                    this.addDart(val, mult);
                };
            });

            this.updateVoiceUI();
        }




        getCheckoutSegments(checkoutStr) {
            if (!checkoutStr || checkoutStr.includes("Nicht") || checkoutStr.includes("Kein")) return [];
            const segments = [];
            const parts = checkoutStr.split(' - ');
            parts.forEach(p => {
                const norm = p.trim().toUpperCase();
                if (norm === 'BULL') segments.push('s_50');
                else if (norm === '25') segments.push('s_25');
                else if (norm.startsWith('T')) segments.push('s_t' + norm.substring(1));
                else if (norm.startsWith('D')) segments.push('s_d' + norm.substring(1));
                else {
                    segments.push('s_so' + norm);
                    segments.push('s_si' + norm);
                }
            });
            return segments;
        }

        renderDartboardSVG(highlightIds = []) {
            const size = 340, cx = 170, cy = 170;
            // Radii (approx)
            const rDoubleOut = 140, rDoubleIn = 130;
            const rTrebleOut = 85, rTrebleIn = 75;
            const rOuter = 130, rInner = 15;
            const rBull = 6;

            // Standard order starting from top (20) clockwise
            const numbers = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
            const slice = 360 / 20;

            let paths = '';

            // Generate segments
            numbers.forEach((val, i) => {
                const angle = -90 + (i * slice) - (slice / 2); // Start -9 degrees (since 20 is at top center)
                // Correct logic: 20 is centered at -90deg. So start is -90 - 9 = -99.
                // Actually, standard board: 20 is top. 
                // Let's use simple rotation. Each slice is 18deg. 
                // 20 is at index 0. Center of 20 is -90deg.
                // So slice 0 starts at -99deg and ends at -81deg.

                const startA = (i * slice) - 9 - 90;
                const endA = startA + 18;

                const toRad = d => d * Math.PI / 180;

                const arc = (rStart, rEnd, idPrefix, colorEven, colorOdd) => {
                    const x1 = cx + rStart * Math.cos(toRad(startA));
                    const y1 = cy + rStart * Math.sin(toRad(startA));
                    const x2 = cx + rEnd * Math.cos(toRad(startA));
                    const y2 = cy + rEnd * Math.sin(toRad(startA));

                    const x3 = cx + rEnd * Math.cos(toRad(endA));
                    const y3 = cy + rEnd * Math.sin(toRad(endA));
                    const x4 = cx + rStart * Math.cos(toRad(endA));
                    const y4 = cy + rStart * Math.sin(toRad(endA));

                    const id = `${idPrefix}${val}`;
                    const isHigh = highlightIds.includes(id);
                    const fill = isHigh ? '#00e0ff' : (i % 2 === 0 ? colorEven : colorOdd);
                    const stroke = isHigh ? '#00e0ff' : '#1e293b';

                    return `<path d="M${x1},${y1} L${x2},${y2} A${rEnd},${rEnd} 0 0,1 ${x3},${y3} L${x4},${y4} A${rStart},${rStart} 0 0,0 ${x1},${y1} Z" 
                        fill="${fill}" stroke="${stroke}" stroke-width="${isHigh ? 3 : 1}" class="board-segment ${isHigh ? 'highlighted' : ''}" data-val="${val}" data-mult="${idPrefix === 's_d' ? 2 : (idPrefix === 's_t' ? 3 : 1)}" />`;
                };

                // Double Ring
                paths += arc(rDoubleIn, rDoubleOut, 's_d', '#f87171', '#4ade80'); // Red/Green
                // Outer Single
                paths += arc(rTrebleOut, rDoubleIn, 's_so', '#1e293b', '#e2e8f0'); // Black/White
                // Treble Ring
                paths += arc(rTrebleIn, rTrebleOut, 's_t', '#f87171', '#4ade80');
                // Inner Single
                paths += arc(rInner * 2, rTrebleIn, 's_si', '#1e293b', '#e2e8f0'); // Black/White

                // Labels (Numbers)
                const rText = rDoubleOut + 15;
                const tx = cx + rText * Math.cos(toRad(startA + 9));
                const ty = cy + rText * Math.sin(toRad(startA + 9));
                paths += `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="middle" fill="#94a3b8" font-size="12" font-weight="bold">${val}</text>`;
            });

            // Bullseye
            const bullHigh = highlightIds.includes('s_50');
            const outerHigh = highlightIds.includes('s_25');

            // Outer Bull (25)
            paths += `<circle cx="${cx}" cy="${cy}" r="${rInner * 2}" fill="${outerHigh ? '#00e0ff' : '#4ade80'}" stroke="#1e293b" class="board-segment ${outerHigh ? 'highlighted' : ''}" data-val="25" data-mult="1" />`; // Green -> Cyan if high
            // Inner Bull (50)
            paths += `<circle cx="${cx}" cy="${cy}" r="${rInner}" fill="${bullHigh ? '#00e0ff' : '#f87171'}" stroke="#1e293b" class="board-segment ${bullHigh ? 'highlighted' : ''}" data-val="50" data-mult="1" />`; // Red -> Cyan if high

            return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="max-width:100%; height:auto;">
                <circle cx="${cx}" cy="${cy}" r="${cx - 5}" fill="#0f172a" />
                ${paths}
            </svg>`;
        }

        calculateAvg(player) {
            if (player.history.length === 0) return "0.0";
            const total = player.history.reduce((a, b) => a + b, 0);
            return (total / player.history.length).toFixed(1);
        }

        addInput(num) {
            const buffer = document.getElementById('current-input-buffer');
            if (buffer && buffer.textContent.length < 3) {
                buffer.textContent += num;
            }
        }

        backspace() {
            const buffer = document.getElementById('current-input-buffer');
            if (buffer && buffer.textContent.length > 0) {
                buffer.textContent = buffer.textContent.slice(0, -1);
            } else if (this.currentTurnDarts.length > 0) {
                // Remove last dart if buffer is empty
                this.currentTurnDarts.pop();
                this.currentTurnMults.pop();
                this.renderGameUI();
            }
        }

        submitInput() {
            const buffer = document.getElementById('current-input-buffer');

            // If buffer has value, treat it as TOTAL turn score
            if (buffer && buffer.textContent !== '') {
                const val = parseInt(buffer.textContent);
                if (!isNaN(val) && val <= 180) {
                    // Manual entry is ALWAYS total score
                    this.currentTurnDarts = [val];
                    this.currentTurnMults = []; // Clear mults for manual entry (valid by default)
                    this.confirmTurn();
                    buffer.textContent = '';
                }
                return;
            }

            // If buffer empty, try to confirm turn
            if (this.currentTurnDarts.length > 0) {
                this.confirmTurn();
            }
        }

        addDart(val, mult = 1) {
            if (this.currentTurnDarts.length >= 3) return;
            this.currentTurnDarts.push(val * mult);
            this.currentTurnMults.push(mult);
            this.playSound('hit');
            this.renderGameUI();
        }

        confirmTurn() {
            const total = this.currentTurnDarts.reduce((a, b) => a + b, 0);
            const player = this.players[this.activePlayerIndex];

            // Validation for Checkout
            let validCheckout = true;
            let leagueBlockError = false;

            if (player.score - total === 0) {
                // 1. League Block Rule (Team A: 0/2, Team B: 1/3)
                if (this.isLeagueMode && this.players.length === 4) {
                    const pIdx = this.activePlayerIndex;
                    const partnerIdx = (pIdx + 2) % 4;
                    const opp1Idx = (pIdx + 1) % 4;
                    const opp2Idx = (pIdx + 3) % 4;

                    const partnerScore = this.players[partnerIdx].score;
                    const oppSum = this.players[opp1Idx].score + this.players[opp2Idx].score;

                    if (partnerScore >= oppSum) {
                        validCheckout = false;
                        leagueBlockError = true;
                    }
                }

                // 2. Standard Checkout Rules (if not already blocked)
                if (validCheckout) {
                    // Check if manual entry (no mults) OR valid dart mult
                    if (this.currentTurnMults.length > 0) {
                        // Last dart determines finish
                        const lastMult = this.currentTurnMults[this.currentTurnMults.length - 1];
                        if (this.gameMode === 'DO' && lastMult !== 2) validCheckout = false;
                        // MO: Double or Triple allowed
                        if (this.gameMode === 'MO' && lastMult !== 2 && lastMult !== 3) validCheckout = false;
                        // SO is always valid
                    }
                }
            }

            // Bust check (or invalid checkout)
            if (player.score - total < 0 || player.score - total === 1 || (player.score - total === 0 && !validCheckout)) {
                this.playSound('bust');

                if (leagueBlockError) {
                    const pIdx = this.activePlayerIndex;
                    const partner = this.players[(pIdx + 2) % 4];
                    const opp1 = this.players[(pIdx + 1) % 4];
                    const opp2 = this.players[(pIdx + 3) % 4];
                    const oppSum = opp1.score + opp2.score;
                    setTimeout(() => alert(`BLOCK! Partner (${partner.score}) muss weniger Punkte haben als Gegner (${opp1.score}+${opp2.score}=${oppSum})!`), 500);
                } else if (!validCheckout && player.score - total === 0) {
                    setTimeout(() => alert(`Ungültiges Checkout! (${this.gameMode === 'DO' ? 'Muss Double sein' : 'Muss Double oder Triple sein'})`), 500);
                } else {
                    setTimeout(() => alert("Überworfen!"), 500);
                }

                this.currentTurnDarts = [];
                this.currentTurnMults = [];
                this.activePlayerIndex = (this.activePlayerIndex + 1) % this.players.length;
                const nextPlayer = this.players[this.activePlayerIndex];
                if (nextPlayer.score > 0) this.speakScore(nextPlayer.score);
            } else if (player.score - total === 0) {
                // Check!
                player.score = 0;
                player.legs++;
                player.history.push(total);

                setTimeout(() => alert(`${player.name} gewinnt das Leg!`), 500);

                this.players.forEach(p => { p.score = this.startScore; p.history = []; });
                this.currentTurnDarts = [];
                this.currentTurnMults = [];
                this.activePlayerIndex = 0;
                if (this.players[0].score > 0) this.speakScore(this.players[0].score);
            } else {
                player.score -= total;
                player.history.push(total);

                this.currentTurnDarts = [];
                this.currentTurnMults = [];

                // Switch player
                this.activePlayerIndex = (this.activePlayerIndex + 1) % this.players.length;

                // Voice Feedback for NEXT player
                const nextPlayer = this.players[this.activePlayerIndex];
                if (nextPlayer.score > 0) {
                    this.speakScore(nextPlayer.score);
                }
            }

            this.renderGameUI();
        }

        speakScore(score) {
            if (!('speechSynthesis' in window)) return;

            const speak = () => {
                const utterance = new SpeechSynthesisUtterance(score.toString());
                utterance.lang = 'de-DE';
                utterance.rate = 1.1;

                // Try to find German voice, fallback to default
                const voices = window.speechSynthesis.getVoices();
                const deVoice = voices.find(v => v.lang.includes('de'));
                if (deVoice) utterance.voice = deVoice;

                window.speechSynthesis.speak(utterance);
            };

            if (window.speechSynthesis.speaking) {
                window.speechSynthesis.cancel();
            }

            // Retry once if voices are empty (Chrome quirk)
            if (window.speechSynthesis.getVoices().length === 0) {
                const id = setTimeout(speak, 500); // Fallback
                window.speechSynthesis.onvoiceschanged = () => {
                    clearTimeout(id);
                    window.speechSynthesis.onvoiceschanged = null;
                    speak();
                };
            } else {
                speak();
            }
        }


        playSound(type) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;

            if (!this.audioCtx) {
                this.audioCtx = new AudioContext();
            }

            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }

            const ctx = this.audioCtx;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'triangle';
            osc.connect(gain);
            gain.connect(ctx.destination);

            const now = ctx.currentTime;

            if (type === 'hit') {
                osc.frequency.setValueAtTime(300, now);
                osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
                gain.gain.setValueAtTime(0.5, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                osc.start(now);
                osc.stop(now + 0.1);
            } else if (type === 'bust') {
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(100, now);
                osc.frequency.linearRampToValueAtTime(30, now + 0.4);
                gain.gain.setValueAtTime(0.5, now);
                gain.gain.linearRampToValueAtTime(0.01, now + 0.4);
                osc.start(now);
                osc.stop(now + 0.4);
            }
        }
    }

    // Global instance holder
    window.matchScorerInstance = null;
    window.matchScorer = {
        addInput: (n) => window.matchScorerInstance?.addInput(n),
        backspace: () => window.matchScorerInstance?.backspace(),
        submitInput: () => window.matchScorerInstance?.submitInput()
    };

    function renderToolsView() {
        topBarTitle.textContent = "Match Center";
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.className = "fade-in";
        container.style.padding = "10px";
        container.style.maxWidth = "800px";
        container.style.margin = "0 auto";

        contentArea.appendChild(container);

        window.matchScorerInstance = new MatchScorer(container);
        window.matchScorerInstance.renderSetup();
    }

    function renderClubList() {
        topBarTitle.textContent = "Vereinsübersicht";
        contentArea.replaceChildren();

        const container = document.createElement('div');
        container.className = 'club-overview';

        const searchLabel = document.createElement('label');
        searchLabel.className = 'club-search__label';
        searchLabel.htmlFor = 'club-search';
        searchLabel.textContent = 'Verein nach Name oder Ort finden';
        const search = document.createElement('input');
        search.id = 'club-search';
        search.className = 'club-search';
        search.type = 'search';
        search.placeholder = 'Name, Ort oder Adresse';
        search.setAttribute('aria-label', 'Vereine nach Name oder Ort suchen');
        const resultStatus = document.createElement('p');
        resultStatus.className = 'club-search__status';
        resultStatus.setAttribute('aria-live', 'polite');
        const grid = document.createElement('div');
        grid.className = 'club-overview-grid';

        const renderFilteredClubs = () => {
            grid.replaceChildren();
            const filteredClubs = filterClubEntries(clubData.clubs, search.value);
            resultStatus.textContent = `${filteredClubs.length} ${filteredClubs.length === 1 ? 'Verein' : 'Vereine'}`;

            if (filteredClubs.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'club-overview-empty';
                empty.textContent = 'Keine Vereine für diese Suche gefunden.';
                grid.appendChild(empty);
                return;
            }

            filteredClubs.forEach((club) => {
                const index = clubData.clubs.indexOf(club);
                const card = document.createElement('div');
                card.className = 'results-card club-overview-card';
                card.tabIndex = 0;
                card.setAttribute('role', 'button');
                card.setAttribute('aria-label', `${club.name || 'Verein'} öffnen`);

                const name = document.createElement('strong');
                name.className = 'club-overview-card__name';
                name.textContent = club.name || 'Verein ohne Namen';
                card.appendChild(name);
                if (club.venue) {
                    const venue = document.createElement('span');
                    venue.className = 'club-overview-card__venue';
                    venue.textContent = `📍 ${club.venue}`;
                    card.appendChild(venue);
                }
                if (club.city || club.street) {
                    const locality = document.createElement('span');
                    locality.className = 'club-overview-card__locality';
                    locality.textContent = [club.street, club.city].filter(Boolean).join(' · ');
                    card.appendChild(locality);
                }

                const selectClub = () => navigateTo('club', index);
                card.addEventListener('click', selectClub);
                card.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectClub();
                    }
                });
                grid.appendChild(card);
            });
        };

        search.addEventListener('input', renderFilteredClubs);
        container.append(searchLabel, search, resultStatus, grid);
        renderFilteredClubs();
        contentArea.appendChild(container);
    }


    // --- Ligapokal Archive Renderer ---
    // Renders historical Ligapokal seasons using the same layout
    // as the current season (tabs: Tabelle / Spielergebnisse).
    // Data is read from ligapokalArchive (loaded from ligapokal_archive.js).
    function renderLigapokalArchive(seasonName) {
        const data = ligapokalArchive[seasonName];
        if (!data) {
            contentArea.innerHTML = '<p class="text-secondary">Keine Daten für diese Saison verfügbar.</p>';
            topBarTitle.textContent = seasonName;
            return;
        }

        topBarTitle.innerHTML = "";
        const span = document.createElement('span');
        span.textContent = seasonName;
        topBarTitle.appendChild(span);

        // Favorite button for archive seasons
        const favBtn = document.createElement('button');
        favBtn.id = "fav-btn";
        favBtn.style.background = "none";
        favBtn.style.border = "none";
        favBtn.style.cursor = "pointer";
        favBtn.style.fontSize = "1.2rem";
        favBtn.style.marginLeft = "10px";
        updateFavBtnState(favBtn, 'ligapokalArchive', seasonName);
        favBtn.onclick = (e) => {
            e.stopPropagation();
            toggleFavorite('ligapokalArchive', seasonName, seasonName);
        };
        topBarTitle.appendChild(favBtn);

        contentArea.innerHTML = '';
        const clone = template.content.cloneNode(true);
        contentArea.appendChild(clone);

        // Ligapokal archive: hide tabs, show only results directly
        const tabsBar = contentArea.querySelector('.tabs');
        if (tabsBar) tabsBar.style.display = 'none';
        const tabTable = document.getElementById('tab-table');
        if (tabTable) tabTable.style.display = 'none';
        const tabResults = document.getElementById('tab-results');
        if (tabResults) {
            tabResults.classList.add('active');
            tabResults.style.display = 'block';
        }

        // Helper: find club index for clickable team links
        const normalizeClubName = (str) => {
            return str.toLowerCase()
                .replace(/[.'`´]/g, '')
                .replace(/\s+/g, ' ')
                .replace(/\s+e\s?v/gi, '')
                .trim();
        };

        const findClubIndex = (name) => {
            if (typeof CLUB_DATA === 'undefined' || !CLUB_DATA.clubs) return -1;
            const normText = normalizeClubName(name);
            let idx = CLUB_DATA.clubs.findIndex(c => normalizeClubName(c.name) === normText);
            if (idx === -1) {
                const match = normText.match(/^(.*?)\s+\d+$/);
                if (match) {
                    idx = CLUB_DATA.clubs.findIndex(c => normalizeClubName(c.name) === match[1]);
                }
            }
            return idx;
        };

        // --- Render results using the pre-formatted HTML table ---
        const resultsContainer = document.getElementById('league-results-container');
        if (data.table) {
            replaceWithSafeCupTables(resultsContainer, data.table, data.match_days);
            cleanTable(resultsContainer);
            // Make team names clickable
            if (typeof CLUB_DATA !== 'undefined' && CLUB_DATA.clubs) {
                const tds = resultsContainer.querySelectorAll('td');
                tds.forEach(td => {
                    const rawText = td.textContent.trim().replace(/\u00A0/g, ' ');
                    const index = findClubIndex(rawText);
                    if (index !== -1) {
                        td.textContent = '';
                        const span = document.createElement('span');
                        span.textContent = rawText;
                        span.style.cursor = 'pointer';
                        span.style.color = '#60a5fa';
                        span.style.fontWeight = '500';
                        span.onclick = () => navigateTo('club', index);
                        span.onmouseenter = () => span.style.textDecoration = 'underline';
                        span.onmouseleave = () => span.style.textDecoration = 'none';
                        td.appendChild(span);
                    }
                });
            }
        } else if (Array.isArray(data.tables) && data.tables.length > 0) {
            data.tables.forEach((archiveTable, tableIndex) => {
                const rows = Array.isArray(archiveTable.rows) ? archiveTable.rows : [];
                if (rows.length === 0) return;
                const heading = document.createElement('h3');
                const firstDataCell = rows[1] && rows[1][0] ? String(rows[1][0]).trim() : '';
                heading.textContent = firstDataCell || `Runde ${tableIndex + 1}`;
                resultsContainer.appendChild(heading);

                const tableElement = document.createElement('table');
                const tableBody = document.createElement('tbody');
                rows.forEach((row, rowIndex) => {
                    const tableRow = document.createElement('tr');
                    row.forEach((cell) => {
                        const cellElement = document.createElement(rowIndex === 0 ? 'th' : 'td');
                        cellElement.textContent = String(cell == null ? '' : cell);
                        tableRow.appendChild(cellElement);
                    });
                    tableBody.appendChild(tableRow);
                });
                tableElement.appendChild(tableBody);
                resultsContainer.appendChild(createScrollableTableRegion(tableElement));
            });
            cleanTable(resultsContainer);
        } else {
            resultsContainer.innerHTML = '<p class="text-secondary">Keine Ergebnisse verfügbar.</p>';
        }
    }


    function renderLeague(leagueName) {
        const data = leagueData.leagues[leagueName];
        if (!data) {
            favorites = favorites.filter((favorite) => !(
                favorite.type === 'league' && String(favorite.id) === String(leagueName)
            ));
            saveFavorites();
            topBarTitle.textContent = leagueName || 'Liga nicht verfügbar';
            contentArea.innerHTML = '<p class="text-secondary">Diese Liga ist im aktuellen Datenstand nicht mehr verfügbar.</p>';
            setAppStatus('Der veraltete Favorit wurde entfernt.');
            return;
        }
        topBarTitle.innerHTML = "";
        const span = document.createElement('span');
        span.textContent = leagueName;
        topBarTitle.appendChild(span);

        const favBtn = document.createElement('button');
        favBtn.id = "fav-btn";
        favBtn.style.background = "none";
        favBtn.style.border = "none";
        favBtn.style.cursor = "pointer";
        favBtn.style.fontSize = "1.2rem";
        favBtn.style.marginLeft = "10px";
        updateFavBtnState(favBtn, 'league', leagueName);
        favBtn.onclick = (e) => {
            e.stopPropagation();
            toggleFavorite('league', leagueName, leagueName);
        };
        topBarTitle.appendChild(favBtn);

        contentArea.innerHTML = '';
        const clone = template.content.cloneNode(true);
        contentArea.appendChild(clone);

        // Detect Ligapokal league
        const isLigapokal = leagueName.toLowerCase().includes('ligapokal');

        if (isLigapokal) {
            // Ligapokal: hide tabs, show only results directly
            const tabsBar = contentArea.querySelector('.tabs');
            if (tabsBar) tabsBar.style.display = 'none';
            const tabTable = document.getElementById('tab-table');
            if (tabTable) tabTable.style.display = 'none';
            const tabResults = document.getElementById('tab-results');
            if (tabResults) {
                tabResults.classList.add('active');
                tabResults.style.display = 'block';
            }
        } else {
            // Normal leagues: use standard two-tab layout
            setupTabs(true);
        }

        const normalizeClubName = (str) => {
            return str.toLowerCase()
                .replace(/[.'`´]/g, '')
                .replace(/\s+/g, ' ')
                .replace(/\s+e\s?v/gi, '')
                .trim();
        };

        const findClubIndex = (name) => {
            if (typeof CLUB_DATA === 'undefined' || !CLUB_DATA.clubs) return -1;
            const normText = normalizeClubName(name);
            let idx = CLUB_DATA.clubs.findIndex(c => normalizeClubName(c.name) === normText);
            if (idx === -1) {
                const match = normText.match(/^(.*?)\s+\d+$/);
                if (match) {
                    idx = CLUB_DATA.clubs.findIndex(c => normalizeClubName(c.name) === match[1]);
                }
            }
            return idx;
        };

        // Helper to make team names clickable in table cells
        const makeTeamsClickable = (container) => {
            if (typeof CLUB_DATA !== 'undefined' && CLUB_DATA.clubs) {
                const tds = container.querySelectorAll('td');
                tds.forEach(td => {
                    const rawText = td.textContent.trim().replace(/\u00A0/g, ' ');
                    const index = findClubIndex(rawText);
                    if (index !== -1) {
                        td.textContent = '';
                        const span = document.createElement('span');
                        span.textContent = rawText;
                        span.style.cursor = 'pointer';
                        span.style.color = '#60a5fa';
                        span.style.fontWeight = '500';
                        span.onclick = () => navigateTo('club', index);
                        span.onmouseenter = () => span.style.textDecoration = 'underline';
                        span.onmouseleave = () => span.style.textDecoration = 'none';
                        td.appendChild(span);
                    }
                });
            }
        };

        if (isLigapokal) {
            // Ligapokal: render table HTML directly into results container
            const resultsContainer = document.getElementById('league-results-container');
            if (data.table) {
                replaceWithSafeCupTables(resultsContainer, data.table, data.match_days);
                cleanTable(resultsContainer);
                makeTeamsClickable(resultsContainer);
            } else {
                resultsContainer.innerHTML = '<p class="text-secondary">Keine Ergebnisse verfügbar.</p>';
            }
        } else {
            // Standard leagues: render table tab
            const tableContainer = document.getElementById('league-table-container');
            if (data.table) {
                replaceWithSafeTables(tableContainer, data.table);
                cleanTable(tableContainer);
                makeTeamsClickable(tableContainer);
            } else {
                tableContainer.innerHTML = '<p class="text-secondary">Keine Tabelle verfügbar.</p>';
            }

            // Standard leagues: render results tab (match-card layout)
            const resultsContainer = document.getElementById('league-results-container');
            const matchDays = Object.keys(data.match_days).sort((a, b) => {
                const numA = parseInt(a);
                const numB = parseInt(b);
                if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
                return a.localeCompare(b);
            });

            if (matchDays.length > 0) {
                matchDays.forEach(day => {
                    const group = document.createElement('div');
                    group.className = 'results-group';

                    const title = document.createElement('h3');
                    title.textContent = day;
                    title.style.borderBottom = "1px solid #334155";
                    title.style.paddingBottom = "8px";
                    title.style.marginBottom = "12px";
                    group.appendChild(title);

                    const rawText = data.match_days[day] || "";
                    if (rawText && rawText !== "Keine Ergebnisse.") {
                        const lines = rawText.split('\n');
                        lines.forEach(line => {
                            line = line.trim();
                            if (!line) return;

                            let result = "---";
                            let mainPart = line;
                            const resMatch = line.match(/\s+(\d+:\d+|---|:)\s*$/);
                            if (resMatch) {
                                result = resMatch[1];
                                mainPart = line.substring(0, resMatch.index).trim();
                            }

                            const dateMatch = mainPart.match(/^.*?\d{4}(\s+\d{2}:\d{2})?/);
                            let dateStr = "";
                            let teamsPart = mainPart;
                            if (dateMatch) {
                                dateStr = dateMatch[0];
                                teamsPart = mainPart.substring(dateStr.length).trim();
                            }

                            const separatorMatch = teamsPart.match(/\s+-\s+/);
                            let homeName = teamsPart;
                            let guestName = "";

                            if (separatorMatch) {
                                homeName = teamsPart.substring(0, separatorMatch.index).trim();
                                guestName = teamsPart.substring(separatorMatch.index + separatorMatch[0].length).trim();
                            }

                            const createClubSpan = (name) => {
                                const idx = findClubIndex(name);
                                const span = document.createElement('span');
                                span.textContent = name;
                                if (idx !== -1) {
                                    span.style.cursor = 'pointer';
                                    span.style.color = '#60a5fa';
                                    span.style.fontWeight = '500';
                                    span.onclick = () => navigateTo('club', idx);
                                    span.onmouseenter = () => span.style.textDecoration = 'underline';
                                    span.onmouseleave = () => span.style.textDecoration = 'none';
                                } else {
                                    span.style.color = '#e2e8f0';
                                }
                                return span;
                            };

                            const matchCard = document.createElement('div');
                            matchCard.className = 'match-card';
                            matchCard.style.background = "#1e293b";
                            matchCard.style.marginBottom = "8px";
                            matchCard.style.padding = "10px";
                            matchCard.style.borderRadius = "6px";
                            matchCard.style.border = "1px solid #334155";
                            matchCard.style.display = "flex";
                            matchCard.style.justifyContent = "space-between";
                            matchCard.style.alignItems = "center";
                            matchCard.style.flexWrap = "wrap";
                            matchCard.style.gap = "10px";

                            const dateDiv = document.createElement('div');
                            dateDiv.textContent = dateStr;
                            dateDiv.style.color = "#94a3b8";
                            dateDiv.style.fontSize = "0.85em";
                            dateDiv.style.width = "140px";

                            const teamsDiv = document.createElement('div');
                            teamsDiv.style.flex = "1";
                            teamsDiv.style.display = "flex";
                            teamsDiv.style.justifyContent = "center";
                            teamsDiv.style.gap = "8px";
                            teamsDiv.style.color = "#e2e8f0";
                            teamsDiv.appendChild(createClubSpan(homeName));

                            const vsSpan = document.createElement('span');
                            vsSpan.textContent = "-";
                            vsSpan.style.color = "#64748b";
                            teamsDiv.appendChild(vsSpan);
                            teamsDiv.appendChild(createClubSpan(guestName));

                            const resDiv = document.createElement('div');
                            resDiv.textContent = result;
                            resDiv.style.fontWeight = "bold";
                            resDiv.style.color = "#f8fafc";
                            resDiv.style.minWidth = "40px";
                            resDiv.style.textAlign = "right";

                            matchCard.appendChild(dateDiv);
                            matchCard.appendChild(teamsDiv);
                            matchCard.appendChild(resDiv);
                            group.appendChild(matchCard);
                        });
                    } else {
                        const empty = document.createElement('div');
                        empty.textContent = rawText || "Keine Ergebnisse.";
                        empty.className = 'results-card';
                    }
                    resultsContainer.appendChild(group);
                });
            } else {
                resultsContainer.innerHTML = '<p class="text-secondary">Keine Ergebnisse verfügbar.</p>';
            }
        }
    }

    function setupTabs(forceFirst = false) {
        // Scope to contentArea to prevent finding unrelated elements (if any)
        const tabs = contentArea.querySelectorAll('.tab-btn');
        const contents = contentArea.querySelectorAll('.tab-content');


        tabs.forEach(tab => {
            // Remove old listeners by cloning (simple way) or just adding new ones logic is fine if DOM is fresh
            tab.onclick = () => { // Use onclick property to ensure single listener
                const tabId = tab.dataset.tab;

                // Deactivate all
                tabs.forEach(t => t.classList.remove('active'));
                contents.forEach(c => c.classList.remove('active'));

                // Activate clicked
                tab.classList.add('active');

                const targetId = `tab-${tabId}`;
                const target = contentArea.querySelector(`#${targetId}`);
                if (target) {
                    target.classList.add('active');
                } else {
                    console.error(`Target content not found: ${targetId}`);
                }
            };
        });

        if (forceFirst && tabs.length > 0) {
            tabs[0].click();
        }
    }

    function calculateTotalPoints(p) {
        let sum = 0;
        let count = 0;
        let dCount = 0;
        if (!p.rounds) return 0;

        for (let i = 1; i <= 18; i++) {
            const val = String(p.rounds[`R${i}`] || "");
            if (val.toLowerCase() === 'd') {
                dCount++;
            } else {
                const num = parseInt(val);
                if (!isNaN(num)) {
                    sum += num;
                    count++;
                }
            }
        }

        const avg = count > 0 ? (sum / count) : 0;
        return sum + (avg * dCount);
    }

    function renderRanking(rankName) {
        topBarTitle.textContent = rankName;
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.style.padding = '20px';
        container.className = 'fade-in';
        const rankingSeasonNotice = createSeasonNotice('ranking');
        const players = rankingData && Array.isArray(rankingData.players)
            ? rankingData.players.filter((player) => player.league === rankName)
            : [];

        if (players.length === 0) {
            if (rankingData && rankingData.rankings && rankingData.rankings[rankName]) {
                const fallback = document.createElement('div');
                fallback.className = 'ranking-table-scroll table-scroll';
                fallback.appendChild(createSafeTableFromHtml(rankingData.rankings[rankName]));
                container.appendChild(fallback);
            } else {
                const empty = document.createElement('div');
                empty.style.color = '#94a3b8';
                empty.textContent = 'Keine Daten verfügbar.';
                container.appendChild(empty);
            }
            if (rankingSeasonNotice) container.insertBefore(rankingSeasonNotice, container.firstChild);
            contentArea.appendChild(container);
            return;
        }

        const enrichedPlayers = window.BwedlAppUtils.enrichRankingPlayersWithClubs(
            players,
            clubData && clubData.clubs,
        );
        const viewModels = enrichedPlayers.map((player, sourceIndex) => {
            const stats = calculatePlayerStats(player);
            const officialRank = String(player.rank == null ? '' : player.rank).trim();
            const rankPrefix = officialRank.match(/^\d+/);
            return {
                ...player,
                officialRank,
                officialSortRank: rankPrefix ? Number(rankPrefix[0]) : sourceIndex + 1,
                totalPoints: calculateTotalPoints(player),
                average: stats.avg,
                games: stats.count,
            };
        });
        const exactSavedPlayer = viewModels.find((player) => isMyPlayerRecord(player)) || null;
        const savedPlayerMatch = exactSavedPlayer
            ? { status: 'found', player: exactSavedPlayer }
            : { status: 'missing', player: null };

        const toolbar = document.createElement('div');
        toolbar.className = 'ranking-toolbar';
        const createControl = (labelText, control) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'ranking-toolbar__control';
            const label = document.createElement('label');
            label.setAttribute('for', control.id);
            label.textContent = labelText;
            wrapper.append(label, control);
            return wrapper;
        };

        const search = document.createElement('input');
        search.id = 'ranking-player-search';
        search.type = 'search';
        search.placeholder = 'Name oder Verein';
        search.setAttribute('autocomplete', 'off');
        toolbar.appendChild(createControl('Spieler suchen', search));

        const sort = document.createElement('select');
        sort.id = 'ranking-sort';
        [
            ['official', 'Offizielle Reihenfolge'],
            ['points', 'Analyseansicht: Punkte'],
            ['average', 'Analyseansicht: Durchschnitt'],
            ['games', 'Analyseansicht: Spiele'],
        ].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            sort.appendChild(option);
        });
        sort.value = 'official';
        toolbar.appendChild(createControl('Sortierung', sort));

        const minGames = document.createElement('input');
        minGames.id = 'ranking-min-games';
        minGames.type = 'number';
        minGames.min = '0';
        minGames.step = '1';
        minGames.value = '0';
        toolbar.appendChild(createControl('Mindestens Spiele', minGames));

        const actions = document.createElement('div');
        actions.className = 'ranking-toolbar__actions';
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'ranking-toolbar__button';
        reset.textContent = 'Zurücksetzen';
        actions.appendChild(reset);

        let myPosition = null;
        if (myPlayerProfile) {
            myPosition = document.createElement('button');
            myPosition.id = 'ranking-my-position';
            myPosition.type = 'button';
            myPosition.className = 'ranking-toolbar__button ranking-toolbar__button--primary';
            myPosition.textContent = 'Meine Position';
            actions.appendChild(myPosition);
        }
        toolbar.appendChild(actions);

        const analysisLabel = document.createElement('p');
        analysisLabel.className = 'ranking-analysis-label';
        analysisLabel.textContent = 'Analyseansicht – die angezeigten Rangwerte bleiben offiziell.';
        analysisLabel.hidden = true;

        const status = document.createElement('p');
        status.id = 'ranking-tools-status';
        status.className = 'ranking-tools-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');

        const tableCard = document.createElement('div');
        tableCard.className = 'ranking-table-card';
        const tableScroller = document.createElement('div');
        tableScroller.className = 'ranking-table-scroll table-scroll';
        const table = document.createElement('table');
        table.className = 'ranking-table';
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        ['#', 'Name', 'Verein', 'Spiele', 'Ø', 'Punkte'].forEach((label) => {
            const header = document.createElement('th');
            header.setAttribute('scope', 'col');
            header.textContent = label;
            headerRow.appendChild(header);
        });
        thead.appendChild(headerRow);
        const tbody = document.createElement('tbody');
        table.append(thead, tbody);
        tableScroller.appendChild(table);
        tableCard.appendChild(tableScroller);

        const createRow = (player) => {
            const row = document.createElement('tr');
            row.dataset.playerName = String(player.name || '');
            row.setAttribute('tabindex', '-1');
            row._rankingPlayer = player;
            if (savedPlayerMatch.status === 'found' && player === savedPlayerMatch.player) {
                row.classList.add('my-player-row');
            }

            const rankCell = document.createElement('td');
            const officialRank = String(player.officialRank || '').trim();
            rankCell.textContent = officialRank || '–';
            rankCell.className = 'ranking-table__rank';
            const nameCell = document.createElement('td');
            nameCell.textContent = String(player.name || '');
            if (player.team) {
                const team = document.createElement('span');
                team.className = 'ranking-table__team';
                team.textContent = String(player.team);
                nameCell.appendChild(team);
            }

            const clubIndex = Number.isInteger(player.clubIndex) ? player.clubIndex : -1;
            const clubName = player.clubName || player.company;
            const clubCell = document.createElement('td');
            if (clubIndex !== -1) {
                const clubLink = document.createElement('button');
                clubLink.type = 'button';
                clubLink.className = 'ranking-table__club-link';
                clubLink.textContent = String(clubName || 'Unbekannt');
                clubLink.addEventListener('click', () => navigateTo('club', clubIndex));
                clubCell.appendChild(clubLink);
            } else {
                clubCell.textContent = String(clubName || 'Unbekannt');
            }

            const gamesCell = document.createElement('td');
            gamesCell.textContent = String(player.games);
            const averageCell = document.createElement('td');
            averageCell.textContent = Number(player.average).toFixed(2);
            const pointsCell = document.createElement('td');
            pointsCell.textContent = String(Number.parseFloat(Number(player.totalPoints).toFixed(2)));
            row.append(rankCell, nameCell, clubCell, gamesCell, averageCell, pointsCell);
            return row;
        };

        const renderRows = () => {
            const visible = window.BwedlAppUtils.filterAndSortRanking(viewModels, {
                query: search.value,
                sort: sort.value,
                minGames: minGames.value,
            });
            tbody.replaceChildren(...visible.map(createRow));
            analysisLabel.hidden = sort.value === 'official';
            status.textContent = `${visible.length} von ${viewModels.length} Spielern angezeigt.`;
        };

        search.addEventListener('input', renderRows);
        sort.addEventListener('change', renderRows);
        minGames.addEventListener('input', renderRows);
        reset.addEventListener('click', () => {
            search.value = '';
            sort.value = 'official';
            minGames.value = '0';
            renderRows();
            search.focus();
        });
        if (myPosition) {
            myPosition.addEventListener('click', () => {
                if (savedPlayerMatch.status !== 'found') {
                    status.textContent = 'Dein gespeicherter Spieler ist nicht in dieser Rangliste enthalten.';
                    return;
                }
                search.value = '';
                minGames.value = '0';
                renderRows();
                const row = Array.from(tbody.children).find((candidate) => (
                    candidate._rankingPlayer === savedPlayerMatch.player
                ));
                if (!row) return;
                const reducedMotion = Boolean(window.matchMedia &&
                    window.matchMedia('(prefers-reduced-motion: reduce)').matches);
                row.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
                row.focus();
                status.textContent = `Position von ${savedPlayerMatch.player.name} hervorgehoben.`;
            });
        }

        const calculationNote = document.createElement('p');
        calculationNote.className = 'ranking-calculation-note';
        calculationNote.textContent = "* 'D' wertet als Durchschnitt der gespielten Spiele (Spielfrei-Ausgleich).";

        if (rankingSeasonNotice) container.appendChild(rankingSeasonNotice);
        container.append(toolbar, analysisLabel, status, tableCard, calculationNote);
        renderRows();
        contentArea.appendChild(container);
    }

    function renderSparkline(rounds) {
        if (!rounds) return "";
        const data = [];
        for (let i = 1; i <= 18; i++) {
            const val = parseInt(rounds[`R${i}`]);
            if (!isNaN(val)) data.push(val);
        }
        if (data.length < 2) return "";

        const width = 60;
        const height = 25;
        const max = Math.max(...data);
        const min = Math.min(...data);
        const range = max - min || 1;

        let points = "";
        data.forEach((val, idx) => {
            const x = (idx / (data.length - 1)) * width;
            const y = height - ((val - min) / range) * height; // Invert Y
            points += `${x},${y} `;
        });

        return `<svg width="${width}" height="${height}" style="margin-left: 10px; opacity: 0.8; overflow: visible;">
            <polyline points="${points}" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
    }

    function renderClub(index) {
        const club = clubData.clubs[index];
        topBarTitle.innerHTML = "";
        const span = document.createElement('span');
        span.textContent = club.name;
        topBarTitle.appendChild(span);

        // --- Helper: Tier Colors & Labels ---
        const leagueTierColor = (league) => {
            if (!league) return '#94a3b8';
            if (league.includes('Bezirksliga')) return '#a855f7'; // Purple
            if (league.includes('A-Klasse')) return '#ef4444';    // Red
            if (league.includes('B-Klasse')) return '#f59e0b';    // Amber
            if (league.includes('C-Klasse')) return '#3b82f6';    // Blue
            return '#94a3b8';
        };

        const leagueTierLabel = (league) => {
            if (!league) return '';
            if (league.includes('Bezirksliga')) return 'BZ';
            if (league.includes('A-Klasse')) return 'A';
            if (league.includes('B-Klasse')) return 'B';
            if (league.includes('C-Klasse')) return 'C';
            return '';
        };

        const favBtn = document.createElement('button');
        favBtn.id = "fav-btn";
        favBtn.style.background = "none";
        favBtn.style.border = "none";
        favBtn.style.cursor = "pointer";
        favBtn.style.fontSize = "1.2rem";
        favBtn.style.marginLeft = "10px";
        updateFavBtnState(favBtn, 'club', index);
        favBtn.onclick = (e) => {
            e.stopPropagation();
            toggleFavorite('club', index, club.name);
        };
        topBarTitle.appendChild(favBtn);
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.classList.add('fade-in');
        container.style.padding = "20px";
        container.style.maxWidth = "800px";
        container.style.margin = "0 auto";

        function createDisclosureSection(title, contentId, content, expanded = false) {
            const section = document.createElement('section');
            section.className = 'club-disclosure';
            const heading = document.createElement('h2');
            heading.className = 'club-disclosure__heading';
            const button = createDisclosureButton(title, contentId, content, expanded);
            button.className = 'club-disclosure__trigger';
            content.classList.add('club-disclosure__content');
            heading.appendChild(button);
            section.append(heading, content);
            return section;
        }

        function archiveMatchDisplayState(match, isCupSection) {
            if (match && match.isFreilos) return { incomplete: false, label: 'Freilos' };
            const incomplete = Boolean(isCupSection) && (
                !String(match && match.home || '').trim() ||
                !String(match && match.away || '').trim() ||
                !String(match && match.scoreHome || '').trim() ||
                !String(match && match.scoreAway || '').trim()
            );
            return {
                incomplete,
                label: incomplete
                    ? 'Daten unvollständig'
                    : `${match && match.scoreHome || ''}:${match && match.scoreAway || ''}`,
            };
        }

        function createArchiveMatchResult(match, isCupSection) {
            const state = archiveMatchDisplayState(match, isCupSection);
            const result = document.createElement('span');
            result.textContent = state.label;
            if (state.incomplete) {
                result.className = 'incomplete-data';
                result.setAttribute('role', 'status');
            } else if (match && match.isFreilos) {
                result.className = 'archive-freilos';
            }
            return result;
        }

        function parseArchiveMatchRow(headers, row) {
            const normalizedHeaders = Array.isArray(headers)
                ? headers.map((header) => String(header || '').toLowerCase().trim())
                : [];
            const findColumn = (pattern) => normalizedHeaders.findIndex((header) => pattern.test(header));
            const dateIndex = findColumn(/datum/);
            const homeIndex = findColumn(/heim/);
            const awayIndex = findColumn(/gast/);
            const resultIndex = findColumn(/ergebnis|punkte/);
            const cell = (index) => index >= 0 ? String(row && row[index] || '').trim() : '';

            if ([dateIndex, homeIndex, awayIndex, resultIndex].every((index) => index >= 0)) {
                return {
                    dateStr: cell(dateIndex),
                    home: cell(homeIndex),
                    away: cell(awayIndex),
                    result: cell(resultIndex),
                };
            }

            if (Array.isArray(row) && row.length >= 6 && /^\d{2}\.\d{2}\.\d{4}/.test(cell(1))) {
                return { dateStr: cell(1), home: cell(3), away: cell(4), result: cell(5) };
            }
            return { dateStr: cell(0), home: cell(1), away: cell(2), result: cell(3) };
        }

        const stripTeamNumber = (name) => {
            if (!name) return "";
            let clean = name.replace(/\u00A0/g, ' ').trim();
            clean = clean.replace(/\s+(Team|Mannschaft)\s+\d+$/i, '');
            clean = clean.replace(/\s+(I|II|III|IV|V)\.?$/i, '');
            clean = clean.replace(/\s+([1-9]|1[0-9])\.?$/, '');
            return clean.trim();
        };

        const isClubMatch = (clubName, targetName) => {
            if (!targetName) return false;
            const rawTarget = targetName.replace(/\u00A0/g, ' ').trim();
            if (/^\d+([:.]\d+)?$/.test(rawTarget)) return false;
            if (rawTarget.length < 3) return false;
            const baseC = stripTeamNumber(clubName).toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
            const baseT = stripTeamNumber(targetName).toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
            if (!baseC || !baseT) return false;
            if (baseT.length < 3) return false;
            if (baseC === baseT) return true;
            if (baseC.length >= 6 && baseT.includes(baseC)) return true;
            if (baseT.length >= 8 && baseC.includes(baseT)) return true;
            return false;
        };

        const isLigapokalMatch = (leagueName) => {
            if (!leagueName) return false;
            const normalized = leagueName.toLowerCase();
            return normalized.includes('ligapokal');
        };

        const parseLigapokalArchive = (seasonName, matchDaysObj, clubName, resultsList, isCup = false) => {
            if (!matchDaysObj) return;
            for (const [roundName, content] of Object.entries(matchDaysObj)) {
                if (!content) continue;
                const lines = content.split(/\\n|\n/);
                lines.forEach(line => {
                    // Reverted back to .+? for teams to avoid missing German/complex names, keep lenient scores
                    const match = line.match(/(\d{2}\.\d{2}\.\d{4}(?:\s+\d{2}:\d{2})?)\s+(.+?)\s+-\s+(.+?)\s+(\d+\s*[:]\s*\d+)/);
                    if (match) {
                        const [_, dateStr, home, away, score] = match;
                        if (isClubMatch(clubName, home) || isClubMatch(clubName, away)) {
                            const scoreParts = score.split(':').map(s => s.trim());
                            resultsList.push({
                                season: seasonName,
                                league: roundName,
                                home: home.trim(),
                                away: away.trim(),
                                scoreHome: scoreParts[0],
                                scoreAway: scoreParts[1],
                                dateStr: dateStr.trim(),
                                played: true,
                                isCup: isCup,
                                ts: (function() {
                                    const d = dateStr.trim().split('.');
                                    if (d.length >= 3) return new Date(d[2].substring(0,4), d[1]-1, d[0]).getTime();
                                    return 0;
                                })()
                            });
                        }
                    }
                });
            }
        };

        // --- 1. GATHER DATA ---

        // A) Players
        let clubPlayers = [];
        if (typeof RANKING_DATA !== 'undefined' && RANKING_DATA.players && club.number) {
            clubPlayers = RANKING_DATA.players.filter(p => p.v_nr === club.number);
            const getLeagueWeight = (l) => {
                if (!l) return 0;
                l = l.toLowerCase();
                if (l.includes("bezirk")) return 4;
                if (l.includes("a-klasse")) return 3;
                if (l.includes("b-klasse")) return 2;
                if (l.includes("c-klasse")) return 1;
                return 0;
            };
            clubPlayers.sort((a, b) => {
                const wA = getLeagueWeight(a.league);
                const wB = getLeagueWeight(b.league);
                if (wA !== wB) return wB - wA;
                const rA = parseInt(a.rank) || 999;
                const rB = parseInt(b.rank) || 999;
                return rA - rB;
            });
        }

        // B) Matches (Current Season)
        let upcomingLeagueMatches = [];
        let recentLeagueMatches = [];
        let upcomingLigapokalMatches = [];
        let recentLigapokalMatches = [];

        if (typeof leagueData !== 'undefined' && leagueData.leagues) {
            Object.keys(leagueData.leagues).forEach(leagueName => {
                const isLP = isLigapokalMatch(leagueName);
                const league = leagueData.leagues[leagueName];
                const withdrawnTeams = league && typeof league.table === 'string'
                    ? findWithdrawnTeams(league.table)
                    : [];
                const matches = parseAllMatches(leagueName);
                matches.forEach(m => {
                    if (!m.played && (withdrawnTeams.includes(m.home) || withdrawnTeams.includes(m.away))) return;
                    if (isClubMatch(club.name, m.home) || isClubMatch(club.name, m.away)) {
                        let ts = 0;
                        if (m.dateStr) {
                            const dateObj = parseGermanDate(m.dateStr);
                            if (dateObj) ts = dateObj.getTime();
                        }
                        const matchObj = { ...m, leagueName, ts };
                        if (m.played) {
                            if (isLP) recentLigapokalMatches.push(matchObj);
                            else recentLeagueMatches.push(matchObj);
                        } else {
                            if (isLP) upcomingLigapokalMatches.push(matchObj);
                            else upcomingLeagueMatches.push(matchObj);
                        }
                    }
                });
            });
        }

        recentLeagueMatches.sort((a, b) => b.ts - a.ts);
        recentLigapokalMatches.sort((a, b) => b.ts - a.ts);

        const nextGames = window.BwedlAppUtils.selectUpcomingGames(upcomingLeagueMatches, new Date());
        const lastGames = recentLeagueMatches.slice(0, 30);
        const nextLigapokalGames = window.BwedlAppUtils.selectUpcomingGames(upcomingLigapokalMatches, new Date());
        const lastLigapokalGames = recentLigapokalMatches.slice(0, 30);

        // C) Current League Tables
        const currentTables = [];
        if (typeof leagueData !== 'undefined' && leagueData.leagues) {
            Object.keys(leagueData.leagues).forEach(leagueName => {
                const league = leagueData.leagues[leagueName];
                if (league && league.table && !isLigapokalMatch(leagueName)) {
                    if (league.table.toLowerCase().includes(club.name.toLowerCase()) || 
                        league.table.toLowerCase().includes(stripTeamNumber(club.name).toLowerCase())) {
                        currentTables.push({ leagueName, tableHtml: league.table });
                    }
                }
            });
        }

        // --- 2. RENDER UI ---

        const totalPoints = clubPlayers.reduce((acc, p) => acc + (parseInt(p.points) || 0), 0);
        const activeLeagues = [...new Set(clubPlayers.map(p => p.league))].filter(l => l && l !== "Unbekannt").length;

        const detailsContent = document.createElement('div');
        const detailsGrid = document.createElement('div');
        detailsGrid.className = 'club-contact-grid';
        const fields = [
            { k: 'venue', l: 'Spiellokal', i: '🏠' }, { k: 'street', l: 'Adresse', i: '📍' }, { k: 'city', l: 'Ort', i: '🏙️' },
            { k: 'website', l: 'Webseite', i: '🌐', link: true }, { k: 'email', l: 'E-Mail', i: '✉️', mail: true },
            { k: 'contact', l: 'Kontaktperson', i: '👤' }, { k: 'mobile', l: 'Mobil', i: '📱' },
        ];
        fields.forEach(f => {
            const value = club[f.k];
            if (!value || value === 'null' || value === '-') return;
            const field = document.createElement('div');
            const label = document.createElement('div');
            label.className = 'club-contact-field__label';
            label.textContent = `${f.i} ${f.l}`;
            const valueElement = document.createElement(f.link || f.mail ? 'a' : 'div');
            valueElement.className = 'club-contact-field__value';
            valueElement.textContent = value;
            if (f.link) {
                valueElement.href = value.startsWith('http') ? value : `http://${value}`;
                valueElement.target = '_blank';
                valueElement.rel = 'noopener noreferrer';
            } else if (f.mail) {
                valueElement.href = `mailto:${value}`;
            }
            field.append(label, valueElement);
            detailsGrid.appendChild(field);
        });
        if ((club.street && club.street !== '-') || (club.city && club.city !== '-')) {
            const q = `${club.street || ''} ${club.city || ''}`;
            const mapLink = document.createElement('a');
            mapLink.className = 'club-contact-map-link';
            mapLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
            mapLink.target = '_blank';
            mapLink.rel = 'noopener noreferrer';
            mapLink.textContent = 'Auf Karte anzeigen';
            detailsGrid.appendChild(mapLink);
        }
        detailsContent.appendChild(detailsGrid);
        container.appendChild(createDisclosureSection(
            'Vereinsinfos & Kontakt',
            'club-contact-details',
            detailsContent,
            false,
        ));

        const currentSeasonContent = document.createElement('div');

        function createClubMatchCard(match, mode) {
            const isUpcoming = mode === 'upcoming';
            const card = document.createElement('div');
            card.className = isUpcoming ? 'club-upcoming-match' : 'club-recent-match';
            card.style.cssText = "background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 10px; margin-bottom: 8px;";

            const meta = document.createElement('div');
            meta.style.cssText = "display: flex; justify-content: space-between; font-size: 0.8em; color: #94a3b8; margin-bottom: 4px;";
            const date = document.createElement('span');
            date.textContent = match.dateStr || (isUpcoming ? 'Termin offen' : '–');
            const league = document.createElement('span');
            league.style.color = '#64748b';
            league.textContent = match.leagueName || '';
            meta.append(date, league);
            card.appendChild(meta);

            if (isUpcoming) {
                const teams = document.createElement('div');
                teams.style.cssText = "display: flex; justify-content: space-between; align-items: center; color: #f8fafc; font-size: 0.95em;";
                const home = document.createElement('span');
                const separator = document.createElement('span');
                const away = document.createElement('span');
                home.textContent = match.home || '–';
                away.textContent = match.away || '–';
                if (isClubMatch(club.name, match.home)) home.style.cssText = 'font-weight:bold; color:#60a5fa;';
                if (isClubMatch(club.name, match.away)) away.style.cssText = 'font-weight:bold; color:#60a5fa;';
                separator.style.cssText = 'font-size: 0.8em; color: #64748b; padding: 0 5px;';
                separator.textContent = 'vs';
                teams.append(home, separator, away);
                card.append(teams, createGameActionsElement(match));
                return card;
            }

            const isHome = isClubMatch(club.name, match.home);
            const ownScore = Number(isHome ? match.scoreHome : match.scoreAway);
            const opponentScore = Number(isHome ? match.scoreAway : match.scoreHome);
            const resultColor = ownScore > opponentScore ? '#4ade80' : ownScore < opponentScore ? '#f87171' : '#94a3b8';
            card.style.borderLeft = `3px solid ${resultColor}`;
            const resultBody = document.createElement('div');
            resultBody.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
            const teamNames = document.createElement('div');
            teamNames.style.cssText = 'color: #f8fafc; font-size: 0.95em; flex: 1;';
            [match.home, match.away].forEach((teamName) => {
                const team = document.createElement('div');
                team.textContent = teamName || '–';
                if (isClubMatch(club.name, teamName)) team.style.fontWeight = 'bold';
                teamNames.appendChild(team);
            });
            const score = document.createElement('div');
            score.style.cssText = 'font-weight: bold; font-size: 1.1em; color: #f8fafc; background: rgba(255,255,255,0.05); padding: 5px 8px; border-radius: 4px;';
            score.textContent = `${match.scoreHome ?? ''}:${match.scoreAway ?? ''}`;
            resultBody.append(teamNames, score);
            card.appendChild(resultBody);
            return card;
        }

        function createClubMatchesGrid(upcoming, recent, titlePrefix) {
            if (upcoming.length === 0 && recent.length === 0) return null;
            const grid = document.createElement('div');
            grid.style.cssText = "display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 20px;";
            const upCard = document.createElement('div');
            upCard.innerHTML = `<h3 style="color: #f8fafc; font-size: 1.1em; margin-bottom: 10px; border-bottom: 1px solid #334155; padding-bottom: 5px;">📅 ${titlePrefix}Nächste Spiele</h3>`;
            const upList = document.createElement('div');
            upList.id = titlePrefix.toLowerCase().includes('ligapokal')
                ? 'club-upcoming-cup'
                : 'club-upcoming-league';
            upList.className = 'club-upcoming-list';
            upList.style.cssText = "max-height: 400px; overflow-y: auto; padding-right: 5px;";
            if (upcoming.length === 0) upList.innerHTML = `<div style="color: #64748b; font-size: 0.9em;">Keine angesetzten Spiele.</div>`;
            else {
                const renderUpcoming = (expanded) => {
                    upList.replaceChildren();
                    const visibleMatches = expanded ? upcoming : upcoming.slice(0, 5);
                    visibleMatches.forEach(m => {
                        upList.appendChild(createClubMatchCard(m, 'upcoming'));
                    });
                };
                renderUpcoming(false);

                if (upcoming.length > 5) {
                    const toggle = document.createElement('button');
                    toggle.type = 'button';
                    toggle.className = 'club-upcoming-toggle';
                    toggle.setAttribute('aria-expanded', 'false');
                    toggle.setAttribute('aria-controls', upList.id);
                    toggle.textContent = 'Alle Spiele anzeigen';
                    toggle.addEventListener('click', () => {
                        const expanded = toggle.getAttribute('aria-expanded') === 'true';
                        toggle.setAttribute('aria-expanded', String(!expanded));
                        toggle.textContent = expanded ? 'Alle Spiele anzeigen' : 'Weniger anzeigen';
                        renderUpcoming(!expanded);
                    });
                    upCard.append(upList, toggle);
                } else {
                    upCard.appendChild(upList);
                }
            }
            if (upcoming.length === 0) upCard.appendChild(upList);
            const recCard = document.createElement('div');
            recCard.innerHTML = `<h3 style="color: #f8fafc; font-size: 1.1em; margin-bottom: 10px; border-bottom: 1px solid #334155; padding-bottom: 5px;">📊 ${titlePrefix}Letzte Ergebnisse</h3>`;
            const recList = document.createElement('div');
            recList.style.cssText = "max-height: 400px; overflow-y: auto; padding-right: 5px;";
            if (recent.length === 0) recList.innerHTML = `<div style="color: #64748b; font-size: 0.9em;">Keine Ergebnisse gefunden.</div>`;
            else recent.forEach(m => recList.appendChild(createClubMatchCard(m, 'recent')));
            recCard.appendChild(recList);
            grid.appendChild(upCard); grid.appendChild(recCard);
            return grid;
        }

        const leagueGrid = createClubMatchesGrid(nextGames, lastGames, '');
        if (leagueGrid) currentSeasonContent.appendChild(leagueGrid);

        // Current Tables
        currentTables.forEach(t => {
            currentSeasonContent.appendChild(createSafeLeagueTableSection(
                t.leagueName,
                t.tableHtml,
                club.name,
                isClubMatch,
            ));
        });

        const ligapokalGrid = createClubMatchesGrid(nextLigapokalGames, lastLigapokalGames, '🏆 Ligapokal - ');
        if (ligapokalGrid) currentSeasonContent.appendChild(ligapokalGrid);

        let playerSection = null;
        if (clubPlayers.length > 0) {
            const pGrid = document.createElement('div');
            pGrid.style.cssText = "display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px;";
            clubPlayers.forEach(p => {
                pGrid.appendChild(createClubPlayerCard(p, leagueTierColor(p.league)));
            });
            playerSection = createClubRankingSection(
                dataStatus.domains && dataStatus.domains.rankings,
                createClubRankingStatsRow(clubPlayers.length, activeLeagues, totalPoints),
                pGrid,
                clubPlayers.length,
            );
        }

        container.appendChild(createDisclosureSection(
            'Aktuelle Saison',
            'current-season-summary',
            currentSeasonContent,
            true,
        ));
        if (playerSection) container.appendChild(playerSection);

        // --- 3. ARCHIVE ---
        const allArchiveItems = [];

        // A) LIGAPOKAL_ARCHIVE (Structured Cups)
        if (typeof window.LIGAPOKAL_ARCHIVE !== 'undefined') {
            Object.keys(window.LIGAPOKAL_ARCHIVE).forEach(season => {
                parseLigapokalArchive(season, window.LIGAPOKAL_ARCHIVE[season].match_days, club.name, allArchiveItems, !!window.LIGAPOKAL_ARCHIVE[season].isCup);
            });
        }

        // B) ARCHIVE_TABLES (Mixed Leagues & Cups)
        if (typeof window.ARCHIVE_TABLES !== 'undefined') {
            window.ARCHIVE_TABLES.forEach(table => {
                if (!table.rows || table.rows.length < 2) return;
                
                const h = table.rows[0].map(cell => cell.toLowerCase()).join(' ');
                const isMatches = h.includes('heim') && h.includes('gast') && (h.includes('ergebnis') || h.includes('punkte'));
                const isCup = isLigapokalMatch(table.league) || table.league === 'Unbekannt';

                if (isMatches) {
                    const myMatches = table.rows.slice(1).filter(row => row.some(cell => isClubMatch(club.name, cell)));
                    myMatches.forEach(row => {
                        const parsedRow = parseArchiveMatchRow(table.rows[0], row);
                        const { dateStr, home, away, result: res } = parsedRow;

                        const m = {
                            season: table.season,
                            league: (table.league === 'Unbekannt' && (row[0]||'').toLowerCase().includes('runde')) ? 'Ligapokal' : table.league,
                            home: home,
                            away: away,
                            scoreHome: res ? res.split(':')[0] : '',
                            scoreAway: res ? res.split(':')[1] : '',
                            dateStr: dateStr,
                            played: true,
                            isCup: isCup // Use detected flag
                        };
                        allArchiveItems.push(m);
                    });
                } else {
                    // It's a ranking table
                    const hasClub = table.rows.slice(1).some(row => isClubMatch(club.name, row[1]) || isClubMatch(club.name, row[2]));
                    if (hasClub) {
                        const m = { 
                            season: table.season, 
                            league: table.league === 'Unbekannt' ? 'Ligapokal (Tabelle)' : table.league, 
                            isTable: true, 
                            rows: table.rows,
                            isCup: isCup // Use detected flag
                        };
                        allArchiveItems.push(m);
                    }
                }
            });
        }

        // --- 4. DEDUPLICATE AND SPLIT ---
        const seenMatches = new Map();
        const leagueArchiveFinal = [];
        const cupArchiveFinal = [];

        allArchiveItems.forEach(item => {
            const isLP = item.isCup || isLigapokalMatch(item.league);
            if (item.isTable) {
                if (isLP) cupArchiveFinal.push(item);
                else leagueArchiveFinal.push(item);
            } else {
                const dKey = item.dateStr.split(' ')[0];
                const hKey = stripTeamNumber(item.home).toLowerCase().replace(/[^a-z]/g, '');
                const aKey = stripTeamNumber(item.away).toLowerCase().replace(/[^a-z]/g, '');
                const sKey = `${item.scoreHome}:${item.scoreAway}`;
                
                // Group by Club + Day
                // We keep the one with the most information
                const clubKey = hKey || aKey;
                if (!clubKey) return;
                
                const groupKey = `${dKey}|${clubKey}`;
                const existing = seenMatches.get(groupKey);
                
                const currentScoreLen = (item.scoreHome + item.scoreAway).length;
                const currentHasBoth = hKey && aKey;
                
                if (existing) {
                    const existingScoreLen = (existing.scoreHome + existing.scoreAway).length;
                    const existingHasBoth = existing.hKey && existing.aKey;
                    
                    // Replace existing if current is "better"
                    if ((currentScoreLen > existingScoreLen) || (!existingHasBoth && currentHasBoth)) {
                        seenMatches.set(groupKey, { ...item, hKey, aKey });
                    }
                } else {
                    seenMatches.set(groupKey, { ...item, hKey, aKey });
                }
            }
        });

        const roundWeight = (name) => {
            if (!name) return 0;
            const n = name.toLowerCase();
            if (n.includes('runde 1')) return 1;
            if (n.includes('runde 2')) return 2;
            if (n.includes('runde 3')) return 3;
            if (n.includes('runde 4')) return 4;
            if (n.includes('runde 5')) return 5;
            if (n.includes('runde 6')) return 6;
            if (n.includes('achtelfinale')) return 10;
            if (n.includes('viertelfinale')) return 11;
            if (n.includes('halbfinale')) return 12;
            if (n.includes('finale') && !n.includes('halb')) return 15;
            if (n.includes('spiel um platz')) return 14;
            return 0;
        };

        seenMatches.forEach(item => {
            if (item.isCup || isLigapokalMatch(item.league)) cupArchiveFinal.push(item);
            else leagueArchiveFinal.push(item);
        });

        const renderArchive = (matches, title) => {
            if (matches.length === 0) return;
            const sec = document.createElement('div');
            sec.className = 'club-archive-content';
            
            // Group by Season
            const seasonGroups = {};
            matches.forEach(m => {
                if (!seasonGroups[m.season]) seasonGroups[m.season] = {};
                if (!seasonGroups[m.season][m.league]) seasonGroups[m.season][m.league] = [];
                seasonGroups[m.season][m.league].push(m);
            });

            const isCupSection = title.includes('Ligapokal');

            // Inject "Freilos" if it's the cup section
            if (isCupSection && typeof window.LIGAPOKAL_ARCHIVE !== 'undefined') {
                Object.keys(seasonGroups).forEach(season => {
                    const arc = window.LIGAPOKAL_ARCHIVE[season];
                    if (!arc || !arc.match_days) return;
                    
                    const allRoundNames = Object.keys(arc.match_days);
                    const clubPlayedLeagues = Object.keys(seasonGroups[season]);
                    
                    // Find max weight reached by club
                    let maxW = 0;
                    clubPlayedLeagues.forEach(l => {
                        const w = roundWeight(l);
                        if (w > maxW) maxW = w;
                    });

                    allRoundNames.forEach(rName => {
                        const w = roundWeight(rName);
                        // If round is within their active participation range but they didn't play
                        if (w > 0 && w <= maxW && !seasonGroups[season][rName]) {
                            seasonGroups[season][rName] = [{
                                season: season,
                                league: rName,
                                home: 'Freilos',
                                away: 'Freilos',
                                scoreHome: '-',
                                scoreAway: '-',
                                dateStr: '-',
                                played: true,
                                isFreilos: true
                            }];
                        }
                    });
                });
            }

            Object.keys(seasonGroups).sort((a, b) => b.localeCompare(a)).forEach(season => {
                const seasonTitle = season.replace('/', '-');
                const isCupSection = title.includes('Ligapokal');
                const sTitle = isCupSection ? (seasonTitle.startsWith('Ligapokal') ? seasonTitle : 'Ligapokal ' + seasonTitle) : seasonTitle;
                
                let block = `<div style="margin-bottom: 35px;">`;
                block += `<div style="font-size: 1.1em; font-weight: bold; color: #f8fafc; margin-bottom: 15px;">${escapeHtmlText(sTitle)}</div>`;
                
                const leagues = seasonGroups[season];
                // Sort rounds logically using roundWeight
                const sortedLeagues = Object.keys(leagues).sort((a, b) => roundWeight(b) - roundWeight(a));
                
                sortedLeagues.forEach(leagueName => {
                    const g = leagues[leagueName];
                    block += `<div style="margin-bottom: 20px; padding-left: 10px; border-left: 2px solid #334155;">`;
                    const displayLeague = (isCupSection && leagueName.toLowerCase().includes('ligapokal')) ? leagueName : leagueName;
                    block += `<div style="font-weight: 600; color: #94a3b8; margin-bottom: 8px; font-size: 0.9em;">${escapeHtmlText(displayLeague)}</div>`;
                    
                    let i = 0;
                    while (i < g.length) {
                        const item = g[i];
                        if (item.isTable) {
                            const isLeague = item.rows[0].some(h => {
                                const head = String(h || '').toLowerCase().trim();
                                // Check for common league table headers (Pl., Tabelle, Mannschaft, Pos, etc.)
                                return head.includes('pl') || head.includes('tab') || head.includes('mans') || head.includes('pos');
                            });
                            block += `<div class="history-table-wrapper table-scroll">`;
                            block += `<table class="history-table ${isLeague ? 'league-history-table' : 'ranking-history-table'}"><thead><tr style="background: rgba(30, 41, 59, 0.5);">${item.rows[0].map(h => `<th>${escapeHtmlText(h)}</th>`).join('')}</tr></thead><tbody>`;
                            item.rows.slice(1).forEach(row => {
                                const isMyRow = row.some(cell => isClubMatch(club.name, cell));
                                block += `<tr style="${isMyRow ? 'background: rgba(59, 130, 246, 0.2);' : ''}">`;
                                row.forEach(cell => {
                                    const isMyCell = isClubMatch(club.name, cell);
                                    const cellStyle = isMyCell ? 'font-weight:bold; color:#60a5fa;' : '';
                                    block += `<td style="${cellStyle}">${escapeHtmlText(cell)}</td>`;
                                });
                                block += `</tr>`;
                            });
                            block += `</tbody></table></div>`;
                            i++;
                        } else {
                            const matchGroup = [];
                            while (i < g.length && !g[i].isTable) {
                                matchGroup.push(g[i]);
                                i++;
                            }
                            if (matchGroup.length > 0) {
                                block += `<div class="history-table-wrapper table-scroll">`;
                                block += `<table class="history-table match-history-table"><thead><tr style="background: rgba(30, 41, 59, 0.5);"><th>Datum</th><th>Heim</th><th>Gast</th><th>Ergebnis</th></tr></thead><tbody>`;
                                matchGroup.forEach(m => {
                                    const hStyle = isClubMatch(club.name, m.home) ? 'font-weight:bold; color:#60a5fa;' : '';
                                    const aStyle = isClubMatch(club.name, m.away) ? 'font-weight:bold; color:#60a5fa;' : '';
                                    const displayState = archiveMatchDisplayState(m, isCupSection);
                                    const res = createArchiveMatchResult(m, isCupSection).outerHTML;
                                    const rowState = displayState.incomplete ? ' class="history-row--incomplete" aria-label="Daten unvollständig"' : '';
                                    block += `<tr${rowState}><td>${escapeHtmlText(m.dateStr || '–')}</td><td style="${hStyle}">${escapeHtmlText(m.home || '–')}</td><td style="${aStyle}">${escapeHtmlText(m.away || '–')}</td><td style="font-weight:bold;">${res}</td></tr>`;
                                });
                                block += `</tbody></table></div>`;
                            }
                        }
                    }
                    block += `</div>`;
                });
                block += `</div>`;
                sec.innerHTML += block;
            });
            const contentId = isCupSection ? 'club-cup-history' : 'club-league-history';
            container.appendChild(createDisclosureSection(title, contentId, sec, false));
        };

        renderArchive(leagueArchiveFinal, '📜 Liga Historie');
        renderArchive(cupArchiveFinal, '🏆 Ligapokal Historie');

        contentArea.appendChild(container);
    }

    // (Rules removed: Duplicate setupTabs definition was here)

    function cleanTable(container) {
        container.querySelectorAll('table').forEach((table) => {
            table.removeAttribute('style');
            table.removeAttribute('border');
            table.removeAttribute('cellpadding');
            table.removeAttribute('cellspacing');
        });
    }

    // =============================================
    // MATCH PREVIEW HELPER FUNCTIONS
    // =============================================

    /**
     * Parse all match_days text for a given league into structured objects.
     * Returns array of { spieltag, date, home, away, scoreHome, scoreAway, played }
     */
    function parseAllMatches(leagueName) {
        const matches = [];
        const league = leagueData.leagues[leagueName];
        if (!league || !league.match_days) return matches;

        for (const [spieltag, text] of Object.entries(league.match_days)) {
            if (!text) continue;
            // Split by newline (handles both \n and \\n in JSON)
            const lines = text.split(/\\n|\n/).filter(l => l.trim().length > 0);

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                // Try standard league format first:
                // "Mo. 25. 8.2025 20:00 Team A          - Team B             9:7  "
                // Or simpler: "date   home - away   score"
                // The separator between teams is " - " (space dash space)
                const dashIdx = trimmed.indexOf(' - ');
                if (dashIdx === -1) continue;

                const leftPart = trimmed.substring(0, dashIdx).trim();
                const rightPart = trimmed.substring(dashIdx + 3).trim();

                // Extract home team: everything after the date/time
                // Date patterns: "Mo. 25. 8.2025 20:00" or "28.11.2025 20:00"
                let home = leftPart;
                // Try to strip date: look for time pattern HH:MM or just strip leading date
                const timeMatch = leftPart.match(/\d{1,2}:\d{2}\s+(.+)/);
                if (timeMatch) {
                    home = timeMatch[1].trim();
                } else {
                    // Try date without time: "08.03.2026   team"
                    const dateOnlyMatch = leftPart.match(/\d{1,2}\.\d{1,2}\.\d{4}\s+(.+)/);
                    if (dateOnlyMatch) {
                        home = dateOnlyMatch[1].trim();
                    }
                }

                // Extract away team and score from right part
                // "Team B    9:7  " or "Team B    ---  " or "Team B    :  "
                let away = rightPart;
                let scoreHome = null;
                let scoreAway = null;
                let played = false;

                // Match score at end: digits:digits
                const scoreMatch = rightPart.match(/^(.+?)\s+(\d+):(\d+)\s*$/);
                const noScoreMatch = rightPart.match(/^(.+?)\s+(---|\s*:\s*)\s*$/);

                if (scoreMatch) {
                    away = scoreMatch[1].trim();
                    scoreHome = parseInt(scoreMatch[2]);
                    scoreAway = parseInt(scoreMatch[3]);
                    played = true;
                } else if (noScoreMatch) {
                    away = noScoreMatch[1].trim();
                    played = false;
                }

                // Extract date string for display (includes optional time)
                let dateStr = '';
                const dateExtract = leftPart.match(
                    /(?:[A-Za-z]{2}\.\s+)?(\d{1,2}\.\s*\d{1,2}\.\d{4}(?:\s+\d{1,2}:\d{2})?)/
                );
                if (dateExtract) {
                    dateStr = dateExtract[1].trim();
                }

                if (home && away && home !== 'Spielfrei' && away !== 'Spielfrei') {
                    matches.push({
                        spieltag, dateStr, home, away,
                        scoreHome, scoreAway, played
                    });
                }
            }
        }
        return matches;
    }

    /**
     * Find historical results between two teams in a league.
     * Returns { matches: [...], wins: n, draws: n, losses: n } (from teamA perspective)
     */
    function findHistoricalResults(leagueName, teamAName, teamBName) {
        const allMatches = parseAllMatches(leagueName);
        const norm = s => s.toLowerCase().replace(/\u00a0/g, ' ').trim();
        const nA = norm(teamAName);
        const nB = norm(teamBName);

        const results = [];
        let wins = 0, draws = 0, losses = 0;

        for (const m of allMatches) {
            const nHome = norm(m.home);
            const nAway = norm(m.away);

            const isMatch = (nHome === nA && nAway === nB) ||
                (nHome === nB && nAway === nA);
            if (!isMatch || !m.played) continue;

            // Determine result from teamA perspective
            let teamAScore, teamBScore;
            if (nHome === nA) {
                teamAScore = m.scoreHome;
                teamBScore = m.scoreAway;
            } else {
                teamAScore = m.scoreAway;
                teamBScore = m.scoreHome;
            }

            if (teamAScore > teamBScore) wins++;
            else if (teamAScore < teamBScore) losses++;
            else draws++;

            results.push({
                spieltag: m.spieltag,
                dateStr: m.dateStr,
                home: m.home,
                away: m.away,
                scoreHome: m.scoreHome,
                scoreAway: m.scoreAway,
                teamAScore, teamBScore
            });
        }

        return { matches: results, wins, draws, losses };
    }

    /**
     * Get a player's form trend (last N played rounds).
     * Returns { values: [5,7,3,...], lastNAvg: x, totalAvg: y, trend: 'up'|'down'|'flat' }
     */
    function getPlayerFormTrend(player, n = 5) {
        const allValues = [];
        if (!player.rounds) return { values: [], lastNAvg: 0, totalAvg: 0, trend: 'flat' };

        for (let i = 1; i <= 18; i++) {
            const val = player.rounds[`R${i}`];
            if (val === null || val === undefined) continue;
            if (typeof val === 'string' && (!val.trim() || val === '&nbsp;' || val === 'x')) continue;
            let numericValue;
            try {
                numericValue = Number(val);
            } catch (_error) {
                continue;
            }
            if (Number.isFinite(numericValue)) allValues.push(numericValue);
        }

        if (allValues.length === 0) {
            return { values: [], lastNAvg: 0, totalAvg: 0, trend: 'flat' };
        }

        const totalAvg = allValues.reduce((a, b) => a + b, 0) / allValues.length;
        const lastN = allValues.slice(-n);
        const lastNAvg = lastN.reduce((a, b) => a + b, 0) / lastN.length;

        let trend = 'flat';
        if (lastN.length >= 3) {
            const firstHalf = lastN.slice(0, Math.floor(lastN.length / 2));
            const secondHalf = lastN.slice(Math.floor(lastN.length / 2));
            const avg1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
            const avg2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
            if (avg2 - avg1 > 0.5) trend = 'up';
            else if (avg1 - avg2 > 0.5) trend = 'down';
        }

        return { values: lastN, lastNAvg, totalAvg, trend };
    }

    /**
     * Calculate the optimal lineup of n players from a roster to maximize avg.
     * Returns { players: [...], avg: number }
     */
    function calculateOptimalLineup(allPlayers, n = 4) {
        // Filter players with at least 1 game
        const eligible = allPlayers.filter(p => p._cnt >= 1);
        if (eligible.length <= n) {
            const avg = eligible.length > 0
                ? eligible.reduce((s, p) => s + p._avg, 0) / n
                : 0;
            return { players: eligible, avg };
        }

        // Generate combinations C(eligible, n) - brute force is fine for small n
        let bestCombo = null;
        let bestAvg = -1;

        const combine = (start, current) => {
            if (current.length === n) {
                const avg = current.reduce((s, p) => s + p._avg, 0) / n;
                if (avg > bestAvg) {
                    bestAvg = avg;
                    bestCombo = [...current];
                }
                return;
            }
            if (start >= eligible.length) return;
            if (eligible.length - start < n - current.length) return;

            for (let i = start; i < eligible.length; i++) {
                current.push(eligible[i]);
                combine(i + 1, current);
                current.pop();
            }
        };

        combine(0, []);
        return { players: bestCombo || [], avg: bestAvg };
    }

    /**
     * Detect the user's next upcoming match.
     * Returns { league, home, away, dateStr, spieltag } or null
     */
    function detectNextMatch() {
        // 1. Find the user's team name from the profile
        console.log('[AutoDetect] profile record:', myPlayerProfile && myPlayerProfile.recordKey);
        const myProfile = getMyPrimaryPlayer();
        if (!myProfile) {
            console.log('[AutoDetect] No exact profile found');
            return null;
        }

        const myV_nr = myProfile.v_nr;
        let detectedTeamName = myProfile.company || '';

        console.log('[AutoDetect] Profile found:', {
            v_nr: myV_nr, company: detectedTeamName, league: myProfile.league
        });

        // Try to find better team name from clubData
        if (myV_nr && clubData.clubs) {
            const club = clubData.clubs.find(c => String(c.number) === String(myV_nr));
            if (club) detectedTeamName = club.name;
        }

        if (!detectedTeamName) {
            return null;
        }

        // 2. Search ALL leagues for matches involving my team
        // (league names in rankingData vs leagueData often don't match)
        const norm = s => s.toLowerCase().replace(/\u00a0/g, ' ').trim();
        const nTeam = norm(detectedTeamName);
        const leagueKeys = Object.keys(leagueData.leagues || {});
        let allUpcoming = [];

        // Strict team name matching: avoid "DC Foo" matching "DC Foo 2"
        // Only match if names are equal, or if one contains the other
        // AND the remaining characters are NOT a team number suffix
        const teamMatch = (matchName, myName) => {
            if (matchName === myName) return true;
            // If matchName is longer, check it contains myName as a full name
            if (matchName.includes(myName)) {
                const rest = matchName.replace(myName, '').trim();
                // Reject if remainder is just a number (e.g. "2", "3")
                if (/^\d+$/.test(rest)) return false;
                return true;
            }
            if (myName.includes(matchName)) {
                const rest = myName.replace(matchName, '').trim();
                if (/^\d+$/.test(rest)) return false;
                return true;
            }
            return false;
        };

        for (const leagueName of leagueKeys) {
            const allMatches = parseAllMatches(leagueName);
            if (allMatches.length === 0) continue;

            // Check if this league has any match (played or unplayed)
            // involving the user's team (strict matching)
            const teamInLeague = allMatches.some(m => {
                const nH = norm(m.home);
                const nA = norm(m.away);
                return teamMatch(nH, nTeam) || teamMatch(nA, nTeam);
            });

            if (!teamInLeague) continue;


            // Collect unplayed matches for my team
            const upcoming = allMatches.filter(m => {
                if (m.played) return false;
                const nH = norm(m.home);
                const nA = norm(m.away);
                return teamMatch(nH, nTeam) || teamMatch(nA, nTeam);
            });

            upcoming.forEach(m => {
                allUpcoming.push({ ...m, league: leagueName });
            });
        }

        console.log('[AutoDetect] Total upcoming across all leagues:',
            allUpcoming.length);

        // Parse date helper (DD.MM.YYYY [HH:mm] → Date)
        const parseDate = d => parseGermanDate(d) || new Date(9999, 0, 1);

        // Filter out past matches (only keep today or future)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        allUpcoming = allUpcoming.filter(m => {
            const matchDate = parseDate(m.dateStr);
            return matchDate >= today;
        });

        console.log('[AutoDetect] Future upcoming matches:', allUpcoming.length);

        if (allUpcoming.length === 0) return [];

        // Sort by date (soonest first)
        allUpcoming.sort((a, b) => parseDate(a.dateStr) - parseDate(b.dateStr));

        // Return all matches with team context
        return allUpcoming.map(next => ({
            league: next.league,
            home: next.home,
            away: next.away,
            dateStr: next.dateStr,
            spieltag: next.spieltag,
            teamName: detectedTeamName
        }));
    }

    /**
     * Render a small SVG sparkline for an array of values.
     * Returns an HTML string with an inline SVG.
     */
    function renderMatchSparkline(values, color = '#4ade80') {
        if (!values || values.length === 0) return '';
        const w = 80, h = 24, padding = 2;
        const max = Math.max(...values, 1);
        const min = 0;
        const range = max - min || 1;

        const points = values.map((v, i) => {
            const x = padding + (i / (values.length - 1 || 1)) * (w - 2 * padding);
            const y = h - padding - ((v - min) / range) * (h - 2 * padding);
            return `${x},${y}`;
        }).join(' ');

        return `<svg width="${w}" height="${h}" style="vertical-align: middle;">
            <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
            ${values.map((v, i) => {
            const x = padding + (i / (values.length - 1 || 1)) * (w - 2 * padding);
            const y = h - padding - ((v - min) / range) * (h - 2 * padding);
            return `<circle cx="${x}" cy="${y}" r="2" fill="${color}"/>`;
        }).join('')}
        </svg>`;
    }

    /**
     * Helper to normalize strings for match preview fuzzy matching.
     */
    function normMatchPreview(s) {
        if (!s) return "";
        return s.toLowerCase().replace(/\u00a0/g, ' ').trim();
    }

    /**
     * Fuzzy matches a team name against a select element's options.
     */
    function findTeamOptionMatchPreview(select, teamName) {
        const nTeam = normMatchPreview(teamName);
        let fuzzyMatch = null;
        for (const opt of select.options) {
            if (!opt.value) continue;
            const nOpt = normMatchPreview(opt.textContent);
            if (nOpt === nTeam) return opt.value;
            if (!fuzzyMatch && (nOpt.includes(nTeam) || nTeam.includes(nOpt))) {
                fuzzyMatch = opt.value;
            }
        }
        return fuzzyMatch;
    }

    /**
     * Executes the auto-fill logic for the Match Preview tool.
     * Extracts values from nextMatch and selects them in the UI.
     */
    function applyMatchSelectorAutoFill(isAuto, nextMatch, elements) {
        const { leagueSelect, teamASelect, teamBSelect, banner, updateExclusions, loadSelection, setBannerState } = elements;
        const canApply = typeof elements.canApply === 'function' ? elements.canApply : () => true;
        const runInternalChange = typeof elements.runInternalChange === 'function'
            ? elements.runInternalChange
            : (callback) => callback();
        const setLegacyBannerState = (state) => {
            if (!banner) return;
            const cardStatus = banner.querySelector('.match-preview-card__status');
            if (cardStatus && banner.dataset && typeof banner.dataset === 'object') {
                banner.dataset.state = state;
                const cardSelect = banner.querySelector('.match-preview-card__select');
                if (cardSelect) cardSelect.setAttribute('aria-pressed', state === 'selected' ? 'true' : 'false');
                cardStatus.textContent = state === 'selected' ? 'Ausgewählt' : 'Auswahl unvollständig';
                return;
            }
            if (state === 'incomplete') {
                banner.style.borderColor = '#f59e0b';
                banner.style.boxShadow = 'none';
                const statusBtn = banner.querySelector('.load-btn');
                if (statusBtn) {
                    statusBtn.textContent = 'Auswahl unvollständig';
                    statusBtn.style.background = '#b45309';
                }
                return;
            }
            banner.style.borderColor = '#22c55e';
            banner.style.boxShadow = '0 0 10px rgba(34, 197, 94, 0.2)';
            const statusBtn = banner.querySelector('.load-btn');
            if (statusBtn) {
                statusBtn.textContent = isAuto ? '✓ Vorausgewählt' : '✓ Ausgewählt';
                statusBtn.style.background = '#22c55e';
            }
        };
        if (!canApply()) return;
        
        // Step 1: Set league and trigger change to populate teams
        runInternalChange(() => {
            leagueSelect.value = nextMatch.league;
            leagueSelect.dispatchEvent(new Event('change'));
        });

        // Step 2: Set teams after a delay to allow the dropdowns to populate
        setTimeout(() => {
            if (!canApply()) return;
            const homeVal = findTeamOptionMatchPreview(teamASelect, nextMatch.home);
            const awayVal = findTeamOptionMatchPreview(teamBSelect, nextMatch.away);

            runInternalChange(() => {
                if (homeVal) { teamASelect.value = homeVal; }
                if (awayVal) { teamBSelect.value = awayVal; }
            });

            const selectionComplete = Boolean(
                leagueSelect.value && homeVal && awayVal && homeVal !== awayVal
            );
            if (!selectionComplete) {
                if (typeof setBannerState === 'function') {
                    setBannerState('incomplete');
                } else setLegacyBannerState('incomplete');
                setAppStatus('Die Partie konnte nicht vollständig ausgewählt werden. Bitte Teams manuell wählen.');
                return;
            }

            // Refresh selections and results
            if (typeof updateExclusions === 'function') updateExclusions();
            if (typeof loadSelection === 'function') loadSelection();
            setAppStatus(`${nextMatch.home} gegen ${nextMatch.away} wurde ausgewählt.`);

            // Update UI feedback on the banner
            if (typeof setBannerState === 'function') {
                setBannerState('selected');
            } else setLegacyBannerState('selected');
        }, 200);
    }

    function renderMatchPreview() {
        topBarTitle.textContent = 'Match Preview';
        contentArea.textContent = '';

        const previousGeneration = Number.isSafeInteger(renderMatchPreview._generation)
            ? renderMatchPreview._generation
            : 0;
        const renderGeneration = previousGeneration + 1;
        renderMatchPreview._generation = renderGeneration;
        let manualInteractionGeneration = 0;
        let internalChangeDepth = 0;
        let resetMatchCardStatus = () => {};
        const runInternalChange = (callback) => {
            internalChangeDepth += 1;
            try {
                return callback();
            } finally {
                internalChangeDepth -= 1;
            }
        };
        const markManualInteraction = () => {
            manualInteractionGeneration += 1;
            resetMatchCardStatus();
        };

        const requiredModelMethods = [
            'buildClassCalibration',
            'buildOutcomeTrainingExamples',
            'calibrateOutcomeModel',
            'buildTeamRoster',
            'completeLineup',
            'comparePairStrength',
            'forecastMatch',
        ];
        let previewModel;
        let previewModelApi;
        try {
            const rootDescriptor = Object.getOwnPropertyDescriptor(window, 'BwedlMatchPreviewModel');
            previewModel = rootDescriptor
                && Object.prototype.hasOwnProperty.call(rootDescriptor, 'value')
                ? rootDescriptor.value
                : undefined;
            if (!previewModel || (typeof previewModel !== 'object' && typeof previewModel !== 'function')) {
                throw new TypeError('Match preview model root is unavailable');
            }
            const validatedApi = {};
            requiredModelMethods.forEach((name) => {
                const descriptor = Object.getOwnPropertyDescriptor(previewModel, name);
                if (!descriptor
                    || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
                    || typeof descriptor.value !== 'function') {
                    throw new TypeError(`Match preview model method is unavailable: ${name}`);
                }
                validatedApi[name] = Function.prototype.bind.call(descriptor.value, previewModel);
            });
            previewModelApi = Object.freeze(validatedApi);
        } catch (_error) {
            previewModelApi = undefined;
        }
        if (!previewModelApi) {
            const errorPanel = document.createElement('section');
            errorPanel.className = 'match-preview-panel match-preview-error';
            errorPanel.setAttribute('role', 'alert');
            errorPanel.setAttribute('aria-live', 'polite');
            const heading = document.createElement('h2');
            heading.className = 'match-preview-heading';
            heading.textContent = 'Match-Preview ist derzeit nicht verfügbar';
            const explanation = document.createElement('p');
            explanation.textContent = 'Die Prognose konnte nicht geladen werden. Bitte lade die Seite neu oder versuche es später erneut.';
            errorPanel.appendChild(heading);
            errorPanel.appendChild(explanation);
            contentArea.appendChild(errorPanel);
            return;
        }
        const archiveTables = window.ARCHIVE_TABLES || [];
        const clubs = clubData.clubs || [];
        const classCalibration = previewModelApi.buildClassCalibration(archiveData);
        const outcomeTraining = previewModelApi.buildOutcomeTrainingExamples({
            archiveTables,
            archiveData,
            clubs,
        });
        const outcomeModel = previewModelApi.calibrateOutcomeModel(outcomeTraining);
        const rankingStatus = dataStatus && dataStatus.domains
            ? dataStatus.domains.rankings
            : null;
        const currentDatasetSeason = rankingStatus && typeof rankingStatus.season === 'string'
            ? rankingStatus.season
            : undefined;

        const EVIDENCE_LABELS = Object.freeze({
            current: 'Aktuell',
            'current+history': 'Aktuell + Historie',
            historical: 'Vorjahreskader',
            'historical-fallback': 'Historischer Ersatzkader',
            neutral: 'Neutraler Klassenwert',
        });
        const CONFIDENCE_LABELS = Object.freeze({
            high: 'hoch',
            medium: 'mittel',
            provisional: 'vorläufig',
            'very-low': 'sehr unsicher',
        });

        const appendText = (parent, tag, text, className) => {
            const element = document.createElement(tag);
            if (className) element.className = className;
            element.textContent = text;
            parent.appendChild(element);
            return element;
        };
        const setMatchCardState = (card, state) => {
            if (!card) return;
            const cardState = state === 'selected' || state === 'incomplete' ? state : 'idle';
            card.dataset.state = cardState;
            const select = card.querySelector('.match-preview-card__select');
            if (select) select.setAttribute('aria-pressed', cardState === 'selected' ? 'true' : 'false');
            const status = card.querySelector('.match-preview-card__status');
            if (status) status.textContent = cardState === 'selected'
                ? 'Ausgewählt'
                : cardState === 'incomplete'
                    ? 'Auswahl unvollständig'
                    : 'Partie auswählen';
        };
        const centerMatchCard = (card) => {
            if (!card) return;
            let reducedMotion = false;
            try {
                reducedMotion = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
            } catch (_error) {
                reducedMotion = false;
            }
            card.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
        };
        const selectedTeam = (teamId) => availableTeams.find((team) => team.id === teamId) || null;
        const rating = (player) => {
            const value = Number(player && (player.adjustedRating ?? player.rating));
            return Number.isFinite(value) && value > 0 ? value : 1;
        };
        const adaptPlayer = (player) => ({
            ...player,
            _avg: rating(player),
            _cnt: Number.isFinite(Number(player.currentAppearances)) ? Number(player.currentAppearances) : 0,
            rounds: player && player.rounds && typeof player.rounds === 'object' ? player.rounds : {},
        });
        const exactPercentages = (values) => {
            const safe = values.map((value) => Number.isFinite(value) && value >= 0 ? value : 0);
            const total = safe.reduce((sum, value) => sum + value, 0) || 1;
            const scaled = safe.map((value) => value * 100 / total);
            const whole = scaled.map(Math.floor);
            let remaining = 100 - whole.reduce((sum, value) => sum + value, 0);
            scaled.map((value, index) => ({ index, fraction: value - whole[index] }))
                .sort((left, right) => right.fraction - left.fraction || left.index - right.index)
                .slice(0, remaining)
                .forEach(({ index }) => { whole[index] += 1; });
            return whole;
        };

        const container = document.createElement('div');
        container.className = 'match-preview-shell fade-in';

        const selectorCard = document.createElement('section');
        selectorCard.className = 'match-preview-panel match-preview-selector';
        appendText(selectorCard, 'h2', 'Begegnung & Aufstellung', 'match-preview-heading');

        const leagueGroup = document.createElement('div');
        leagueGroup.className = 'match-preview-field';
        const leagueLabel = appendText(leagueGroup, 'label', 'Liga:', 'match-preview-label');
        const leagueSelect = document.createElement('select');
        leagueSelect.className = 'dark-select match-preview-control';
        leagueLabel.setAttribute('for', 'match-preview-league');
        leagueSelect.id = 'match-preview-league';
        const leaguePlaceholder = document.createElement('option');
        leaguePlaceholder.value = '';
        leaguePlaceholder.textContent = '-- Bitte Liga wählen --';
        leagueSelect.appendChild(leaguePlaceholder);
        Object.keys(leagueData.leagues || {}).sort().forEach((league) => {
            const option = document.createElement('option');
            option.value = league;
            option.textContent = league;
            leagueSelect.appendChild(option);
        });
        leagueGroup.appendChild(leagueSelect);
        selectorCard.appendChild(leagueGroup);

        const teamSelection = document.createElement('div');
        teamSelection.className = 'match-preview-team-selection';
        teamSelection.style.display = 'none';
        const teamGrid = document.createElement('div');
        teamGrid.className = 'match-preview-team-grid';
        const createTeamSelect = (id, labelText) => {
            const group = document.createElement('div');
            group.className = 'match-preview-field';
            const label = appendText(group, 'label', labelText, 'match-preview-label');
            label.setAttribute('for', id);
            const select = document.createElement('select');
            select.id = id;
            select.className = 'dark-select match-preview-control';
            group.appendChild(select);
            teamGrid.appendChild(group);
            return select;
        };
        const teamASelect = createTeamSelect('match-preview-home', 'Heim Team:');
        const teamBSelect = createTeamSelect('match-preview-away', 'Gast Team:');
        teamSelection.appendChild(teamGrid);

        const selectionArea = document.createElement('div');
        selectionArea.id = 'player-selection-area';
        selectionArea.className = 'match-preview-selection';
        selectionArea.style.display = 'none';
        const matchPreviewSeasonNotice = createSeasonNotice('match-preview');
        if (matchPreviewSeasonNotice) selectionArea.appendChild(matchPreviewSeasonNotice);
        const listGrid = document.createElement('div');
        listGrid.className = 'match-preview-lineup-grid';
        const listAElement = document.createElement('div');
        listAElement.id = 'list-a';
        const listBElement = document.createElement('div');
        listBElement.id = 'list-b';
        listGrid.append(listAElement, listBElement);
        selectionArea.appendChild(listGrid);
        const calcBtn = document.createElement('button');
        calcBtn.type = 'button';
        calcBtn.className = 'match-preview-calculate';
        calcBtn.textContent = 'Prognose berechnen';
        selectionArea.appendChild(calcBtn);
        teamSelection.appendChild(selectionArea);
        selectorCard.appendChild(teamSelection);
        container.appendChild(selectorCard);

        const historyDiv = document.createElement('div');
        historyDiv.id = 'historical-results';
        container.appendChild(historyDiv);
        const resultDiv = document.createElement('div');
        resultDiv.id = 'preview-results';
        resultDiv.setAttribute('aria-live', 'polite');
        container.appendChild(resultDiv);
        contentArea.appendChild(container);

        let initialMatchAutoFill = null;
        let synchronizeMatchBrowse = (card, options = {}) => {
            if (options.center) centerMatchCard(card);
        };

        // Preserve the existing detected-match action, but keep all feed data inert.
        try {
            const selectedGame = typeof readMatchPreviewGame === 'function' ? readMatchPreviewGame() : null;
            const selectedMatch = selectedGame ? {
                ...selectedGame,
                league: selectedGame.league || selectedGame.leagueName || selectedGame.leagueKey || '',
                spieltag: selectedGame.spieltag || (selectedGame.round ? `${selectedGame.round}. Spieltag` : ''),
            } : null;
            const detectedMatches = detectNextMatch() || [];
            const matches = BwedlAppUtils.mergeMatchPreviewGames(selectedMatch, detectedMatches);
            if (matches.length) {
                const scroller = document.createElement('section');
                scroller.className = 'match-preview-next-games match-preview-carousel';
                appendText(scroller, 'h2', matches.length > 1 ? `Nächste Spiele (${matches.length})` : 'Nächstes Spiel erkannt');
                const track = document.createElement('div');
                track.className = 'match-preview-carousel__track';
                scroller.appendChild(track);
                const matchCards = [];
                resetMatchCardStatus = () => {
                    matchCards.forEach((card) => setMatchCardState(card, 'idle'));
                };
                matches.forEach((match) => {
                    const matchCard = document.createElement('article');
                    matchCard.className = 'match-preview-card';
                    const homeName = typeof match.home === 'string' && match.home.trim() ? match.home : 'Heim';
                    const awayName = typeof match.away === 'string' && match.away.trim() ? match.away : 'Gast';
                    const competitionName = typeof match.league === 'string' && match.league.trim() ? match.league : 'Wettbewerb offen';
                    const matchday = typeof match.spieltag === 'string' && match.spieltag.trim() ? match.spieltag : '';
                    const dateText = typeof match.dateStr === 'string' && match.dateStr.trim() ? match.dateStr : 'Termin offen';
                    const loadButton = document.createElement('button');
                    loadButton.type = 'button';
                    loadButton.className = 'load-btn';
                    loadButton.classList.add('match-preview-card__select');
                    loadButton.setAttribute('aria-label', `${homeName} gegen ${awayName}, ${competitionName}${matchday ? `, ${matchday}` : ''}, ${dateText} auswählen`);
                    loadButton.setAttribute('aria-pressed', 'false');
                    appendText(loadButton, 'span', competitionName, 'match-preview-card__league');
                    const teams = document.createElement('div');
                    teams.className = 'match-preview-card__teams';
                    appendText(teams, 'strong', homeName);
                    appendText(teams, 'span', 'VS');
                    appendText(teams, 'strong', awayName);
                    loadButton.appendChild(teams);
                    if (matchday) appendText(loadButton, 'span', matchday, 'match-preview-card__matchday');
                    appendText(loadButton, 'span', dateText, 'match-preview-card__date');
                    appendText(loadButton, 'span', 'Partie auswählen', 'match-preview-card__status');
                    loadButton.addEventListener('click', () => {
                        markManualInteraction();
                        const cardInteractionGeneration = manualInteractionGeneration;
                        const canApplyCardSelection = () => (
                            renderMatchPreview._generation === renderGeneration
                            && manualInteractionGeneration === cardInteractionGeneration
                        );
                        applyMatchSelectorAutoFill(false, match, {
                            leagueSelect, teamASelect, teamBSelect, banner: matchCard,
                            updateExclusions, loadSelection, canApply: canApplyCardSelection,
                            runInternalChange, setBannerState: (state) => {
                                setMatchCardState(matchCard, state);
                                if (state === 'selected') synchronizeMatchBrowse(matchCard, { center: true });
                            },
                        });
                    });
                    matchCard.appendChild(loadButton);
                    track.appendChild(matchCard);
                    matchCards.push(matchCard);
                    setMatchCardState(matchCard, 'idle');
                    if (!initialMatchAutoFill
                        && match && typeof match.league === 'string' && match.league.trim()
                        && typeof match.home === 'string' && match.home.trim()
                        && typeof match.away === 'string' && match.away.trim()) {
                        initialMatchAutoFill = { match, card: matchCard };
                    }
                });
                if (matchCards.length > 1) {
                    let browsedIndex = 0;
                    const controls = document.createElement('div');
                    controls.className = 'match-preview-carousel__controls';
                    const previousButton = document.createElement('button');
                    previousButton.type = 'button';
                    previousButton.className = 'match-preview-carousel__arrow';
                    previousButton.setAttribute('aria-label', 'Vorherige Partie');
                    previousButton.textContent = '←';
                    const nextButton = document.createElement('button');
                    nextButton.type = 'button';
                    nextButton.className = 'match-preview-carousel__arrow';
                    nextButton.setAttribute('aria-label', 'Nächste Partie');
                    nextButton.textContent = '→';
                    const dots = matchCards.map((_card, index) => {
                        const dot = document.createElement('button');
                        dot.type = 'button';
                        dot.className = 'match-preview-carousel__dot';
                        dot.setAttribute('aria-label', `Partie ${index + 1} von ${matchCards.length} anzeigen`);
                        controls.appendChild(dot);
                        return dot;
                    });
                    const updateNavigation = () => {
                        previousButton.disabled = browsedIndex === 0;
                        nextButton.disabled = browsedIndex === matchCards.length - 1;
                        dots.forEach((dot, index) => {
                            if (index === browsedIndex) dot.setAttribute('aria-current', 'true');
                            else dot.removeAttribute('aria-current');
                        });
                    };
                    const setBrowseIndex = (index, options = {}) => {
                        browsedIndex = Math.max(0, Math.min(matchCards.length - 1, index));
                        updateNavigation();
                        const card = matchCards[browsedIndex];
                        const select = card.querySelector('.match-preview-card__select');
                        if (options.focus && select) select.focus();
                        if (options.center) centerMatchCard(card);
                    };
                    synchronizeMatchBrowse = (card, options = {}) => {
                        const index = matchCards.indexOf(card);
                        if (index !== -1) setBrowseIndex(index, options);
                    };
                    const synchronizeNearestTrackCard = () => {
                        if (renderMatchPreview._generation !== renderGeneration) return;
                        const trackRect = track.getBoundingClientRect();
                        const trackCenter = Number(trackRect && trackRect.left) + Number(trackRect && trackRect.width) / 2;
                        if (!Number.isFinite(trackCenter)) return;
                        let nearestIndex = 0;
                        let nearestDistance = Infinity;
                        matchCards.forEach((card, index) => {
                            const cardRect = card.getBoundingClientRect();
                            const cardCenter = Number(cardRect && cardRect.left) + Number(cardRect && cardRect.width) / 2;
                            const distance = Math.abs(cardCenter - trackCenter);
                            if (Number.isFinite(distance) && distance < nearestDistance) {
                                nearestIndex = index;
                                nearestDistance = distance;
                            }
                        });
                        if (nearestDistance !== Infinity) setBrowseIndex(nearestIndex);
                    };
                    let scrollSettleGeneration = 0;
                    const scheduleTrackSynchronization = () => {
                        const scheduledGeneration = ++scrollSettleGeneration;
                        setTimeout(() => {
                            if (scheduledGeneration !== scrollSettleGeneration) return;
                            synchronizeNearestTrackCard();
                        }, 120);
                    };
                    previousButton.addEventListener('click', () => setBrowseIndex(browsedIndex - 1, { focus: true, center: true }));
                    nextButton.addEventListener('click', () => setBrowseIndex(browsedIndex + 1, { focus: true, center: true }));
                    dots.forEach((dot, index) => dot.addEventListener('click', () => setBrowseIndex(index, { focus: true, center: true })));
                    scroller.addEventListener('keydown', (event) => {
                        if (event.key === 'ArrowLeft') {
                            event.preventDefault();
                            setBrowseIndex(browsedIndex - 1, { focus: true, center: true });
                        } else if (event.key === 'ArrowRight') {
                            event.preventDefault();
                            setBrowseIndex(browsedIndex + 1, { focus: true, center: true });
                        }
                    });
                    track.addEventListener('scroll', scheduleTrackSynchronization);
                    track.addEventListener('scrollend', () => {
                        scrollSettleGeneration += 1;
                        synchronizeNearestTrackCard();
                    });
                    controls.insertBefore(previousButton, controls.firstChild);
                    controls.appendChild(nextButton);
                    scroller.appendChild(controls);
                    updateNavigation();
                }
                container.insertBefore(scroller, selectorCard);
            }
        } catch (error) {
            console.warn('[Match Preview] Auto-detect error:', error);
        }

        // Logic
        let availableTeams = [];
        let playersA = [];
        let playersB = [];
        let rosterA = null;
        let rosterB = null;
        let selectedA = new Set();
        let selectedB = new Set();

        const populate = (select) => {
            select.textContent = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '-- Team wählen --';
            select.appendChild(placeholder);
            availableTeams.forEach((team) => {
                const option = document.createElement('option');
                option.value = team.id;
                option.textContent = team.name;
                select.appendChild(option);
            });
        };

        leagueSelect.addEventListener('change', (event) => {
            if (internalChangeDepth === 0) markManualInteraction();
            const league = leagueSelect.value;
            teamSelection.style.display = league ? 'block' : 'none';
            selectionArea.style.display = 'none';
            resultDiv.textContent = '';
            historyDiv.textContent = '';
            if (!league) return;
            const tableTeams = [];
            const leagueRecord = leagueData.leagues && leagueData.leagues[league];
            if (leagueRecord && leagueRecord.table) {
                safeTableRowsFromHtml(leagueRecord.table).forEach((cells) => {
                    if (cells.length > 2) tableTeams.push(cells[1].trim());
                });
            }
            availableTeams = BwedlAppUtils.buildMatchPreviewTeams(
                rankingData.players || [], tableTeams, clubs,
            );
            populate(teamASelect);
            populate(teamBSelect);
        });

        const buildRoster = (teamId, league) => {
            const team = selectedTeam(teamId);
            return previewModelApi.buildTeamRoster({
                teamId,
                teamName: team ? team.name : '',
                targetLeague: league,
                currentDatasetSeason,
                currentPlayers: rankingData.players || [],
                archiveData,
                calibration: classCalibration,
                clubs,
            });
        };

        const classChangeText = (sourceClasses, targetClass) => {
            if (!targetClass) return '';
            const changed = sourceClasses.filter((sourceClass) => sourceClass !== targetClass);
            return changed.length ? `Klassenwechsel: ${changed.join(', ')} → ${targetClass}` : '';
        };

        const renderPlayerList = (players, element, selectedSet, headerText, targetClass) => {
            element.textContent = '';
            const header = document.createElement('div');
            header.className = 'match-preview-list-heading';
            appendText(header, 'h3', headerText);
            const count = appendText(header, 'span', `${selectedSet.size} gewählt`, 'match-preview-count');
            element.appendChild(header);
            const rows = document.createElement('div');
            rows.className = 'match-preview-player-list';
            players.forEach((player, index) => {
                const row = document.createElement('article');
                row.className = 'match-preview-player';
                row.dataset.evidence = Object.hasOwn(EVIDENCE_LABELS, player.evidence) ? player.evidence : 'neutral';
                const label = document.createElement('label');
                label.className = 'match-preview-player__select';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.value = String(index);
                input.checked = selectedSet.has(player);
                input.setAttribute('type', 'checkbox');
                input.setAttribute('aria-label', `${player.name} auswählen`);
                label.appendChild(input);
                appendText(label, 'span', player.name, `match-preview-player__name${isMyPlayerRecord(player) ? ' my-player-text' : ''}`);
                row.appendChild(label);
                const ratingBlock = document.createElement('div');
                ratingBlock.className = 'match-preview-player__rating';
                appendText(ratingBlock, 'strong', rating(player).toFixed(2));
                appendText(ratingBlock, 'span', `${player._cnt} Sp.`);
                row.appendChild(ratingBlock);
                const badges = document.createElement('div');
                badges.className = 'match-preview-player__badges';
                appendText(badges, 'span', EVIDENCE_LABELS[player.evidence] || EVIDENCE_LABELS.neutral, 'match-preview-evidence');
                appendText(badges, 'span', `Datenqualität: ${CONFIDENCE_LABELS[player.confidence] || CONFIDENCE_LABELS['very-low']}`, 'match-preview-confidence');
                const sourceClasses = Array.isArray(player.sourceClasses)
                    ? [...new Set(player.sourceClasses.filter((sourceClass) => typeof sourceClass === 'string' && sourceClass))]
                    : [];
                const changedClass = classChangeText(sourceClasses, targetClass);
                if (changedClass) appendText(badges, 'span', changedClass, 'match-preview-source');
                if (player.rosterUnconfirmed) appendText(badges, 'span', 'Kaderzugehörigkeit unbestätigt', 'match-preview-warning');
                const sourceSeasons = Array.isArray(player.sourceSeasons) ? player.sourceSeasons : [];
                if (sourceSeasons.length || sourceClasses.length) {
                    const parts = [];
                    if (sourceSeasons.length) parts.push(`Saisons: ${sourceSeasons.join(', ')}`);
                    if (sourceClasses.length) parts.push(`Klassen: ${sourceClasses.join(', ')}`);
                    if (targetClass) parts.push(`Zielklasse: ${targetClass}`);
                    appendText(badges, 'span', `Quelle: ${parts.join(' · ')}`, 'match-preview-source');
                }
                row.appendChild(badges);
                input.addEventListener('change', (event) => {
                    if (event.target.checked && selectedSet.size < 4) selectedSet.add(player);
                    else if (!event.target.checked) selectedSet.delete(player);
                    else event.target.checked = false;
                    count.textContent = `${selectedSet.size} gewählt`;
                    rows.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
                        checkbox.disabled = !checkbox.checked && selectedSet.size >= 4;
                    });
                });
                rows.appendChild(row);
            });
            element.appendChild(rows);
            rows.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
                checkbox.disabled = !checkbox.checked && selectedSet.size >= 4;
            });
        };

        const renderHistory = (league, nameA, nameB) => {
            historyDiv.textContent = '';
            try {
                const history = findHistoricalResults(league, nameA, nameB);
                if (!history || !history.matches || !history.matches.length) return;
                const panel = document.createElement('section');
                panel.className = 'match-preview-panel';
                appendText(panel, 'h2', `Historische Ergebnisse (${nameA} gegen ${nameB})`);
                appendText(panel, 'p', `${history.wins} Siege · ${history.draws} Unentschieden · ${history.losses} Niederlagen`);
                history.matches.forEach((match) => appendText(panel, 'p', `${match.spieltag || ''} · ${match.home || ''} ${match.scoreHome}:${match.scoreAway} ${match.away || ''}`));
                historyDiv.appendChild(panel);
            } catch (error) {
                console.warn('[Match Preview] History error:', error);
            }
        };

        const loadSelection = () => {
            const league = leagueSelect.value;
            const idA = teamASelect.value;
            const idB = teamBSelect.value;
            if (!league || !idA || !idB || idA === idB) {
                selectionArea.style.display = 'none';
                return;
            }
            rosterA = buildRoster(idA, league);
            rosterB = buildRoster(idB, league);
            playersA = (rosterA.players || []).map(adaptPlayer);
            playersB = (rosterB.players || []).map(adaptPlayer);
            selectedA = new Set(playersA.slice(0, 4));
            selectedB = new Set(playersB.slice(0, 4));
            const nameA = selectedTeam(idA)?.name || 'Heim';
            const nameB = selectedTeam(idB)?.name || 'Gast';
            renderPlayerList(playersA, listAElement, selectedA, nameA, rosterA.targetClass);
            renderPlayerList(playersB, listBElement, selectedB, nameB, rosterB.targetClass);
            selectionArea.style.display = 'block';
            resultDiv.textContent = '';
            renderHistory(league, nameA, nameB);
        };

        const updateExclusions = () => {
            Array.from(teamASelect.options).forEach((option) => { if (option.value) option.disabled = option.value === teamBSelect.value; });
            Array.from(teamBSelect.options).forEach((option) => { if (option.value) option.disabled = option.value === teamASelect.value; });
        };
        teamASelect.addEventListener('change', (event) => {
            if (internalChangeDepth === 0) markManualInteraction();
            updateExclusions();
            loadSelection();
        });
        teamBSelect.addEventListener('change', (event) => {
            if (internalChangeDepth === 0) markManualInteraction();
            updateExclusions();
            loadSelection();
        });
        if (initialMatchAutoFill) {
            const scheduledInteractionGeneration = manualInteractionGeneration;
            const canApplyInitialAutoFill = () => (
                renderMatchPreview._generation === renderGeneration
                && manualInteractionGeneration === scheduledInteractionGeneration
            );
            setTimeout(() => {
                if (!canApplyInitialAutoFill()) return;
                resetMatchCardStatus();
                applyMatchSelectorAutoFill(true, initialMatchAutoFill.match, {
                    leagueSelect, teamASelect, teamBSelect, banner: initialMatchAutoFill.card,
                    updateExclusions, loadSelection, canApply: canApplyInitialAutoFill,
                    runInternalChange, setBannerState: (state) => {
                        setMatchCardState(initialMatchAutoFill.card, state);
                        if (state === 'selected') synchronizeMatchBrowse(initialMatchAutoFill.card, { center: true });
                    },
                });
            }, 100);
        }

        const renderLineup = (parent, titleText, lineup) => {
            const section = document.createElement('section');
            section.className = 'match-preview-lineup';
            appendText(section, 'h3', titleText);
            lineup.forEach((player) => {
                const row = document.createElement('div');
                row.className = 'match-preview-lineup-slot';
                row.dataset.evidence = Object.hasOwn(EVIDENCE_LABELS, player.evidence) ? player.evidence : 'neutral';
                appendText(row, 'strong', player.name);
                appendText(row, 'span', EVIDENCE_LABELS[player.evidence] || EVIDENCE_LABELS.neutral, 'match-preview-evidence');
                appendText(row, 'span', rating(player).toFixed(2));
                section.appendChild(row);
            });
            parent.appendChild(section);
        };

        const renderFormAndPairings = (parent, nameA, nameB, lineupA, lineupB) => {
            const form = document.createElement('section');
            form.className = 'match-preview-panel match-preview-form';
            appendText(form, 'h2', 'Formkurve (Letzte 5 Runden)');
            [[nameA, lineupA], [nameB, lineupB]].forEach(([teamName, lineup]) => {
                appendText(form, 'h3', teamName);
                lineup.forEach((player) => {
                    const row = document.createElement('div');
                    row.className = 'match-preview-form-row';
                    appendText(row, 'strong', player.name);
                    if (player.evidence === 'neutral') {
                        appendText(row, 'span', 'Keine Formdaten', 'match-preview-form-label');
                        form.appendChild(row);
                        return;
                    }
                    const formLabel = player.evidence === 'current' || player.evidence === 'current+history'
                        ? 'Aktuelle Form'
                        : 'Historische Form';
                    appendText(row, 'span', formLabel, 'match-preview-form-label');
                    let values = [];
                    try {
                        const trend = getPlayerFormTrend(player);
                        values = trend && Array.isArray(trend.values)
                            ? trend.values.map(Number).filter(Number.isFinite).slice(-5)
                            : [];
                    } catch (_error) {
                        values = [];
                    }
                    if (values.length) {
                        const sparkline = document.createElement('span');
                        sparkline.className = 'match-preview-sparkline';
                        sparkline.setAttribute('role', 'img');
                        sparkline.setAttribute('aria-label', `${formLabel}: ${values.map((value) => value.toFixed(1)).join(', ')}`);
                        const minimum = Math.min(...values);
                        const maximum = Math.max(...values);
                        values.forEach((value) => {
                            const point = document.createElement('span');
                            point.className = 'match-preview-sparkline__point';
                            const relativeHeight = maximum === minimum
                                ? 65
                                : 25 + ((value - minimum) / (maximum - minimum)) * 75;
                            point.style.height = `${relativeHeight.toFixed(1)}%`;
                            point.setAttribute('title', value.toFixed(1));
                            sparkline.appendChild(point);
                        });
                        row.appendChild(sparkline);
                    } else {
                        appendText(row, 'span', 'Keine Formdaten', 'match-preview-form-empty');
                    }
                    form.appendChild(row);
                });
            });
            parent.appendChild(form);
            const pairings = document.createElement('section');
            pairings.className = 'match-preview-panel match-preview-pairings';
            appendText(pairings, 'h2', '1v1 Paarungen');
            lineupA.forEach((homePlayer) => lineupB.forEach((awayPlayer) => {
                appendText(pairings, 'p', `${homePlayer.name} ${rating(homePlayer).toFixed(1)} · ${awayPlayer.name} ${rating(awayPlayer).toFixed(1)}`, 'match-preview-pairing');
            }));
            parent.appendChild(pairings);
            if (playersA.length > 4 || playersB.length > 4) {
                const optimal = document.createElement('section');
                optimal.className = 'match-preview-panel match-preview-optimal';
                appendText(optimal, 'h2', 'Optimale Aufstellung');
                if (playersA.length > 4) appendText(optimal, 'p', `${nameA}: ${calculateOptimalLineup(playersA, 4).players.map((player) => player.name).join(', ')}`);
                if (playersB.length > 4) appendText(optimal, 'p', `${nameB}: ${calculateOptimalLineup(playersB, 4).players.map((player) => player.name).join(', ')}`);
                parent.appendChild(optimal);
            }
        };

        calcBtn.addEventListener('click', () => {
            if (!rosterA || !rosterB) return;
            const lineupA = previewModelApi.completeLineup(Array.from(selectedA), {
                manual: true, classMean: rosterA.classMean, classMeanAvailable: rosterA.classMeanAvailable,
            });
            const lineupB = previewModelApi.completeLineup(Array.from(selectedB), {
                manual: true, classMean: rosterB.classMean, classMeanAvailable: rosterB.classMeanAvailable,
            });
            const forecast = previewModelApi.forecastMatch(lineupA, lineupB, { outcomeModel });
            const nameA = selectedTeam(teamASelect.value)?.name || 'Heim';
            const nameB = selectedTeam(teamBSelect.value)?.name || 'Gast';
            resultDiv.textContent = '';
            const summary = document.createElement('section');
            summary.className = 'match-preview-panel match-preview-forecast';
            appendText(summary, 'h2', `${nameA} gegen ${nameB}`);
            appendText(summary, 'p', `${nameA}: ${Number(forecast.homeScore).toFixed(1)} · ${nameB}: ${Number(forecast.awayScore).toFixed(1)}`, 'match-preview-scores');
            if (forecast.mode === 'probability') {
                const probabilities = exactPercentages([forecast.home, forecast.draw, forecast.away]);
                const grid = document.createElement('div');
                grid.className = 'match-preview-forecast__probabilities match-preview-probability-grid';
                ['Heimsieg', 'Unentschieden', 'Auswärtssieg'].forEach((label, index) => appendText(grid, 'strong', `${label} ${probabilities[index]}%`));
                summary.appendChild(grid);
                appendText(summary, 'p', `Plausibler Bereich: Heimsieg ${Math.round(forecast.low.home * 100)}–${Math.round(forecast.high.home * 100)}%, Unentschieden ${Math.round(forecast.low.draw * 100)}–${Math.round(forecast.high.draw * 100)}%, Auswärtssieg ${Math.round(forecast.low.away * 100)}–${Math.round(forecast.high.away * 100)}%`, 'match-preview-range');
                appendText(summary, 'p', 'Kalibrierte Drei-Wege-Prognose; unsichere Kaderplätze verbreitern den plausiblen Bereich.');
            } else {
                appendText(summary, 'h3', 'Relative Aufstellungsstärke');
                appendText(summary, 'p', `${nameA}: ${Number(forecast.relative.homeShare * 100).toFixed(1)} zu ${nameB}: ${Number(forecast.relative.awayShare * 100).toFixed(1)}`);
                appendText(summary, 'p', forecast.uncertaintyText || 'Keine kalibrierte Ergebniswahrscheinlichkeit verfügbar.');
            }
            appendText(summary, 'p', `Datenqualität der Teams: ${CONFIDENCE_LABELS[forecast.teamConfidence] || CONFIDENCE_LABELS['very-low']}`, 'match-preview-confidence');
            resultDiv.appendChild(summary);
            const lineups = document.createElement('div');
            lineups.className = 'match-preview-lineup-grid';
            renderLineup(lineups, nameA, lineupA);
            renderLineup(lineups, nameB, lineupB);
            resultDiv.appendChild(lineups);
            renderFormAndPairings(resultDiv, nameA, nameB, lineupA, lineupB);
            let reducedMotion = false;
            try {
                reducedMotion = typeof window.matchMedia === 'function'
                    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            } catch (_error) {
                reducedMotion = false;
            }
            resultDiv.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
        });
    }

    // GitHub Pages is the only product runtime. This action checks the latest
    // published status and then reloads the network-first data files.
    window.triggerUpdate = async function () {
        const controls = ['update-btn', 'mobile-refresh']
            .map((id) => document.getElementById(id))
            .filter(Boolean);
        const originalLabels = controls.map((control) => control.textContent);
        const updateStatus = document.getElementById('update-status');

        controls.forEach((control) => {
            control.disabled = true;
            control.textContent = '⏳ Lädt...';
        });
        if (updateStatus) {
            updateStatus.textContent = 'Veröffentlichte Daten werden geprüft...';
            updateStatus.classList.remove('hidden');
            updateStatus.style.color = '#94a3b8';
            updateStatus.setAttribute('role', 'status');
            updateStatus.setAttribute('aria-live', 'polite');
        }

        try {
            const stats = calculateDataStats();
            localStorage.setItem('update_snapshot', JSON.stringify(stats));
        } catch (error) {
            console.error('Snapshot failed', error);
        }

        try {
            await window.BwedlAppUtils.probePublishedData(
                window.fetch.bind(window),
                document.baseURI,
                Date.now(),
            );
            if (updateStatus) {
                updateStatus.textContent = 'Veröffentlichter Datenstand wird geladen...';
                updateStatus.style.color = '#4ade80';
            }
            window.location.reload();
        } catch (error) {
            if (updateStatus) {
                updateStatus.textContent = 'Keine Verbindung – gespeicherter Datenstand bleibt verfügbar.';
                updateStatus.style.color = '#f87171';
            }
            controls.forEach((control, index) => {
                control.disabled = false;
                control.textContent = originalLabels[index];
            });
        }
    };


    function calculateDataStats() {
        let players = 0;
        if (typeof rankingData !== 'undefined' && rankingData.players) {
            players = rankingData.players.length;
        }

        let matchCounts = {};
        if (typeof leagueData !== 'undefined' && leagueData.leagues) {
            for (const [name, league] of Object.entries(leagueData.leagues)) {
                let count = 0;
                if (league.match_days) {
                    // Estimate distinct matches (lines > 10 chars)
                    count = Object.values(league.match_days).join('\n').split('\n').filter(line => line.trim().length > 10).length;
                }
                matchCounts[name] = count;
            }
        }

        return { players, matchCounts, timestamp: Date.now() };
    }

    function checkUpdateSnapshot() {
        const snapshot = localStorage.getItem('update_snapshot');
        if (snapshot) {
            try {
                const prev = JSON.parse(snapshot);
                // Verify it's recent (< 5 min)
                if (Date.now() - prev.timestamp < 300000) {
                    const current = calculateDataStats();
                    const diffPlayers = current.players - prev.players;

                    const changes = [];
                    if (diffPlayers > 0) changes.push(`${diffPlayers} neue Spieler`);
                    if (diffPlayers < 0) changes.push(`${Math.abs(diffPlayers)} Spieler entfernt`);

                    // Diff Leagues
                    let changedLeagues = [];
                    for (const [league, count] of Object.entries(current.matchCounts)) {
                        const prevCount = prev.matchCounts[league] || 0;
                        const diff = count - prevCount;
                        if (diff > 0) {
                            changedLeagues.push(league);
                        }
                    }

                    if (changedLeagues.length > 0) {
                        if (changedLeagues.length <= 2) {
                            changes.push(`Neue Ergebnisse in ${changedLeagues.join(' und ')}`);
                        } else {
                            changes.push(`Neue Ergebnisse in ${changedLeagues.length} Ligen`);
                        }
                    }

                    if (changes.length === 0) changes.push("Keine Änderungen gefunden");

                    const statusEl = document.getElementById('update-status');
                    if (statusEl) {
                        const heading = document.createElement('strong');
                        heading.textContent = 'Update erfolgreich!';
                        const detail = document.createElement('span');
                        detail.style.fontSize = '0.9em';
                        detail.textContent = changes.join(', ');
                        statusEl.replaceChildren(heading, document.createElement('br'), detail);
                        statusEl.classList.remove('hidden');
                        statusEl.style.color = "#4ade80";

                        // Keep it visible for 15 seconds so user sees it
                        setTimeout(() => statusEl.classList.add('hidden'), 15000);
                    }
                }
                localStorage.removeItem('update_snapshot');
            } catch (e) { console.error(e); localStorage.removeItem('update_snapshot'); }
        }
    }

    // Initialize
    // Init called via logic at top
    // init();

    function renderWiki() {
        topBarTitle.textContent = "Anleitung / Wiki";
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.className = "fade-in";
        container.style.padding = "20px";
        container.style.maxWidth = "800px";
        container.style.margin = "0 auto";
        container.style.color = "#e2e8f0";

        container.innerHTML = `
            <div style="background: #1e293b; padding: 25px; border-radius: 12px; border: 1px solid #334155;">
                <h2 style="color: #60a5fa; border-bottom: 2px solid #334155; padding-bottom: 10px; margin-bottom: 20px;">📘 BWEDL Stats - Benutzerhandbuch</h2>
                
                <p>Willkommen bei <strong>BWEDL Stats</strong>, deiner App für Darts-Statistiken, Tabellen und Tools rund um die <em>Baden-Württembergische E-Dart Liga</em>.</p>

                <h3 style="color: #f8fafc; margin-top: 25px;">🚀 Schnelleinstieg</h3>
                <p>Die App ist in drei Hauptbereiche unterteilt:</p>
                <ul style="padding-left: 20px; line-height: 1.6;">
                    <li><strong>Dashboard</strong>: Deine persönliche Übersicht (Favoriten, nächste Spiele).</li>
                    <li><strong>Ligen</strong>: Alle Tabellen, Ergebnisse und Schedules der aktuellen Saison.</li>
                    <li><strong>Tools</strong>: Nützliche Helfer wie der Match Scorer oder H2H-Vergleich.</li>
                </ul>

                <hr style="border-color: #334155; margin: 30px 0;">

                <h3 style="color: #f8fafc;">🧭 Navigation & Bereiche</h3>

                <h4 style="color: #94a3b8; margin-top: 20px;">1. Dashboard</h4>
                <ul style="padding-left: 20px; line-height: 1.6;">
                    <li><strong>Favoriten</strong>: Markiere Spieler (⭐), um ihre Statistiken sofort zu sehen.</li>
                    <li><strong>Suche</strong>: Nutze die Suchleiste oben links, um schnell nach <em>Spielern</em> oder <em>Vereinen</em> zu suchen.</li>
                    <li><strong>Status</strong>: Oben links siehst du, wann die Daten zuletzt aktualisiert wurden.</li>
                </ul>

                <h4 style="color: #94a3b8; margin-top: 20px;">2. Ligen & Tabellen</h4>
                <ul style="padding-left: 20px; line-height: 1.6;">
                    <li><strong>Tabelle</strong>: Die aktuelle Rangliste.</li>
                    <li><strong>Ergebnisse</strong>: Alle Spieltage und Match-Details (klicke auf ein Match für Details).</li>
                    <li><strong>Einzelkritik</strong>: Klicke auf einen Spieler in der Tabelle, um seine persönlichen Stats zu sehen.</li>
                </ul>

                <h4 style="color: #94a3b8; margin-top: 20px;">3. Vereinsseiten</h4>
                <ul style="padding-left: 20px; line-height: 1.6;">
                    <li><strong>Quick Stats</strong>: Überblick über Mitgliederzahl, aktive Ligen und Gesamtpunkte.</li>
                    <li><strong>Details</strong>: Adresse, Kontaktinfos und Link zum Spielort.</li>
                    <li><strong>Kader</strong>: Liste aller Spieler mit aktueller Liga und Rang.</li>
                    <li><strong>Archiv</strong>: Historie des Vereins aus vergangenen Saisons.</li>
                </ul>

                <h4 style="color: #94a3b8; margin-top: 20px;">4. Spieler-Profile</h4>
                <ul style="padding-left: 20px; line-height: 1.6;">
                    <li><strong>Formkurve</strong>: Die letzten Spiele und Trend.</li>
                    <li><strong>Saisonverlauf</strong>: Detaillierte Liste aller gespielten Runden.</li>
                    <li><strong>Head-to-Head</strong>: Vergleiche diesen Spieler direkt mit einem anderen.</li>
                </ul>

                <hr style="border-color: #334155; margin: 30px 0;">

                <h3 style="color: #f8fafc;">🛠️ Tools & Features</h3>

                <h4 style="color: #94a3b8; margin-top: 20px;">⚔️ H2H Vergleich</h4>
                <p>Vergleiche zwei Spieler direkt miteinander: Titel, Erfahrung, Form.</p>

                <h4 style="color: #94a3b8; margin-top: 20px;">🎯 Match Scorer</h4>
                <ul style="padding-left: 20px; line-height: 1.6;">
                    <li><strong>Verschiedene Modi</strong>: Spiele 1vs1 (Single Out), Double Out, Master Out oder <strong>Liga (2vs2)</strong>.</li>
                    <li><strong>Liga-Modus</strong>: Spezieller 2vs2 Modus mit Block-Regel.</li>
                    <li><strong>Spracheingabe</strong>: Scorer per Stimme ("Hundertachtzig").</li>
                    <li><strong>Dartboard-Input</strong>: Tippe auf das Board.</li>
                    <li><strong>Checkout-Hilfe</strong>: Wege zum Finish (z.B. T20 - D20).</li>
                </ul>

                <h4 style="color: #94a3b8; margin-top: 20px;">📱 Installation (App)</h4>
                <p>Installiere diese Seite als App auf deinem Homescreen (iOS/Android), um sie wie eine normale App zu nutzen.</p>

                <hr style="border-color: #334155; margin: 30px 0;">

                <h3 style="color: #f8fafc;">❓ FAQ</h3>
                <p><strong>Wie oft werden die Daten aktualisiert?</strong><br>
                Die Webseite und App werden automatisch <strong>alle 6 Stunden</strong> aktualisiert. Der "Aktualisieren"-Button im Menü prüft nur, ob neue Daten auf dem Server bereitliegen.</p>
                <p><em>Ein manuelles Datenupdate kann nur von den Repository-Verantwortlichen über den GitHub-Actions-Workflow ausgelöst werden, nicht aus der App.</em></p>

                <p><strong>Kann ich alte Saisons sehen?</strong><br>
                Ja, im "Archiv" auf den Vereins- und Spielerseiten.</p>
            </div>
            <div style="text-align: center; margin-top: 20px; color: #64748b; font-size: 0.8em;">
                <a href="https://github.com/tobias-rohde-93/BWEDL-Stats/wiki" target="_blank" style="color: #64748b; text-decoration: underline;">
                    Doku auch auf GitHub ansehen
                </a>
            </div>
        `;

        contentArea.appendChild(container);
    }
});
