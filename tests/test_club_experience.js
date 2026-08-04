const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'bundle_v31.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const BwedlAppUtils = require('../app_utils.js');

function findClosingBrace(openingBrace, label) {
    let depth = 0;
    let state = 'code';
    for (let index = openingBrace; index < source.length; index += 1) {
        const character = source[index];
        const nextCharacter = source[index + 1];
        if (state === 'line-comment') {
            if (character === '\n') state = 'code';
            continue;
        }
        if (state === 'block-comment') {
            if (character === '*' && nextCharacter === '/') {
                state = 'code';
                index += 1;
            }
            continue;
        }
        if (state !== 'code') {
            if (character === '\\') index += 1;
            else if (
                (state === 'single' && character === "'") ||
                (state === 'double' && character === '"') ||
                (state === 'template' && character === '`')
            ) state = 'code';
            continue;
        }
        if (character === '/' && nextCharacter === '/') {
            state = 'line-comment';
            index += 1;
        } else if (character === '/' && nextCharacter === '*') {
            state = 'block-comment';
            index += 1;
        } else if (character === "'") state = 'single';
        else if (character === '"') state = 'double';
        else if (character === '`') state = 'template';
        else if (character === '{') depth += 1;
        else if (character === '}') {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    assert.fail(`Expected ${label} to have a complete declaration`);
}

function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `Expected function ${name} to exist`);
    const openingBrace = source.indexOf('{', start);
    return source.slice(start, findClosingBrace(openingBrace, name) + 1);
}

function compileFunction(name, dependencies = {}) {
    const names = Object.keys(dependencies);
    return Function(...names, `${extractFunction(name)}; return ${name};`)(
        ...names.map((key) => dependencies[key]),
    );
}

function createDocument() {
    const byId = new Map();
    class Element {
        constructor(tagName) {
            this.tagName = tagName.toUpperCase();
            this.children = [];
            this.attributes = {};
            this.listeners = {};
            this.style = {};
            this.hidden = false;
            this.value = '';
            this.className = '';
            this._id = '';
            this._textContent = '';
            this.classList = {
                add: (...names) => {
                    const classes = new Set(this.className.split(/\s+/).filter(Boolean));
                    names.forEach((name) => classes.add(name));
                    this.className = [...classes].join(' ');
                },
                contains: (name) => this.className.split(/\s+/).includes(name),
            };
        }
        set id(value) {
            this._id = value;
            if (value) byId.set(value, this);
        }
        get id() { return this._id; }
        set textContent(value) { this._textContent = String(value); }
        get textContent() {
            return this._textContent + this.children.map((child) => child.textContent).join('');
        }
        set innerHTML(value) { this._innerHTML = String(value); this.usedInnerHTML = true; }
        get innerHTML() { return this._innerHTML || ''; }
        appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
        append(...children) { children.forEach((child) => this.appendChild(child)); }
        replaceChildren(...children) { this.children = []; this.append(...children); }
        setAttribute(name, value) { this.attributes[name] = String(value); }
        getAttribute(name) { return this.attributes[name] ?? null; }
        addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
        dispatch(type, init = {}) {
            const event = {
                key: '',
                target: this,
                currentTarget: this,
                preventDefault() { this.defaultPrevented = true; },
                stopPropagation() {},
                ...init,
            };
            (this.listeners[type] || []).forEach((listener) => listener(event));
            return event;
        }
        focus() { this.focused = true; }
    }
    return {
        createElement: (tagName) => new Element(tagName),
        createElementNS: (_namespace, tagName) => new Element(tagName),
        getElementById: (id) => byId.get(id) || null,
    };
}

function descendants(root) {
    return [root, ...root.children.flatMap(descendants)];
}

const document = createDocument();
const clubs = [
    { name: 'DC Nord', venue: 'Sportheim', street: 'Talstraße 5', city: 'Pforzheim' },
    { name: 'Flying Arrows', venue: 'Alte Mühle', street: 'Hauptweg 1', city: 'Calw' },
    { name: '<img src=x onerror=alert(1)>', city: 'Testort' },
    ...Array.from({ length: 7 }, (_, index) => ({ name: `Verein ${index + 4}`, city: 'Enzkreis' })),
];
const clubData = { clubs };
const navigationCalls = [];
const navigateTo = (type, id) => navigationCalls.push([type, id]);

