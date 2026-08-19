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
        const next = source[index + 1];
        if (state === 'line') { if (character === '\n') state = 'code'; continue; }
        if (state === 'block') { if (character === '*' && next === '/') { state = 'code'; index += 1; } continue; }
        if (state !== 'code') {
            if (character === '\\') index += 1;
            else if (character === state) state = 'code';
            continue;
        }
        if (character === '/' && next === '/') { state = 'line'; index += 1; }
        else if (character === '/' && next === '*') { state = 'block'; index += 1; }
        else if (['\'', '"', '`'].includes(character)) state = character;
        else if (character === '{') depth += 1;
        else if (character === '}' && --depth === 0) return index;
    }
    assert.fail(`Expected complete ${label}`);
}

function compileFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `Expected function ${name}`);
    const opening = source.indexOf('{', start);
    const declaration = source.slice(start, findClosingBrace(opening, name) + 1);
    return Function(`${declaration}; return ${name};`)();
}

const createPlayerProfileDraft = compileFunction('createPlayerProfileDraft');
const storeResolvedPlayerProfile = compileFunction('storeResolvedPlayerProfile');
const clearStoredPlayerProfile = compileFunction('clearStoredPlayerProfile');

const sameNamePlayers = [
    { v_nr: '001', id: '10', name: 'Alex Gleich', league: 'A-Klasse', company: 'Club Eins' },
    { v_nr: '002', id: '20', name: 'Alex Gleich', league: 'B-Klasse', company: 'Club Zwei' },
];
assert.equal(BwedlAppUtils.groupRankingPeople(sameNamePlayers).length, 2);

const multiClassPlayers = [
    { v_nr: '007', id: '77', name: 'Mara Beispiel', league: 'A-Klasse', company: 'DC Test' },
    { v_nr: '007', id: '77', name: 'Mara Beispiel', league: 'B-Klasse', company: 'DC Test' },
];
const group = BwedlAppUtils.groupRankingPeople(multiClassPlayers)[0];
const draft = createPlayerProfileDraft(BwedlAppUtils);

draft.updateInput('Mara Beispiel');
assert.equal(draft.createProfile('DC Test'), null, 'free text alone cannot be stored');
draft.selectGroup(group);
assert.equal(draft.createProfile('DC Test'), null, 'multi-class identity requires an explicit primary class');
draft.selectRecord('B-Klasse|77');
assert.equal(draft.createProfile('DC Test').recordKey, 'B-Klasse|77');
draft.updateInput('Mara Beispiel geändert');
assert.equal(draft.createProfile('DC Test'), null, 'editing text clears the selected identity');

draft.selectGroup(group, 'A-Klasse|77');
assert.equal(draft.createProfile('DC Test').recordKey, 'A-Klasse|77', 'an existing primary class is retained');

const profile = draft.createProfile('DC Test');
const calls = [];
const storage = {
    setItem(key, value) { calls.push(['setItem', key, JSON.parse(value)]); },
    removeItem(key) { calls.push(['removeItem', key]); },
};
const stored = storeResolvedPlayerProfile(storage, BwedlAppUtils, multiClassPlayers, profile);
assert.equal(stored.status, 'resolved');
assert.equal(calls[0][0], 'setItem');
assert.equal(calls[0][1], BwedlAppUtils.PLAYER_PROFILE_STORAGE_KEY);
assert.equal(calls[0][2].recordKey, 'A-Klasse|77');
assert.deepEqual(calls.slice(1), [
    ['removeItem', 'myPlayerName'],
    ['removeItem', 'myTeamName'],
]);

const failedCalls = [];
const failingStorage = {
    setItem(key) { failedCalls.push(['setItem', key]); throw new Error('quota'); },
    removeItem(key) { failedCalls.push(['removeItem', key]); },
};
assert.equal(
    storeResolvedPlayerProfile(failingStorage, BwedlAppUtils, multiClassPlayers, profile).status,
    'write-failed',
);
assert.deepEqual(failedCalls, [['setItem', BwedlAppUtils.PLAYER_PROFILE_STORAGE_KEY]]);

const resetCalls = [];
clearStoredPlayerProfile({ removeItem: (key) => resetCalls.push(key) }, BwedlAppUtils);
assert.deepEqual(resetCalls, [
    BwedlAppUtils.PLAYER_PROFILE_STORAGE_KEY,
    'myPlayerName',
    'myTeamName',
]);

console.log('exact profile UI state contract: ok');
