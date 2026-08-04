const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bundle = fs.readFileSync(path.join(root, 'bundle_v31.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'sw_v31.js'), 'utf8');

function versionedShellUrls(markup) {
    return [...markup.matchAll(/(?:href|src)="((?:style\.css|app_utils\.js|bundle_v31\.js)\?v=[^"]+)"/g)]
        .map((match) => `./${match[1]}`);
}

function localAssetUrls(markup) {
    return [...markup.matchAll(/(?:href|src)="([^"]+)"/g)]
        .map((match) => match[1])
        .filter((url) => !/^(?:https?:|#)/.test(url))
        .map((url) => `./${url}`);
}

function serviceWorkerAssets(source) {
    const declaration = source.match(/const urlsToCache = \[([\s\S]*?)\];/);
    assert.ok(declaration, 'service worker declares its pre-cache assets');
    return [...declaration[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `Expected function ${name} to exist`);
    const opening = source.indexOf('{', start);
    let depth = 0;
    let quote = null;
    for (let index = opening; index < source.length; index += 1) {
        const character = source[index];
        if (quote) {
            if (character === '\\') index += 1;
            else if (character === quote) quote = null;
            continue;
        }
        if (character === "'" || character === '"' || character === '`') quote = character;
        else if (character === '{') depth += 1;
        else if (character === '}' && --depth === 0) return source.slice(start, index + 1);
    }
    assert.fail(`Expected complete function ${name}`);
}

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.attributes = new Map();
        this.className = '';
        this.children = [];
        this.hidden = false;
        this.listeners = {};
        this.style = {};
        this.value = '';
        this.textContent = '';
        this.innerHTML = '';
        this.focused = false;
        this.classList = {
            add: (...names) => names.forEach((name) => {
                if (!this.className.split(/\s+/).includes(name)) this.className = `${this.className} ${name}`.trim();
            }),
            remove: (...names) => {
                this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(' ');
            },
            contains: (name) => this.className.split(/\s+/).includes(name),
        };
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    dispatch(type, properties = {}) {
        const event = {
            target: this,
            currentTarget: this,
            defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; },
            ...properties,
        };
        (this.listeners[type] || []).forEach((listener) => listener(event));
        return event;
    }
    click() { this.dispatch('click'); }
    focus() { this.focused = true; }
}

// A real disclosure helper must keep DOM state and ARIA state synchronized.
{
    const content = new FakeElement('div');
    const document = { createElement: (tagName) => new FakeElement(tagName) };
    const source = extractFunction(bundle, 'createDisclosureButton');
    const createDisclosureButton = new Function('document', `${source}; return createDisclosureButton;`)(document);
    const trigger = createDisclosureButton('Ligen', 'sidebar-leagues', content, false);
    assert.equal(trigger.tagName, 'BUTTON');
    assert.equal(trigger.getAttribute('aria-controls'), content.id);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(content.hidden, true);
    trigger.click();
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(content.hidden, false);
}

// Search results execute the production renderer and must be keyboard-selectable.
{
    const searchResults = new FakeElement('div');
    searchResults.className = 'search-results hidden';
    const searchInput = new FakeElement('input');
    searchInput.value = 'cal';
    const navigation = [];
    const document = { createElement: (tagName) => new FakeElement(tagName) };
    const window = {
        searchIndex: [{ label: 'DC Calw', type: 'Verein', category: 'club', id: 7 }],
    };
    const navigateTo = (type, id) => navigation.push([type, id]);
    const source = extractFunction(bundle, 'handleSearch');
    const closeSearchSource = extractFunction(bundle, 'closeSearchResults');
    const activateSearchSource = extractFunction(bundle, 'activateSearchResult');
    const closeSearchResults = new Function(
        'searchResults', 'searchInput', `${closeSearchSource}; return closeSearchResults;`,
    )(searchResults, searchInput);
    const activateSearchResult = new Function(`${activateSearchSource}; return activateSearchResult;`)();
    const handleSearch = new Function(
        'document', 'window', 'searchResults', 'searchInput', 'navigateTo',
        'closeSearchResults', 'activateSearchResult',
        `${source}; return handleSearch;`,
    )(document, window, searchResults, searchInput, navigateTo, closeSearchResults, activateSearchResult);

    handleSearch({ target: searchInput });
    assert.equal(searchResults.children.length, 1);
    const result = searchResults.children[0];
    assert.equal(result.tagName, 'BUTTON', 'search results are native controls');
    const enter = result.dispatch('keydown', { key: 'Enter' });
    assert.equal(enter.defaultPrevented, true);
    assert.deepEqual(navigation.pop(), ['club', 7]);

    searchInput.value = 'cal';
    handleSearch({ target: searchInput });
    const space = searchResults.children.at(-1).dispatch('keydown', { key: ' ' });
    assert.equal(space.defaultPrevented, true);
    assert.deepEqual(navigation.pop(), ['club', 7]);
}

// Escape closes the result popup, clears stale input, and restores focus.
{
    const searchResults = new FakeElement('div');
    const searchInput = new FakeElement('input');
    searchInput.value = 'calw';
    const source = extractFunction(bundle, 'closeSearchResults');
    const closeSearchResults = new Function('searchResults', 'searchInput', `${source}; return closeSearchResults;`)(
        searchResults,
        searchInput,
    );
    closeSearchResults(true);
    assert.equal(searchResults.classList.contains('hidden'), true);
    assert.equal(searchInput.value, '');
    assert.equal(searchInput.focused, true);
}

// Sidebar navigation is built from semantic controls, not generic clickable divs.
for (const variable of [
    'dashboardLink', 'profileLink', 'leagueHeader', 'catHeader', 'lpHeader',
    'rankingHeader', 'compareLink', 'allTimeLink', 'toolsLink', 'wikiLink',
]) {
    assert.match(bundle, new RegExp(`const ${variable} = document\\.createElement\\(['"]button['"]\\)`));
}
assert.doesNotMatch(bundle, /const (?:dashboardLink|profileLink|leagueHeader|catHeader|lpHeader|rankingHeader|compareLink|allTimeLink|toolsLink|wikiLink) = document\.createElement\(['"]div['"]\)/);
assert.match(bundle, /aria-expanded/);
assert.match(bundle, /aria-controls/);

// The shell exposes one global status region and labels the search popup.
assert.match(html, /id="app-status"[^>]*role="status"[^>]*aria-live="polite"/);
assert.match(html, /id="global-search"[^>]*aria-controls="search-results"[^>]*aria-expanded="false"/);
assert.match(html, /id="search-results"[^>]*role="region"[^>]*aria-label="Suchergebnisse"/);
assert.match(html, /id="menu-toggle"[^>]*aria-controls="league-nav"[^>]*aria-expanded="false"/s);
assert.match(bundle, /event\.key === 'Escape'[\s\S]{0,220}closeMobileNavigation\(\)/);
assert.match(bundle, /menuToggle\.setAttribute\('aria-expanded',\s*String\(isOpen\)\)/);

// Focus, motion, and narrow-screen containment are global contracts.
assert.match(styles, /:focus-visible\s*\{[^}]*outline\s*:/s);
assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*animation-duration\s*:/);
assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*scroll-behavior\s*:\s*auto/);
assert.match(styles, /\.table-scroll\s*\{[^}]*overflow-x\s*:\s*auto/s);
assert.match(html, /class="table-container table-scroll"/);
assert.match(styles, /\.main-content\s*\{[^}]*min-width\s*:\s*0/s);
assert.match(styles, /\.content-area\s*\{[^}]*min-width\s*:\s*0[^}]*max-width\s*:\s*100%/s);
assert.match(styles, /@media\s*\(max-width:\s*480px\)[\s\S]*\.content-area\s*\{[^}]*box-sizing\s*:\s*border-box/s);

// PWA shell cache keys exactly match the versioned requests made by index.html.
const requestedShellUrls = versionedShellUrls(html);
const requestedLocalAssets = localAssetUrls(html);
const cachedAssets = serviceWorkerAssets(worker);
assert.deepEqual(requestedShellUrls, [
    './style.css?v=3',
    './app_utils.js?v=1',
    './bundle_v31.js?v=3.2',
]);
assert.deepEqual(
    cachedAssets.filter((asset) => /(?:style\.css|app_utils\.js|bundle_v31\.js)/.test(asset)),
    requestedShellUrls,
);
for (const asset of requestedShellUrls) assert.ok(cachedAssets.includes(asset));
for (const asset of requestedLocalAssets) {
    assert.ok(cachedAssets.includes(asset), `service worker pre-caches the exact index request ${asset}`);
}
assert.equal(cachedAssets.some((asset) => /(?:style\.css|app_utils\.js|bundle_v31\.js)$/.test(asset)), false);
assert.equal(cachedAssets.some((asset) => /(?:style\.css\?v=2|bundle_v31\.js\?v=3\.1)$/.test(asset)), false);
assert.doesNotMatch(html, /getRegistrations\(|registration\.unregister\(|caches\.delete\(/);
assert.equal((worker.match(/const CACHE_NAME\s*=\s*['"][^'"]+['"]/g) || []).length, 1);

console.log('accessibility contract: ok');