const archiveContext = { window: {} };
vm.createContext(archiveContext);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'archive_tables.js'), 'utf8'), archiveContext);
const currentCupTables = archiveContext.window.ARCHIVE_TABLES.filter((table) => (
    table.season === '2025/2026' && String(table.league).toLowerCase().includes('ligapokal')
));
const currentCupRows = currentCupTables.flatMap((table) => table.rows.slice(1).map((row) => ({
    headers: table.rows[0],
    row,
})));
assert.equal(currentCupRows.length, 80, 'current archive fixture contains the audited cup rows');
const parseArchiveMatchRow = compileFunction('parseArchiveMatchRow');
currentCupRows.forEach(({ headers, row }) => {
    const parsed = parseArchiveMatchRow(headers, row);
    assert.deepEqual(
        [parsed.dateStr, parsed.home, parsed.away, parsed.result],
        [row[1], row[3], row[4], row[5]],
    );
});

const statusContext = { window: {} };
vm.createContext(statusContext);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'data_status.js'), 'utf8'), statusContext);
const rankingStatus = statusContext.window.DATA_STATUS.domains.rankings;
const clubRankingSeasonLabel = compileFunction('clubRankingSeasonLabel');
assert.equal(
    clubRankingSeasonLabel(rankingStatus),
    'Rangliste 2025/26 (letzte vollständige Saison)',
);
const createClubRankingSeasonNotice = compileFunction('createClubRankingSeasonNotice', {
    document,
    clubRankingSeasonLabel,
});
const rankingNotice = createClubRankingSeasonNotice(rankingStatus);
assert.equal(rankingNotice.getAttribute('role'), 'note');
assert.equal(rankingNotice.textContent, 'Rangliste 2025/26 (letzte vollständige Saison)');

const createClubRankingStatsRow = compileFunction('createClubRankingStatsRow', { document });
const rankingStats = createClubRankingStatsRow(2, 1, 42);
const createClubRankingSection = compileFunction('createClubRankingSection', {
    document,
    createClubRankingSeasonNotice,
});
const rankingGrid = document.createElement('div');
rankingGrid.textContent = 'Spielerliste';
const retainedRankingSection = createClubRankingSection(rankingStatus, rankingStats, rankingGrid, 2);
assert.equal(retainedRankingSection.getAttribute('aria-labelledby'), 'club-ranking-season-label');
assert.equal(descendants(retainedRankingSection).filter((element) => element.classList.contains('club-ranking-season-notice')).length, 1);
assert.match(retainedRankingSection.textContent, /Rangliste 2025\/26 \(letzte vollständige Saison\).*2Spieler.*1Ligen.*42Punkte \(Ges\.\).*Mannschaft \(2\).*Spielerliste/);
for (const state of ['current', 'published']) {
    const currentGrid = document.createElement('div');
    currentGrid.textContent = 'Aktuelle Spielerliste';
    const section = createClubRankingSection(
        { state, season: '2026/27' },
        createClubRankingStatsRow(3, 2, 60),
        currentGrid,
        3,
    );
    assert.equal(section.children[0].id, 'club-ranking-season-label');
    assert.equal(section.children[0].getAttribute('role'), 'note');
    assert.match(section.textContent, /^Rangliste 2026\/27.*3Spieler.*2Ligen.*60Punkte \(Ges\.\).*Mannschaft \(3\).*Aktuelle Spielerliste/);
    assert.doesNotMatch(section.textContent, /letzte vollständige Saison/);
}

