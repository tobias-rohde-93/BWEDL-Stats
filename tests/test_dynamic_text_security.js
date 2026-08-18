const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BwedlAppUtils = require('../app_utils.js');
const sentinel = '<img src=x onerror="document.body.dataset.xss=1">';
const closingSentinel = '</span><svg onload="document.body.dataset.xss=2">';

assert.equal(typeof BwedlAppUtils.escapeHtmlText, 'function');
assert.equal(
    BwedlAppUtils.escapeHtmlText(`${sentinel}&${closingSentinel}`),
    '&lt;img src=x onerror=&quot;document.body.dataset.xss=1&quot;&gt;&amp;&lt;/span&gt;&lt;svg onload=&quot;document.body.dataset.xss=2&quot;&gt;',
);

const source = fs.readFileSync(path.resolve(__dirname, '..', 'bundle_v31.js'), 'utf8');

function findClosingBrace(openingBrace, label) {
    let depth = 0;
    for (let index = openingBrace; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    assert.fail(`Expected ${label} to have a complete declaration`);
}

function compileFunction(name, dependencies = {}) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `Expected function ${name} to exist`);
    const openingBrace = source.indexOf('{', start);
    const declaration = source.slice(start, findClosingBrace(openingBrace, name) + 1);
    return Function(...Object.keys(dependencies), `${declaration}; return ${name};`)(
        ...Object.values(dependencies),
    );
}

class Element {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.attributes = {};
        this.style = {};
        this._textContent = '';
    }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { children.forEach((child) => this.appendChild(child)); }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    set textContent(value) { this._textContent = String(value); }
    get textContent() { return this._textContent + this.children.map((child) => child.textContent).join(''); }
}

const document = { createElement: (tagName) => new Element(tagName) };
const replaceWithIconLabel = compileFunction('replaceWithIconLabel', { document });
const replaceWithSearchResultLabel = compileFunction('replaceWithSearchResultLabel', { document });

const profile = new Element('button');
replaceWithIconLabel(profile, '👤', sentinel);
assert.equal(profile.textContent, `👤${sentinel}`);
assert.deepEqual(profile.children.map((child) => child.tagName), ['SPAN', 'SPAN']);

const searchResult = new Element('button');
replaceWithSearchResultLabel(searchResult, closingSentinel, sentinel, closingSentinel);
assert.equal(searchResult.textContent, `${closingSentinel}${sentinel}(${closingSentinel})`);
assert.equal(
    [searchResult, ...searchResult.children].some((node) => ['IMG', 'SVG', 'SCRIPT'].includes(node.tagName)),
    false,
);

console.log('dynamic text security contract: ok');
