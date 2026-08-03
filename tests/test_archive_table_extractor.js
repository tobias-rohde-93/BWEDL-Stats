const assert = require('node:assert/strict');
const fs = require('node:fs');

function normalizeText(value) {
  return value.replace(/\s+/g, ' ').trim();
}

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.parentElement = null;
    this.children = [];
    this.childNodes = [];
  }

  appendChild(child) {
    this.childNodes.push(child);
    if (child instanceof Element) {
      child.parentElement = this.tagName === '#DOCUMENT' ? null : this;
      this.children.push(child);
    }
  }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    return index > 0 ? siblings[index - 1] : null;
  }

  get innerText() {
    return normalizeText(
      this.childNodes
        .map(child => child instanceof Element ? child.innerText : child)
        .join(' '),
    );
  }

  querySelectorAll(selector) {
    let allowedTags;
    if (this.tagName === 'TABLE' && selector === 'tr') {
      allowedTags = new Set(['TR']);
    } else if (this.tagName === 'TR' && selector === 'td, th') {
      allowedTags = new Set(['TD', 'TH']);
    } else {
      throw new Error(`Unsupported ${this.tagName.toLowerCase()} selector: ${selector}`);
    }

    const matches = [];
    const visit = element => {
      element.children.forEach(child => {
        if (allowedTags.has(child.tagName)) matches.push(child);
        visit(child);
      });
    };
    visit(this);
    return matches;
  }
}

function buildDocument(html) {
  const root = new Element('#document');
  const stack = [root];
  const tokens = html.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+/g) || [];
  const voidElements = new Set(['BR', 'HR', 'IMG', 'INPUT', 'LINK', 'META']);

  tokens.forEach(token => {
    if (token.startsWith('<!--') || token.startsWith('<!')) return;
    if (token.startsWith('</')) {
      const tagName = token.match(/^<\/\s*([a-zA-Z0-9-]+)/)[1].toUpperCase();
      const element = stack.pop();
      if (!element || element.tagName !== tagName) {
        throw new Error(`Mismatched closing tag: ${tagName}`);
      }
      return;
    }
    if (token.startsWith('<')) {
      const tagName = token.match(/^<\s*([a-zA-Z0-9-]+)/)[1].toUpperCase();
      const element = new Element(tagName);
      stack[stack.length - 1].appendChild(element);
      if (!token.endsWith('/>') && !voidElements.has(tagName)) stack.push(element);
      return;
    }
    stack[stack.length - 1].appendChild(token);
  });

  if (stack.length !== 1) throw new Error('Unclosed fixture element');

  const allTables = [];
  const visit = element => {
    element.children.forEach(child => {
      if (child.tagName === 'TABLE') allTables.push(child);
      visit(child);
    });
  };
  visit(root);

  return {
    querySelectorAll(selector) {
      if (selector !== 'table') {
        throw new Error(`Unsupported document selector: ${selector}`);
      }
      return allTables;
    },
  };
}

const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
const document = buildDocument(payload.html);
assert.throws(() => document.querySelectorAll('div'), /Unsupported document selector/);

const extractor = new Function('document', `return (${payload.source});`)(document);
const result = extractor();

assert.equal(result.length, 5);

const splitWrapper = result.find(item => item.league.includes('C-Klasse'));
assert.ok(splitWrapper, 'split-wrapper table must use its preceding title wrapper');
assert.equal(splitWrapper.league, 'Bwedl e.V. 2025/2026 C-Klasse Meisterschaft');
assert.equal(splitWrapper.rows.length, 3);
assert.equal(splitWrapper.rows[0][0], 'Runde/Info');
assert.equal(
  splitWrapper.rows.flat().includes('Bwedl e.V. 2025/2026 C-Klasse Meisterschaft'),
  false,
);
assert.equal(splitWrapper.league.includes('Farther'), false);

const embedded = result.find(item => item.league.includes('Embedded Oberliga'));
assert.ok(embedded, 'embedded single-cell title must override fallback title');
assert.equal(embedded.league, 'Embedded Oberliga Meisterschaft 2025/2026');
assert.equal(embedded.rows.flat().includes(embedded.league), false);

const directSibling = result.find(item => item.league.includes('B-Klasse'));
assert.ok(directSibling, 'existing direct-sibling title shape must keep working');
assert.equal(directSibling.league, 'Bwedl e.V. 2025/2026 B-Klasse Meisterschaft');

const siblingBoundary = result.find(item => item.rows.flat().includes('Sibling Boundary Team'));
assert.ok(siblingBoundary, 'sibling-boundary table must be extracted');
assert.equal(
  siblingBoundary.league,
  'Unbekannt',
  'plausible heading at the 16th preceding sibling must remain outside lookback',
);

const parentBoundary = result.find(item => item.rows.flat().includes('Parent Boundary Team'));
assert.ok(parentBoundary, 'parent-boundary table must be extracted');
assert.equal(
  parentBoundary.league,
  'Unbekannt',
  'plausible heading beyond three parent ascents must remain outside lookback',
);