class SafeTableDOMParser {
    parseFromString(value, type) {
        assert.equal(value, maliciousTableHtml);
        assert.equal(type, 'text/html');
        return {
            querySelectorAll(selector) {
                assert.equal(selector, 'tr');
                return [
                    { children: [
                        { tagName: 'TH', textContent: 'Team<script>alert(1)</script>' },
                        { tagName: 'TH', textContent: 'Punkte' },
                    ] },
                    { children: [
                        { tagName: 'TD', textContent: 'DC Nord <img src=x onerror=alert(2)>' },
                        { tagName: 'TD', textContent: '42' },
                    ] },
                ];
            },
        };
    }
}
const maliciousLeagueName = '<img src=x onerror=alert(3)>';
const maliciousTableHtml = '<table onclick="alert(4)"><tr><th>Team<script>alert(1)</script></th><th>Punkte</th></tr><tr><td onmouseover="alert(5)">DC Nord &lt;img src=x onerror=alert(2)&gt;</td><td>42</td></tr></table>';
const createSafeLeagueTableSection = compileFunction('createSafeLeagueTableSection', {
    document,
    DOMParser: SafeTableDOMParser,
});
const safeLeagueTable = createSafeLeagueTableSection(
    maliciousLeagueName,
    maliciousTableHtml,
    'DC Nord',
    (clubName, value) => String(value).includes(clubName),
);
assert.match(safeLeagueTable.textContent, /<img src=x onerror=alert\(3\)>/);
assert.match(safeLeagueTable.textContent, /Team<script>alert\(1\)<\/script>/);
assert.match(safeLeagueTable.textContent, /DC Nord <img src=x onerror=alert\(2\)>/);
assert.equal(descendants(safeLeagueTable).some((element) => element.usedInnerHTML), false);
assert.equal(descendants(safeLeagueTable).some((element) => ['SCRIPT', 'IMG', 'A', 'STYLE'].includes(element.tagName)), false);
assert.equal(descendants(safeLeagueTable).some((element) => Object.keys(element.attributes).some((name) => /^on/i.test(name))), false);
assert.equal(descendants(safeLeagueTable).filter((element) => element.tagName === 'TH').length, 2);
assert.equal(descendants(safeLeagueTable).filter((element) => element.tagName === 'TD').length, 2);

const createPlayerFormElement = compileFunction('createPlayerFormElement', { document });
const createClubPlayerCard = compileFunction('createClubPlayerCard', {
    document,
    createPlayerFormElement,
});
const safePlayerCard = createClubPlayerCard({
    name: '<img src=x onerror=alert(6)>',
    league: '<svg onload=alert(7)>',
    rank: '<script>alert(8)</script>',
    points: '<a href=javascript:alert(9)>9</a>',
    rounds: { R1: '1" onload="alert(10)', R2: 2 },
}, '#94a3b8');
assert.match(safePlayerCard.textContent, /<img src=x onerror=alert\(6\)>/);
assert.match(safePlayerCard.textContent, /<svg onload=alert\(7\)>/);
assert.match(safePlayerCard.textContent, /<script>alert\(8\)<\/script>/);
assert.match(safePlayerCard.textContent, /<a href=javascript:alert\(9\)>9<\/a>/);
assert.equal(descendants(safePlayerCard).some((element) => element.usedInnerHTML), false);
assert.equal(descendants(safePlayerCard).some((element) => ['SCRIPT', 'IMG', 'A', 'STYLE'].includes(element.tagName)), false);
assert.equal(descendants(safePlayerCard).some((element) => Object.keys(element.attributes).some((name) => /^on/i.test(name))), false);

const canonicalClubId = compileFunction('canonicalClubId');
const normalizeClubIdList = compileFunction('normalizeClubIdList', { canonicalClubId });
assert.deepEqual(
    normalizeClubIdList([null, false, '', 1.2, -1, 99, '01', '2', 2, 0, 0], 3, 5),
    [2, 0],
);
const normalizeFavorites = compileFunction('normalizeFavorites', { canonicalClubId });
const normalizedFavorites = normalizeFavorites([
    { type: 'league', id: 'A-Klasse', name: 'A-Klasse' },
    { type: 'club', id: null, name: 'bad null' },
    { type: 'club', id: '2', name: 'Club 2' },
    { type: 'club', id: 2, name: 'duplicate' },
    { type: 'club', id: 5, name: 'out of range' },
], 3);
assert.deepEqual(normalizedFavorites.map(({ type, id }) => [type, id]), [
    ['league', 'A-Klasse'],
    ['club', 2],
]);
const readLocalArray = compileFunction('readLocalArray');
assert.deepEqual(readLocalArray({ getItem() { throw new Error('SecurityError'); } }, 'key'), []);
assert.deepEqual(readLocalArray({ getItem() { return '{bad'; } }, 'key'), []);
const persistLocalValue = compileFunction('persistLocalValue');
assert.equal(persistLocalValue({ setItem() { throw new Error('QuotaExceededError'); } }, 'key', []), false);
let sidebarRenders = 0;
const rememberRecentClub = compileFunction('rememberRecentClub', {
    canonicalClubId,
    clubData,
    recentClubIds: [],
    persistLocalValue,
    localStorage: { setItem() { throw new Error('QuotaExceededError'); } },
    RECENT_CLUBS_STORAGE_KEY: 'bwedl_recent_clubs',
    renderClubSidebarShortcuts: () => { sidebarRenders += 1; },
});
assert.doesNotThrow(() => rememberRecentClub('1'));
assert.equal(sidebarRenders, 1, 'storage failure does not abort navigation-side rendering');

