const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'bundle_v31.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

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

const normalizeClubSearchText = compileFunction('normalizeClubSearchText');
const filterClubEntries = compileFunction('filterClubEntries', { normalizeClubSearchText });
const clubs = [
    { name: 'DC Nord', venue: 'Sportheim', street: 'Talstraße 5', city: 'Pforzheim' },
    { name: 'Flying Arrows', venue: 'Alte Mühle', street: 'Hauptweg 1', city: 'Calw' },
    { name: '<img src=x onerror=alert(1)>', city: 'Testort' },
];

assert.deepEqual(filterClubEntries(clubs, 'nord'), [clubs[0]], 'filters by club name');
assert.deepEqual(filterClubEntries(clubs, 'pforzheim'), [clubs[0]], 'filters by city');
assert.deepEqual(filterClubEntries(clubs, 'talstrasse'), [clubs[0]], 'normalizes address locality');
assert.deepEqual(filterClubEntries(clubs, 'alte mühle'), [clubs[1]], 'filters by venue/locality');
assert.deepEqual(filterClubEntries(clubs, '  '), clubs, 'empty query keeps the complete overview');

const clubListSource = extractFunction('renderClubList');
assert.match(clubListSource, /type\s*=\s*['"]search['"]/);
assert.match(clubListSource, /aria-label['"],\s*['"]Vereine nach Name oder Ort suchen['"]/);
assert.match(clubListSource, /addEventListener\(['"]keydown['"]/);
assert.match(clubListSource, /addEventListener\(['"]click['"]/);
assert.doesNotMatch(clubListSource, /\.innerHTML\s*=/, 'club overview must not interpolate club data via innerHTML');

const sidebarStart = source.indexOf('// 3. Clubs');
const sidebarEnd = source.indexOf('// 4. Comparison', sidebarStart);
const sidebarSource = `${source.slice(sidebarStart, sidebarEnd)}\n${extractFunction('renderClubSidebarShortcuts')}`;
assert.match(sidebarSource, /Vereinsübersicht/);
assert.match(sidebarSource, /Verein suchen/);
assert.match(sidebarSource, /Favoriten/);
assert.match(sidebarSource, /Zuletzt angesehen/);
assert.match(source, /bwedl_recent_clubs/);
assert.doesNotMatch(sidebarSource, /clubData\.clubs\.forEach/, 'sidebar must not render the complete club catalogue');

assert.match(source, /selectUpcomingGames\(upcomingLeagueMatches,[\s\S]*?\)\.slice\(0, 5\)/);
assert.match(source, /selectUpcomingGames\(upcomingLigapokalMatches,[\s\S]*?\)\.slice\(0, 5\)/);
assert.match(source, /createGameActionsElement\(m\)/, 'Task 4 game actions remain integrated');

const clubSource = extractFunction('renderClub');
assert.match(clubSource, /createDisclosureSection/);
assert.match(clubSource, /aria-expanded/);
assert.match(clubSource, /aria-controls/);
assert.match(clubSource, /current-season-summary/);
assert.match(clubSource, /club-league-history/);
assert.match(clubSource, /club-cup-history/);
assert.match(clubSource, /Daten unvollständig/);

assert.match(styles, /\.club-search/);
assert.match(styles, /\.club-overview-grid/);
assert.match(styles, /\.club-disclosure/);

console.log('club experience contracts passed');
