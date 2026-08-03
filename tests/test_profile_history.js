const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

function createHarness(initialName) {
    const storageCalls = [];
    const historyCalls = [];
    const navigationCalls = [];
    const link = { innerHTML: '', style: {} };
    let directRenderCalls = 0;

    const localStorage = {
        setItem(key, value) {
            storageCalls.push(['setItem', key, value]);
        },
        removeItem(key) {
            storageCalls.push(['removeItem', key]);
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
    const profile = new Function(
        'localStorage',
        'document',
        'history',
        'navigateTo',
        'renderDashboard',
        `let myPlayerName = ${JSON.stringify(initialName)}; const setMyPlayer = ${setMyPlayerSource}; return { setMyPlayer, getMyPlayerName: () => myPlayerName };`,
    )(localStorage, document, history, navigateTo, renderDashboard);

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
    harness.setMyPlayer('Public Player');

    assert.equal(harness.getMyPlayerName(), 'Public Player');
    assert.deepEqual(harness.storageCalls, [['setItem', 'myPlayerName', 'Public Player']]);
    assert.match(harness.link.innerHTML, /Public Player/);
    assert.equal(harness.link.style.color, '#f8fafc');
    assertDashboardReplacement(harness);
}

{
    const harness = createHarness('Public Player');
    harness.setMyPlayer(null);

    assert.equal(harness.getMyPlayerName(), null);
    assert.deepEqual(harness.storageCalls, [['removeItem', 'myPlayerName']]);
    assert.match(harness.link.innerHTML, /Mein Profil/);
    assert.equal(harness.link.style.color, '#94a3b8');
    assertDashboardReplacement(harness);
}

console.log('profile history navigation contract: ok');