const normalizeClubSearchText = compileFunction('normalizeClubSearchText');
const filterClubEntries = compileFunction('filterClubEntries', { normalizeClubSearchText });
assert.deepEqual(filterClubEntries(clubs, 'pforzheim'), [clubs[0]]);
assert.deepEqual(filterClubEntries(clubs, 'talstrasse'), [clubs[0]]);

const contentArea = document.createElement('main');
const topBarTitle = document.createElement('h1');
const renderClubList = compileFunction('renderClubList', {
    document,
    topBarTitle,
    contentArea,
    clubData,
    filterClubEntries,
    navigateTo,
});
renderClubList();
const overview = contentArea.children[0];
const search = document.getElementById('club-search');
const grid = descendants(overview).find((element) => element.classList.contains('club-overview-grid'));
assert.equal(grid.children.length, clubs.length, 'overview initially retains every club');
search.value = 'calw';
search.dispatch('input');
assert.equal(grid.children.length, 1, 'city search filters the rendered production DOM');
grid.children[0].dispatch('click');
assert.deepEqual(navigationCalls.pop(), ['club', 1]);
search.value = 'nord';
search.dispatch('input');
grid.children[0].dispatch('keydown', { key: 'Enter' });
assert.deepEqual(navigationCalls.pop(), ['club', 0]);
search.value = 'onerror';
search.dispatch('input');
assert.equal(grid.children.length, 1, 'malicious club fixture is selected explicitly');
const maliciousClubCard = grid.children[0];
assert.match(maliciousClubCard.textContent, /<img src=x onerror=alert\(1\)>/);
assert.equal(descendants(maliciousClubCard).some((element) => element.usedInnerHTML), false);
assert.equal(descendants(maliciousClubCard).some((element) => element.tagName === 'IMG'), false);
const originalSearch = search;
renderClubList();
assert.notEqual(document.getElementById('club-search'), originalSearch, 'rerender replaces the complete overview');
assert.equal(contentArea.children.length, 1, 'rerender leaves a single overview root');

const appendClubSidebarLink = compileFunction('appendClubSidebarLink', { document });
const clubSidebarContainer = document.createElement('div');
const renderClubSidebarShortcuts = compileFunction('renderClubSidebarShortcuts', {
    clubSidebarContainer,
    appendClubSidebarLink,
    navigateTo,
    document,
    favorites: [{ type: 'club', id: 1, name: clubs[1].name }],
    clubData,
    recentClubIds: [2],
});
renderClubSidebarShortcuts();
const sidebarButtons = descendants(clubSidebarContainer).filter((element) => element.tagName === 'BUTTON');
assert.deepEqual(sidebarButtons.map((button) => button.textContent), [
    'Vereinsübersicht', 'Verein suchen', clubs[1].name, clubs[2].name,
]);
assert.ok(sidebarButtons.length < clubs.length, 'sidebar does not reproduce the complete catalogue');
sidebarButtons[0].dispatch('click');
assert.deepEqual(navigationCalls.pop(), ['clubList', null]);

