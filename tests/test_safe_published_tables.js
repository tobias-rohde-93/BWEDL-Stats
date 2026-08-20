const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class SourceCell {
    constructor(tagName, textContent, attributes = {}) {
        this.tagName = tagName;
        this.textContent = textContent;
        this.attributes = attributes;
    }

    getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name)
            ? this.attributes[name]
            : null;
    }
}

class SourceRow {
    constructor(cells, parentElement) {
        this.children = cells;
        this.parentElement = parentElement;
        this.table = null;
    }

    closest(selector) {
        assert.equal(selector, 'table');
        return this.table;
    }
}

class SourceTable {
    constructor(rows) {
        this.rows = rows;
        rows.forEach((row) => { row.table = this; });
    }

    querySelectorAll(selector) {
        assert.equal(selector, 'tr');
        return this.rows;
    }
}

class DestinationNode {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.attributes = {};
        this.style = {};
        this._textContent = '';
    }

    appendChild(child) {
        if (child.tagName === '#FRAGMENT') {
            this.children.push(...child.children);
            return child;
        }
        this.children.push(child);
        return child;
    }

    append(...children) {
        children.forEach((child) => this.appendChild(child));
    }

    replaceChildren(...children) {
        this.children = [];
        children.forEach((child) => this.appendChild(child));
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    get firstElementChild() {
        return this.children[0] || null;
    }

    set textContent(value) {
        this._textContent = String(value);
    }

    get textContent() {
        return this._textContent + this.children.map((child) => child.textContent).join('');
    }
}

const thead = { tagName: 'THEAD' };
const tbody = { tagName: 'TBODY' };
const direct = { tagName: 'TABLE' };
const firstTable = new SourceTable([
    new SourceRow([new SourceCell('TH', 'Name', { colspan: '2', onclick: 'run()' })], thead),
    new SourceRow([
        new SourceCell('TD', '<img src=x onerror=run()> Team', { rowspan: '3', style: 'color:red' }),
        new SourceCell('TD', '10', { colspan: '101' }),
    ], tbody),
]);
const secondTable = new SourceTable([
    new SourceRow([new SourceCell('TD', 'Second')], direct),
]);
const parsedDocument = {
    querySelectorAll(selector) {
        assert.equal(selector, 'table');
        return [firstTable, secondTable];
    },
};

class FakeDOMParser {
    parseFromString(value, type) {
        assert.equal(value, '<source html>');
        assert.equal(type, 'text/html');
        return parsedDocument;
    }
}

const document = {
    addEventListener() {},
    createElement(tagName) { return new DestinationNode(tagName); },
    createDocumentFragment() { return new DestinationNode('#fragment'); },
    body: { appendChild() {} },
};
const sandbox = {
    console,
    Intl,
    Date,
    URL,
    DOMParser: FakeDOMParser,
    document,
    window: {},
};
vm.createContext(sandbox);
const source = fs.readFileSync(path.resolve(__dirname, '..', 'bundle_v31.js'), 'utf8');
vm.runInContext(source, sandbox);

assert.equal(typeof sandbox.createSafeTablesFromHtml, 'function');
assert.equal(typeof sandbox.safeTableRowsFromHtml, 'function');
assert.equal(typeof sandbox.replaceWithSafeTables, 'function');
assert.equal(typeof sandbox.replaceWithSafeCupTables, 'function');

const fragment = sandbox.createSafeTablesFromHtml('<source html>');
assert.equal(fragment.children.length, 2);
assert.deepEqual(fragment.children.map((table) => table.tagName), ['TABLE', 'TABLE']);

const firstDestination = fragment.children[0];
assert.deepEqual(firstDestination.children.map((section) => section.tagName), ['THEAD', 'TBODY']);
const destinationHeader = firstDestination.children[0].children[0].children[0];
const destinationName = firstDestination.children[1].children[0].children[0];
const destinationScore = firstDestination.children[1].children[0].children[1];
assert.equal(destinationHeader.textContent, 'Name');
assert.deepEqual(destinationHeader.attributes, { colspan: '2' });
assert.equal(destinationName.textContent, '<img src=x onerror=run()> Team');
assert.deepEqual(destinationName.attributes, { rowspan: '3' });
assert.deepEqual(destinationScore.attributes, {});

function allNodes(node) {
    return [node, ...node.children.flatMap(allNodes)];
}
const allowed = new Set(['#FRAGMENT', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD']);
assert.equal(allNodes(fragment).every((node) => allowed.has(node.tagName)), true);
assert.equal(allNodes(fragment).some((node) => ['IMG', 'SCRIPT', 'SVG', 'A'].includes(node.tagName)), false);

assert.deepEqual(
    JSON.parse(JSON.stringify(sandbox.safeTableRowsFromHtml('<source html>'))),
    [
        ['Name'],
        ['<img src=x onerror=run()> Team', '10'],
        ['Second'],
    ],
);

const destination = new DestinationNode('div');
assert.equal(sandbox.replaceWithSafeTables(destination, '<source html>'), 2);
assert.equal(destination.children.length, 2);

const cupDestination = new DestinationNode('div');
assert.equal(sandbox.replaceWithSafeCupTables(cupDestination, '<source html>', {
    Finale: 'ignored content',
    Halbfinale: 'ignored content',
}), 2);
assert.deepEqual(cupDestination.children.map((node) => node.tagName), ['H3', 'DIV', 'H3', 'DIV']);
assert.equal(cupDestination.children[0].textContent, 'Finale');
assert.equal(cupDestination.children[2].textContent, 'Halbfinale');
const cupScrollRegions = [cupDestination.children[1], cupDestination.children[3]];
assert.deepEqual(
    cupScrollRegions.map((node) => node.className),
    ['table-container table-scroll', 'table-container table-scroll'],
);
assert.deepEqual(
    cupScrollRegions.map((node) => node.children.map((child) => child.tagName)),
    [['TABLE'], ['TABLE']],
);

console.log('safe published table rendering contract: ok');
