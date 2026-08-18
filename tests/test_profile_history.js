const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BwedlAppUtils = require('../app_utils.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'bundle_v31.js'), 'utf8');

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
            if (character === '\\') {
                index += 1;
            } else if (
                (state === 'single-quote' && character === "'") ||
                (state === 'double-quote' && character === '"') ||
                (state === 'template' && character === '`')
            ) {
                state = 'code';
            }
            continue;
        }

        if (character === '/' && nextCharacter === '/') {
            state = 'line-comment';
            index += 1;
        } else if (character === '/' && nextCharacter === '*') {
            state = 'block-comment';
            index += 1;
        } else if (character === "'") {
            state = 'single-quote';
        } else if (character === '"') {
            state = 'double-quote';
        } else if (character === '`') {
            state = 'template';
        } else if (character === '{') {
            depth += 1;
        } else if (character === '}') {
            depth -= 1;
            if (depth === 0) return index;
        }
    }

    assert.fail(`Expected ${label} to have a complete declaration`);
}

function extractAssignedArrow(name) {
    const declarationStart = source.indexOf(`const ${name} =`);
    assert.notEqual(declarationStart, -1, `Expected const ${name} to exist`);

    const assignment = source.indexOf('=', declarationStart);
    const arrowStart = source.indexOf('=>', assignment);
    assert.notEqual(arrowStart, -1, `Expected const ${name} to be an arrow function`);

    const openingBrace = source.indexOf('{', arrowStart);
    assert.notEqual(openingBrace, -1, `Expected const ${name} to have an opening brace`);
    const closingBrace = findClosingBrace(openingBrace, `const ${name}`);
    return source.slice(assignment + 1, closingBrace + 1).trim();
}

const setMyPlayerSource = extractAssignedArrow('setMyPlayer');

function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `Expected function ${name} to exist`);
    const openingBrace = source.indexOf('{', start);
    return source.slice(start, findClosingBrace(openingBrace, name) + 1);
}

const storeResolvedPlayerProfile = Function(
    `${extractFunction('storeResolvedPlayerProfile')}; return storeResolvedPlayerProfile;`,
)();
const clearStoredPlayerProfile = Function(
    `${extractFunction('clearStoredPlayerProfile')}; return clearStoredPlayerProfile;`,
)();

const players = [{
    id: '42',
    v_nr: '007',
    name: 'Public Player',
    league: 'A-Klasse',
    company: 'Public Team',
}];
const group = BwedlAppUtils.groupRankingPeople(players)[0];
const savedProfile = BwedlAppUtils.createPlayerProfile(group, 'A-Klasse|42', 'Public Team');

function createHarness(initialProfile) {
    const storageCalls = [];
    const historyCalls = [];
    const navigationCalls = [];
    const link = { textContent: '', style: {} };
    let directRenderCalls = 0;
    const values = new Map();

    const localStorage = {
        setItem(key, value) {
            storageCalls.push(['setItem', key, value]);
            values.set(key, value);
        },
        removeItem(key) {
            storageCalls.push(['removeItem', key]);
            values.delete(key);
        },
    };
    const document = {
        getElementById(id) {
            return id === 'my-profile-link' ? link : null;
        },
    };
    const history = {
        replaceState(state, title, url) {
            historyCalls.push([state, title, url]);
        },
    };
    const navigateTo = (...args) => navigationCalls.push(args);
    const renderDashboard = () => { directRenderCalls += 1; };
    const replaceWithIconLabel = (element, icon, label) => {
        element.textContent = `${icon} ${label}`;
    };
    const profile = new Function(
        'localStorage', 'document', 'history', 'navigateTo', 'renderDashboard',
        'replaceWithIconLabel', 'storeResolvedPlayerProfile', 'clearStoredPlayerProfile',
        'window', 'rankingData',
        `let myPlayerProfile = arguments[10];
         let myPlayerResolution = myPlayerProfile
            ? window.BwedlAppUtils.resolvePlayerProfile(rankingData.players, myPlayerProfile)
            : { status: 'missing', profile: null, group: null, player: null, records: [] };
         let myPlayerName = myPlayerProfile ? myPlayerProfile.name : null;
         let myTeamName = myPlayerProfile ? myPlayerProfile.teamName : null;
         let legacyProfileNeedsConfirmation = false;
         const applyPlayerResolution = (resolution) => {
            myPlayerResolution = resolution && resolution.status === 'resolved'
                ? resolution
                : { status: 'missing', profile: null, group: null, player: null, records: [] };
            myPlayerProfile = myPlayerResolution.profile;
            myPlayerName = myPlayerProfile ? myPlayerProfile.name : null;
            myTeamName = myPlayerProfile ? myPlayerProfile.teamName : null;
         };
         const setMyPlayer = ${setMyPlayerSource};
         return { setMyPlayer, getMyPlayerProfile: () => myPlayerProfile };`,
    )(
        localStorage, document, history, navigateTo, renderDashboard,
        replaceWithIconLabel, storeResolvedPlayerProfile, clearStoredPlayerProfile,
        { BwedlAppUtils }, { players }, initialProfile,
    );

    return {
        ...profile,
        storageCalls,
        historyCalls,
        navigationCalls,
        link,
        get directRenderCalls() {
            return directRenderCalls;
        },
    };
}

function assertDashboardReplacement(harness) {
    assert.deepEqual(harness.historyCalls, [[{ type: 'dashboard', id: null }, '', '#dashboard']]);
    assert.deepEqual(harness.navigationCalls, [['dashboard', null, false]]);
    assert.equal(harness.directRenderCalls, 0);
}

{
    const harness = createHarness(null);
    assert.equal(harness.setMyPlayer(savedProfile), true);

    assert.equal(harness.getMyPlayerProfile().recordKey, 'A-Klasse|42');
    assert.equal(harness.storageCalls[0][0], 'setItem');
    assert.equal(harness.storageCalls[0][1], BwedlAppUtils.PLAYER_PROFILE_STORAGE_KEY);
    assert.equal(JSON.parse(harness.storageCalls[0][2]).recordKey, 'A-Klasse|42');
    assert.deepEqual(harness.storageCalls.slice(1), [
        ['removeItem', 'myPlayerName'],
        ['removeItem', 'myTeamName'],
    ]);
    assert.match(harness.link.textContent, /Public Player/);
    assert.equal(harness.link.style.color, '#f8fafc');
    assertDashboardReplacement(harness);
}

{
    const harness = createHarness(savedProfile);
    assert.equal(harness.setMyPlayer(null), true);

    assert.equal(harness.getMyPlayerProfile(), null);
    assert.deepEqual(harness.storageCalls, [
        ['removeItem', BwedlAppUtils.PLAYER_PROFILE_STORAGE_KEY],
        ['removeItem', 'myPlayerName'],
        ['removeItem', 'myTeamName'],
    ]);
    assert.match(harness.link.textContent, /Mein Profil/);
    assert.equal(harness.link.style.color, '#94a3b8');
    assertDashboardReplacement(harness);
}

console.log('profile history navigation contract: ok');