const createDisclosureButton = compileFunction('createDisclosureButton', { document });
const sidebarDisclosureContent = document.createElement('div');
const sidebarDisclosure = createDisclosureButton('Vereine', 'club-sidebar-shortcuts', sidebarDisclosureContent, false);
assert.equal(sidebarDisclosure.tagName, 'BUTTON');
assert.equal(sidebarDisclosure.getAttribute('aria-expanded'), 'false');
assert.equal(sidebarDisclosureContent.hidden, true);
sidebarDisclosure.dispatch('click');
assert.equal(sidebarDisclosure.getAttribute('aria-expanded'), 'true');
assert.equal(sidebarDisclosureContent.hidden, false);

const createDisclosureSection = compileFunction('createDisclosureSection', { document, createDisclosureButton });
const disclosureIds = [];
for (const [id, expanded] of [
    ['current-season-summary', true],
    ['club-league-history', false],
    ['club-cup-history', false],
]) {
    const body = document.createElement('div');
    const section = createDisclosureSection('Bereich', id, body, expanded);
    const trigger = descendants(section).find((element) => element.tagName === 'BUTTON');
    disclosureIds.push(trigger.getAttribute('aria-controls'));
    assert.equal(trigger.getAttribute('aria-controls'), id);
    assert.equal(trigger.getAttribute('aria-expanded'), String(expanded));
    assert.equal(body.hidden, !expanded);
    trigger.dispatch('click');
    assert.equal(body.hidden, expanded);
    assert.equal(trigger.getAttribute('aria-expanded'), String(!expanded));
}
assert.equal(new Set(disclosureIds).size, disclosureIds.length, 'disclosure controls remain unique');

const createGameActionsElement = compileFunction('createGameActionsElement', {
    document,
    gameShareText: (game) => `${game.home} gegen ${game.away}`,
    buildGameActions: () => [{
        key: 'preview',
        label: 'Match Preview',
        ariaLabel: 'Match Preview öffnen',
        activate() {},
    }],
});
const createClubMatchCard = compileFunction('createClubMatchCard', {
    document,
    isClubMatch: (clubName, team) => team === clubName,
    club: clubs[0],
    createGameActionsElement,
});
const maliciousGame = {
    dateStr: '<img src=x onerror=alert(1)>',
    leagueName: '<svg onload=alert(1)>',
    home: '<script>alert(1)</script>',
    away: 'DC Nord',
};
const safeMatchCard = createClubMatchCard(maliciousGame, 'upcoming');
assert.equal(descendants(safeMatchCard).some((element) => element.usedInnerHTML), false);
assert.equal(descendants(safeMatchCard).some((element) => ['IMG', 'SVG', 'SCRIPT'].includes(element.tagName)), false);
assert.match(safeMatchCard.textContent, /<script>alert\(1\)<\/script>/);
assert.equal(descendants(safeMatchCard).filter((element) => element.classList.contains('game-actions')).length, 1);

const createClubMatchesGrid = compileFunction('createClubMatchesGrid', {
    document,
    isClubMatch: (clubName, team) => team === clubName,
    club: clubs[0],
    createClubMatchCard,
    createGameActionsElement,
});
const rawSchedule = [
    ...Array.from({ length: 7 }, (_, index) => ({
        home: index % 2 ? 'DC Nord' : `Gast ${index}`,
        away: index % 2 ? `Gast ${index}` : 'DC Nord',
        dateStr: `0${index + 2}.09.2026 20:00`,
        leagueName: 'A-Klasse',
        isPending: true,
    })),
    { home: 'DC Nord', away: 'Freilos', dateStr: '01.09.2026 20:00', isPending: true },
];
const upcoming = BwedlAppUtils.selectUpcomingGames(rawSchedule, new Date(2026, 7, 31));
assert.equal(upcoming.length, 7, 'real selector excludes byes before club rendering');
const matchesGrid = createClubMatchesGrid(upcoming, [], '');
const upcomingList = descendants(matchesGrid).find((element) => element.classList.contains('club-upcoming-list'));
const expansion = descendants(matchesGrid).find((element) => element.classList.contains('club-upcoming-toggle'));
assert.equal(upcomingList.children.length, 5, 'five real games render by default');
assert.equal(descendants(upcomingList).filter((element) => element.classList.contains('game-actions')).length, 5);
assert.equal(expansion.getAttribute('aria-expanded'), 'false');
assert.equal(expansion.getAttribute('aria-controls'), upcomingList.id);
expansion.dispatch('click');
assert.equal(upcomingList.children.length, 7, 'expansion restores every real game');
assert.equal(expansion.getAttribute('aria-expanded'), 'true');
assert.equal(expansion.textContent, 'Weniger anzeigen');
const cupMatchesGrid = createClubMatchesGrid(upcoming, [], '🏆 Ligapokal - ');
const cupUpcomingList = descendants(cupMatchesGrid).find((element) => element.classList.contains('club-upcoming-list'));
assert.notEqual(cupUpcomingList.id, upcomingList.id, 'league and cup match controls use unique IDs');

