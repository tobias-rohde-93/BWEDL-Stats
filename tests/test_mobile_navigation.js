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

function extractFunction(name) {
    const declarationStart = source.indexOf(`function ${name}(`);
    assert.notEqual(declarationStart, -1, `Expected function ${name} to exist`);

    const openingBrace = source.indexOf('{', declarationStart);
    assert.notEqual(openingBrace, -1, `Expected function ${name} to have an opening brace`);
    const closingBrace = findClosingBrace(openingBrace, `function ${name}`);
    return source.slice(declarationStart, closingBrace + 1);
}

function extractArrowHandler(target, eventName, requiredPattern) {
    const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const handlerPattern = new RegExp(
        `${escapedTarget}\\s*\\.\\s*addEventListener\\s*\\(\\s*['"]${eventName}['"]\\s*,(\\s*\\([^)]*\\)\\s*=>\\s*\\{)`,
        'g',
    );
    const matchingHandlers = [];
    let match;

    while ((match = handlerPattern.exec(source)) !== null) {
        const handlerStart = match.index + match[0].length - match[1].length;
        const openingBrace = source.indexOf('{', handlerStart);
        const closingBrace = findClosingBrace(openingBrace, `${target} ${eventName} handler`);
        const handlerSource = source.slice(handlerStart, closingBrace + 1).trim();
        if (requiredPattern.test(handlerSource)) matchingHandlers.push(handlerSource);
        handlerPattern.lastIndex = closingBrace + 1;
    }

    assert.equal(
        matchingHandlers.length,
        1,
        `Expected one relevant ${target} ${eventName} arrow handler`,
    );
    return matchingHandlers[0];
}

function classList(...initialClasses) {
    const classes = new Set(initialClasses);
    return {
        contains(name) {
            return classes.has(name);
        },
        remove(name) {
            classes.delete(name);
        },
    };
}

const sidebar = { classList: classList('sidebar', 'open') };
const mobileOverlay = { classList: classList('mobile-overlay', 'active') };

const closeSource = extractFunction('closeMobileNavigation');
const closeMobileNavigation = new Function(
    'sidebar',
    'mobileOverlay',
    `${closeSource}; return closeMobileNavigation;`,
)(sidebar, mobileOverlay);

closeMobileNavigation();

assert.equal(sidebar.classList.contains('open'), false);
assert.equal(mobileOverlay.classList.contains('active'), false);

const navigateSource = extractFunction('navigateTo');
const directSidebarRemoval = /sidebar\s*\.\s*classList\s*\.\s*remove\s*\(\s*['"]open['"]\s*\)/;
const directOverlayRemoval = /mobileOverlay\s*\.\s*classList\s*\.\s*remove\s*\(\s*['"]active['"]\s*\)/;

function assertDelegatesToClose(handlerSource, handlerArguments, invoke, label) {
    let closeCalls = 0;
    const handler = new Function(
        ...handlerArguments.map((argument) => argument.name),
        'closeMobileNavigation',
        `return (${handlerSource});`,
    )(...handlerArguments.map((argument) => argument.value), () => {
        closeCalls += 1;
    });

    invoke(handler);
    assert.equal(closeCalls, 1, `Expected ${label} to delegate once`);
    assert.doesNotMatch(handlerSource, directSidebarRemoval);
    assert.doesNotMatch(handlerSource, directOverlayRemoval);
}

let navigateCloseCalls = 0;
const navigateSidebar = { classList: classList('sidebar', 'open') };
const navigateTo = new Function(
    'history',
    'window',
    'document',
    'backBtn',
    'closeMobileNavigation',
    `${navigateSource}; return navigateTo;`,
)(
    { pushState() {} },
    { innerWidth: 768, scrollTo() {} },
    { querySelector: () => navigateSidebar },
    null,
    () => { navigateCloseCalls += 1; },
);
navigateTo('__mobile_navigation_contract__', null, false);
assert.equal(navigateCloseCalls, 1, 'Expected navigateTo to delegate once');
assert.doesNotMatch(navigateSource, directSidebarRemoval);
assert.doesNotMatch(navigateSource, directOverlayRemoval);

const outsideHandlerSource = extractArrowHandler(
    'document',
    'click',
    /sidebar\s*\.\s*classList\s*\.\s*contains\s*\(\s*['"]open['"]\s*\)/,
);
assertDelegatesToClose(
    outsideHandlerSource,
    [
        { name: 'window', value: { innerWidth: 768 } },
        {
            name: 'sidebar',
            value: {
                classList: classList('sidebar', 'open'),
                contains: () => false,
            },
        },
        { name: 'menuToggle', value: {} },
        { name: 'mobileOverlay', value: { contains: () => false } },
    ],
    (handler) => handler({ target: {} }),
    'outside click handler',
);

const sidebarHandlerSource = extractArrowHandler('sidebar', 'click', /league-item/);
assertDelegatesToClose(
    sidebarHandlerSource,
    [
        { name: 'window', value: { innerWidth: 768 } },
        { name: 'sidebar', value: sidebar },
        { name: 'mobileOverlay', value: mobileOverlay },
    ],
    (handler) => handler({
        target: {
            classList: classList('league-item'),
            tagName: 'DIV',
        },
    }),
    'sidebar clickable-item handler',
);

const scopedCloseCallCount = [navigateSource, outsideHandlerSource, sidebarHandlerSource]
    .reduce(
        (total, targetSource) => total + (targetSource.match(/closeMobileNavigation\(\);/g) || []).length,
        0,
    );
assert.equal(scopedCloseCallCount, 3, 'Expected three direct close calls in target bodies');

const overlayCloseBindings = source.match(
    /mobileOverlay\s*\.\s*addEventListener\s*\(\s*['"]click['"]\s*,\s*closeMobileNavigation\s*\)/g,
) || [];
assert.equal(overlayCloseBindings.length, 1, 'Expected overlay click to bind the close helper once');
assert.match(source, /sidebar\s*\.\s*classList\s*\.\s*toggle\s*\(\s*['"]open['"]\s*\)/);
assert.match(source, /mobileOverlay\s*\.\s*classList\s*\.\s*toggle\s*\(\s*['"]active['"]\s*\)/);

console.log('mobile navigation close contract: ok');
