const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'bundle_v31.js'), 'utf8');

function extractFunction(name) {
    const declarationStart = source.indexOf(`function ${name}(`);
    assert.notEqual(declarationStart, -1, `Expected function ${name} to exist`);

    const openingBrace = source.indexOf('{', declarationStart);
    assert.notEqual(openingBrace, -1, `Expected function ${name} to have an opening brace`);

    let depth = 0;
    for (let index = openingBrace; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(declarationStart, index + 1);
    }

    assert.fail(`Expected function ${name} to have a complete declaration`);
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
assert.match(navigateSource, /closeMobileNavigation\(\);/);
assert.doesNotMatch(navigateSource, /sidebar\.classList\.remove\('open'\)/);
assert.doesNotMatch(navigateSource, /mobileOverlay\.classList\.remove\('active'\)/);

assert.match(source, /mobileOverlay\.addEventListener\('click', closeMobileNavigation\)/);
assert.equal((source.match(/closeMobileNavigation\(\);/g) || []).length, 3);
assert.match(source, /sidebar\.classList\.toggle\('open'\)/);
assert.match(source, /mobileOverlay\.classList\.toggle\('active'\)/);

console.log('mobile navigation close contract: ok');