const archiveMatchDisplayState = compileFunction('archiveMatchDisplayState');
const falseIncompleteRows = currentCupRows.filter(({ headers, row }) => {
    const parsed = parseArchiveMatchRow(headers, row);
    const [scoreHome, scoreAway] = parsed.result.split(':').map((value) => value.trim());
    return archiveMatchDisplayState({ ...parsed, scoreHome, scoreAway }, true).incomplete;
});
assert.equal(falseIncompleteRows.length, 0, 'all 80 complete current cup rows stay complete');
assert.deepEqual(
    archiveMatchDisplayState({ home: 'DC Nord', away: '', scoreHome: '', scoreAway: '' }, true),
    { incomplete: true, label: 'Daten unvollständig' },
);
assert.deepEqual(
    archiveMatchDisplayState({ home: 'Freilos', away: 'Freilos', isFreilos: true }, true),
    { incomplete: false, label: 'Freilos' },
);
const createArchiveMatchResult = compileFunction('createArchiveMatchResult', {
    document,
    archiveMatchDisplayState,
});
const incompleteResult = createArchiveMatchResult(
    { home: 'DC Nord', away: '', scoreHome: '', scoreAway: '' },
    true,
);
assert.equal(incompleteResult.tagName, 'SPAN');
assert.equal(incompleteResult.textContent, 'Daten unvollständig');
assert.equal(incompleteResult.getAttribute('role'), 'status');
assert.equal(incompleteResult.classList.contains('incomplete-data'), true);
const escapeHtmlText = compileFunction('escapeHtmlText');
assert.equal(
    escapeHtmlText('<img src=x onerror="alert(1)">&'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;',
);

const clubSidebarBlock = source.slice(source.indexOf('// 3. Clubs'), source.indexOf('// 4. Comparison'));
assert.match(clubSidebarBlock, /createDisclosureButton/);
assert.doesNotMatch(clubSidebarBlock, /createElement\(['"]div['"]\)[\s\S]*?header\.addEventListener\(['"]click['"]/);
const clubSource = extractFunction('renderClub');
assert.match(clubSource, /createDisclosureSection\(\s*['"]Vereinsinfos & Kontakt['"]/);
assert.doesNotMatch(clubSource, /onclick="this\.nextElementSibling/);
assert.doesNotMatch(source, /selectUpcomingGames\(upcoming(?:League|Ligapokal)Matches,[^;\r\n]*\)\.slice\(0, 5\)/);
assert.match(styles, /\.club-sidebar-disclosure\s*\{[^}]*border:\s*0;/s);
assert.match(styles, /\.club-upcoming-toggle/);
assert.match(styles, /\.club-contact-grid/);
assert.match(styles, /\.archive-freilos/);
assert.match(styles, /\.club-ranking-season-notice/);
const renderClubSource = extractFunction('renderClub');
assert.doesNotMatch(renderClubSource, /currentSeasonContent\.appendChild\(playerSection\)/);
assert.doesNotMatch(renderClubSource, /container\.appendChild\(statsRow\)/);
assert.doesNotMatch(renderClubSource, /\bpCard\.innerHTML|\btSec\.innerHTML/);
assert.match(renderClubSource, /createSafeLeagueTableSection/);
assert.match(renderClubSource, /createClubRankingSection/);
assert.match(renderClubSource, /container\.appendChild\(playerSection\)/);

console.log('club experience production DOM contracts passed');
