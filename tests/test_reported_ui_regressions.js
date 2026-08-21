const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'bundle_v31.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'sw_v31.js'), 'utf8');
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

function compileFunction(name, dependencies = {}) {
    const functionStart = source.indexOf(`function ${name}(`);
    assert.notEqual(functionStart, -1, `Expected function ${name} to exist`);
    const openingBrace = source.indexOf('{', functionStart);
    const declaration = source.slice(functionStart, findClosingBrace(openingBrace, name) + 1);
    const names = Object.keys(dependencies);
    return Function(...names, `${declaration}; return ${name};`)(
        ...names.map((dependency) => dependencies[dependency]),
    );
}

const selectedGame = {
    league: 'A-Klasse Gruppe 1 2025-2026',
    home: 'DC Heim',
    away: 'DC Gast',
    dateStr: 'Freitag, 29.08.2025 20:00',
};
const detectedGame = {
    ...selectedGame,
    dateStr: '29.08.2025 20:00',
};
test('match preview deduplicates equivalent dates with and without weekday', () => {
    assert.deepEqual(
        BwedlAppUtils.mergeMatchPreviewGames(selectedGame, [detectedGame]),
        [selectedGame],
        'a dashboard handoff and its detected copy must be shown only once',
    );
});

const normalizeFavorites = compileFunction('normalizeFavorites', {
    canonicalClubId: (value, count) => Number.isInteger(Number(value)) && Number(value) < count
        ? Number(value)
        : null,
});
const storedFavorites = [
    { type: 'league', id: 'Removed League', name: 'Removed League' },
    { type: 'league', id: 'Current League', name: 'Current League' },
    { type: 'ligapokalArchive', id: 'Ligapokal 2025-2026', name: 'Ligapokal 2025-2026' },
    { type: 'club', id: '1', name: 'Current Club' },
];
test('stale non-club favorites are pruned and missing leagues are guarded', () => {
    assert.deepEqual(
        normalizeFavorites(storedFavorites, 3, (type, id) => (
            (type === 'league' && id === 'Current League') ||
            (type === 'ligapokalArchive' && id === 'Ligapokal 2025-2026')
        )),
        [storedFavorites[1], storedFavorites[2], { ...storedFavorites[3], id: 1 }],
        'stale non-club favorites must be removed while valid routes and clubs survive',
    );
    assert.match(source, /if \(!data\)\s*\{[\s\S]*setAppStatus\(/, 'renderLeague must handle a missing league defensively');
});

test('current Ligapokal menu entry is derived once from archive tables', () => {
    const cupEntries = BwedlAppUtils.buildLigapokalArchiveEntries([
        { season: '2025/2026', league: 'LIGAPOKAL 2025-2026', rows: [['Heim', 'Gast'], ['A', 'B']] },
        { season: '2025/2026', league: 'LIGAPOKAL 2025-2026', rows: [['Heim', 'Gast'], ['C', 'D']] },
        { season: '2025/2026', league: 'A-Klasse 2025-2026', rows: [['Platz', 'Team'], ['1', 'A']] },
    ]);
    assert.deepEqual(Object.keys(cupEntries), ['Ligapokal 2025-2026']);
    assert.equal(cupEntries['Ligapokal 2025-2026'].tables.length, 2);
    assert.match(source, /buildLigapokalArchiveEntries\(window\.ARCHIVE_TABLES/);
    assert.match(source, /data\.tables/);
});

const previewSource = source.slice(
    source.indexOf('function renderMatchPreview('),
    source.indexOf('// Logic', source.indexOf('function renderMatchPreview(')),
);
test('match preview cards expose a dedicated native selection button', () => {
    assert.match(previewSource, /const loadButton = document\.createElement\('button'\)/);
    assert.match(previewSource, /loadButton\.type = 'button'/);
    assert.match(previewSource, /loadButton\.className = 'load-btn'/);
    assert.match(previewSource, /loadButton\.classList\.add\('match-preview-card__select'\)/);
    assert.match(previewSource, /appendText\(loadButton, 'span', 'Partie ausw\u00e4hlen', 'match-preview-card__status'\)/);
    assert.doesNotMatch(previewSource, /loadButton\.textContent\s*=/);
    assert.match(previewSource, /loadButton\.addEventListener\('click'/);
    assert.doesNotMatch(previewSource, /cardWrap\.onclick\s*=/);
    assert.match(previewSource, /mergeMatchPreviewGames\(selectedMatch, detectedMatches\)/);
});

test('historical match preview preserves global affiliation evidence and ranking season', () => {
    const renderer = source.slice(
        source.indexOf('function renderMatchPreview('),
        source.indexOf('window.triggerUpdate'),
    );
    assert.match(renderer, /currentPlayers:\s*rankingData\.players \|\| \[\]/);
    assert.match(renderer, /dataStatus\.domains\.rankings/);
    assert.match(renderer, /currentDatasetSeason,/);
    assert.doesNotMatch(renderer, /currentDatasetSeason:\s*league/);
    assert.match(renderer, /manual:\s*true/);
    assert.match(renderer, /previewModelApi\.completeLineup\(Array\.from\(selectedA\)/);
    assert.match(renderer, /selectedA = new Set\(playersA\.slice\(0, 4\)\)/);
    assert.match(renderer, /player\.sourceClasses/);
    assert.match(renderer, /player\.sourceSeasons/);
    assert.match(renderer, /rosterA\.targetClass/);
    assert.doesNotMatch(renderer, /historicalPrior\.seasons|historicalPrior\.segments/,
        'the UI consumes only fixed model-returned provenance arrays');
});

test('match preview offers current table teams without ranking rows', () => {
    const teams = BwedlAppUtils.buildMatchPreviewTeams(
        [],
        ['Tabelle', 'DC SchÃ¶mbergerEck', 'Heavy Weights BrÃ¶tzingen', 'Spielfrei'],
        [{ number: '42', name: 'DC SchÃ¶mbergerEck' }],
    );
    assert.deepEqual(teams, [
        { id: '42', name: 'DC SchÃ¶mbergerEck' },
        { id: 'NAME:Heavy Weights BrÃ¶tzingen', name: 'Heavy Weights BrÃ¶tzingen' },
    ]);
});

test('match preview team builder prefers an exact table name before squad substrings', () => {
    assert.deepEqual(BwedlAppUtils.buildMatchPreviewTeams(
        [{ v_nr: '42', company: 'DC Texas Team' }],
        ['DC Texas Team 2', 'DC Texas Team'],
        [{ number: '42', name: 'DC Texas Team' }],
    ), [
        { id: '42', name: 'DC Texas Team' },
        { id: 'NAME:DC Texas Team 2', name: 'DC Texas Team 2' },
    ]);
});

test('match preview auto-fill reports success only after both teams resolve', () => {
    const findTeamOptionMatchPreview = compileFunction('findTeamOptionMatchPreview', {
        normMatchPreview: (value) => String(value || '').toLocaleLowerCase('de-DE').trim(),
    });
    const statuses = [];
    const button = { textContent: 'Partie auswÃ¤hlen', style: {} };
    const banner = { style: {}, querySelector: () => button };
    const select = (options) => ({
        value: '',
        options,
        dispatchEvent() {},
    });
    const homeSelect = select([{ value: '42', textContent: 'DC SchÃ¶mbergerEck' }]);
    const awaySelect = select([{ value: '', textContent: '-- Team wÃ¤hlen --' }]);
    let loadCalls = 0;
    const applyMatchSelectorAutoFill = compileFunction('applyMatchSelectorAutoFill', {
        findTeamOptionMatchPreview,
        setTimeout: (callback) => callback(),
        Event: class Event {},
        setAppStatus: (message) => statuses.push(message),
    });
    applyMatchSelectorAutoFill(false, {
        league: 'B-Klasse Gruppe 2 2026-2027',
        home: 'DC SchÃ¶mbergerEck',
        away: 'Heavy Weights BrÃ¶tzingen',
    }, {
        leagueSelect: select([]),
        teamASelect: homeSelect,
        teamBSelect: awaySelect,
        banner,
        updateExclusions() {},
        loadSelection() { loadCalls += 1; },
    });
    assert.equal(loadCalls, 0);
    assert.notEqual(banner.style.borderColor, '#22c55e');
    assert.notEqual(button.style.background, '#22c55e');
    assert.match(statuses.at(-1), /nicht vollst\u00e4ndig/i);
});

test('match preview prefers exact team options over fuzzy squad matches', () => {
    const findTeamOptionMatchPreview = compileFunction('findTeamOptionMatchPreview', {
        normMatchPreview: (value) => String(value || '').toLocaleLowerCase('de-DE').trim(),
    });
    const select = {
        options: [
            { value: '42', textContent: 'DC Texas Team' },
            { value: '43', textContent: 'DC Texas Team 2' },
        ],
    };
    assert.equal(findTeamOptionMatchPreview(select, 'DC Texas Team'), '42');
    assert.equal(findTeamOptionMatchPreview(select, 'DC Texas Team 2'), '43');
});

test('match preview rejects an auto-fill that resolves both teams to the same option', () => {
    const statuses = [];
    const button = { textContent: 'Partie auswÃ¤hlen', style: {} };
    const banner = { style: {}, querySelector: () => button };
    const sharedOptions = [{ value: '42', textContent: 'DC Texas Team' }];
    const select = (value = '', options = []) => ({ value, options, dispatchEvent() {} });
    let loadCalls = 0;
    const applyMatchSelectorAutoFill = compileFunction('applyMatchSelectorAutoFill', {
        findTeamOptionMatchPreview: () => '42',
        setTimeout: (callback) => callback(),
        Event: class Event {},
        setAppStatus: (message) => statuses.push(message),
    });
    applyMatchSelectorAutoFill(false, {
        league: 'B-Klasse Gruppe 2 2026-2027',
        home: 'DC Texas Team',
        away: 'DC Texas Team 2',
    }, {
        leagueSelect: select('B-Klasse Gruppe 2 2026-2027'),
        teamASelect: select('', sharedOptions),
        teamBSelect: select('', sharedOptions),
        banner,
        updateExclusions() {},
        loadSelection() { loadCalls += 1; },
    });
    assert.equal(loadCalls, 0);
    assert.notEqual(banner.style.borderColor, '#22c55e');
    assert.match(statuses.at(-1), /nicht vollst\u00e4ndig/i);
});

test('match preview creates team options with safe DOM text APIs', () => {
    const populateStart = source.indexOf('const populate = (select) =>');
    const populateSource = source.slice(populateStart, source.indexOf('populate(teamASelect)', populateStart));
    assert.doesNotMatch(populateSource, /select\.innerHTML\s*\+=/);
    assert.match(populateSource, /document\.createElement\('option'\)/);
    assert.match(populateSource, /option\.value\s*=\s*team\.id/);
    assert.match(populateSource, /option\.textContent\s*=\s*team\.name/);
});

test('match preview auto-fill abandons delayed work after its generation is invalidated', () => {
    const pendingTimers = [];
    const button = { textContent: 'Partie auswählen', style: {} };
    const banner = { style: {}, querySelector: () => button };
    const select = (options = []) => ({ value: '', options, dispatchEvent() {} });
    let valid = true;
    let loadCalls = 0;
    const applyMatchSelectorAutoFill = compileFunction('applyMatchSelectorAutoFill', {
        findTeamOptionMatchPreview: () => '42',
        setTimeout: (callback) => pendingTimers.push(callback),
        Event: class Event {},
        setAppStatus() {},
    });
    applyMatchSelectorAutoFill(true, {
        league: 'B-Klasse Gruppe 2 2026-2027',
        home: 'DC Texas Team',
        away: 'DC Texas Team 2',
    }, {
        leagueSelect: select(),
        teamASelect: select([{ value: '42', textContent: 'DC Texas Team' }]),
        teamBSelect: select([{ value: '43', textContent: 'DC Texas Team 2' }]),
        banner,
        canApply: () => valid,
        updateExclusions() {},
        loadSelection() { loadCalls += 1; },
    });
    assert.equal(pendingTimers.length, 1);
    valid = false;
    pendingTimers[0]();
    assert.equal(loadCalls, 0);
    assert.notEqual(banner.style.borderColor, '#22c55e');
    assert.equal(button.textContent, 'Partie auswählen');
});

test('match preview auto-fill scopes only its own selector mutations as internal', () => {
    const select = (options = []) => ({ value: '', options, dispatchEvent() {} });
    let internalRuns = 0;
    let loadCalls = 0;
    const applyMatchSelectorAutoFill = compileFunction('applyMatchSelectorAutoFill', {
        findTeamOptionMatchPreview: (_select, name) => name === 'Alpha' ? '035' : '036',
        setTimeout: (callback) => callback(),
        Event: class Event {},
        setAppStatus() {},
    });
    applyMatchSelectorAutoFill(true, {
        league: 'B-Klasse 2026-2027',
        home: 'Alpha',
        away: 'Bravo',
    }, {
        leagueSelect: select(),
        teamASelect: select([{ value: '035', textContent: 'Alpha' }]),
        teamBSelect: select([{ value: '036', textContent: 'Bravo' }]),
        banner: null,
        runInternalChange(callback) { internalRuns += 1; callback(); },
        updateExclusions() {},
        loadSelection() { loadCalls += 1; },
    });
    assert.equal(internalRuns, 2);
    assert.equal(loadCalls, 1);
});

test('match preview form keeps numeric zero rounds for current and historical evidence', () => {
    const getPlayerFormTrend = compileFunction('getPlayerFormTrend');
    assert.deepEqual(getPlayerFormTrend({
        evidence: 'current',
        rounds: { R1: 0, R2: 44 },
    }).values, [0, 44]);
    assert.deepEqual(getPlayerFormTrend({
        evidence: 'historical',
        rounds: { R1: 0, R2: 39 },
    }).values, [0, 39]);
});

test('Vereine disclosure groups indicator and peer-sized label on the left', () => {
    assert.match(styles, /\.club-sidebar-disclosure\s*\{[^}]*justify-content:\s*flex-start;/s);
    assert.match(styles, /\.club-sidebar-disclosure\s*\{[^}]*gap:\s*0\.4rem;/s);
    assert.match(styles, /\.club-sidebar-disclosure::before\s*\{[^}]*content:\s*['"]\u25b6['"];/s);
});

test('changed static assets use coherent cache keys', () => {
    for (const asset of ['style.css?v=10', 'archive_data.js?v=9', 'app_utils.js?v=4', 'match_preview_model.js?v=2', 'bundle_v31.js?v=4.1']) {
        assert.ok(index.includes(asset), `index must load ${asset}`);
        assert.ok(worker.includes(`'./${asset}'`), `service worker must cache ${asset}`);
    }
    assert.match(worker, /bwedl-dashboard-v44/);
});
