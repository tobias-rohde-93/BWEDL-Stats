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
    constructor(tagName, ownerDocument = null) {
        this.tagName = tagName.toUpperCase();
        this.ownerDocument = ownerDocument;
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
    replaceChildren(...children) {
        this.children.forEach((child) => { child.parentElement = null; });
        this.children = [];
        children.forEach((child) => this.appendChild(child));
    }
    querySelectorAll(selector) {
        const className = selector.startsWith('.') ? selector.slice(1) : null;
        const matches = [];
        const visit = (element) => {
            if (className && element.classList.contains(className)) matches.push(element);
            element.children.forEach(visit);
        };
        this.children.forEach(visit);
        return matches;
    }
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
    focus() {
        if (this.ownerDocument?.activeElement) this.ownerDocument.activeElement.focused = false;
        this.focused = true;
        if (this.ownerDocument) this.ownerDocument.activeElement = this;
    }
}

function createFocusDocument() {
    const document = { activeElement: null };
    document.createElement = (tagName) => new FakeElement(tagName, document);
    return document;
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
    const activateSearchResult = new Function(
        'closeSearchResults', `${activateSearchSource}; return activateSearchResult;`,
    )(closeSearchResults);
    const searchLabelSource = extractFunction(bundle, 'replaceWithSearchResultLabel');
    const replaceWithSearchResultLabel = new Function(
        'document', `${searchLabelSource}; return replaceWithSearchResultLabel;`,
    )(document);
    const handleSearch = new Function(
        'document', 'window', 'searchResults', 'searchInput', 'navigateTo',
        'closeSearchResults', 'activateSearchResult', 'replaceWithSearchResultLabel',
        `${source}; return handleSearch;`,
    )(
        document, window, searchResults, searchInput, navigateTo,
        closeSearchResults, activateSearchResult, replaceWithSearchResultLabel,
    );

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

    searchInput.value = 'cal';
    searchInput.focused = false;
    handleSearch({ target: searchInput });
    const escape = searchResults.children.at(-1).dispatch('keydown', { key: 'Escape' });
    assert.equal(escape.defaultPrevented, true);
    assert.equal(searchResults.classList.contains('hidden'), true);
    assert.equal(searchInput.getAttribute('aria-expanded'), 'false');
    assert.equal(searchInput.value, '');
    assert.equal(searchInput.focused, true);
}

// Profile autocomplete uses a native button and Escape follows the focused result path.
{
    const document = createFocusDocument();
    const input = document.createElement('input');
    const suggestions = document.createElement('ul');
    suggestions.style.display = 'block';
    input.setAttribute('aria-expanded', 'true');
    const selected = [];
    const source = extractFunction(bundle, 'createProfileSuggestionItem');
    const closeSource = extractFunction(bundle, 'closeProfileSuggestions');
    const selectSource = extractFunction(bundle, 'selectProfileSuggestion');
    const createProfileSuggestionItem = new Function(
        'document', `${source}; return createProfileSuggestionItem;`,
    )(document);
    const closeProfileSuggestions = new Function(
        `${closeSource}; return closeProfileSuggestions;`,
    )();
    const selectProfileSuggestion = new Function(
        'closeProfileSuggestions', `${selectSource}; return selectProfileSuggestion;`,
    )(closeProfileSuggestions);
    const item = createProfileSuggestionItem(
        { label: 'Max Muster', context: 'DC Calw' },
        (match) => selectProfileSuggestion(
            match,
            input,
            suggestions,
            (selectedMatch) => selected.push(selectedMatch.label),
        ),
        (restoreFocus) => closeProfileSuggestions(suggestions, input, restoreFocus),
    );
    suggestions.appendChild(item);
    assert.equal(item.tagName, 'LI');
    assert.equal(item.children[0].tagName, 'BUTTON');
    item.children[0].focus();
    item.children[0].click();
    assert.deepEqual(selected, ['Max Muster']);
    assert.equal(input.value, 'Max Muster');
    assert.equal(suggestions.style.display, 'none');
    assert.equal(input.getAttribute('aria-expanded'), 'false');
    assert.equal(document.activeElement, input, 'selection restores focus to the visible profile input');

    suggestions.style.display = 'block';
    input.setAttribute('aria-expanded', 'true');
    item.children[0].focus();
    const escape = item.children[0].dispatch('keydown', { key: 'Escape' });
    assert.equal(escape.defaultPrevented, true);
    assert.equal(document.activeElement, input);
}

// All-time detail rerenders replace the disclosure but keep focus on the exact same player control.
{
    const document = createFocusDocument();
    const container = document.createElement('section');
    const toggleId = 'alltime-detail-player-1-toggle';
    let expanded = false;
    const source = extractFunction(bundle, 'configureAllTimeDetailButton');
    const rerenderSource = extractFunction(bundle, 'rerenderAllTimeDetail');
    const configureAllTimeDetailButton = new Function(`${source}; return configureAllTimeDetailButton;`)();
    const rerenderAllTimeDetail = new Function(`${rerenderSource}; return rerenderAllTimeDetail;`)();
    const render = () => {
        const button = document.createElement('button');
        button.id = toggleId;
        configureAllTimeDetailButton(button, 'alltime-detail-player-1', expanded, () => {
            expanded = !expanded;
            rerenderAllTimeDetail(container, toggleId, render);
        });
        container.replaceChildren(button);
    };

    render();
    const openingButton = container.children[0];
    openingButton.focus();
    openingButton.click();
    const closingButton = container.children[0];
    assert.notEqual(closingButton, openingButton, 'render replaced the disclosure control');
    assert.equal(document.activeElement, closingButton, 'focus follows the replacement for the same player');
    assert.equal(closingButton.id, toggleId);
    assert.equal(closingButton.hidden, false);
    assert.equal(closingButton.getAttribute('aria-expanded'), 'true');
    assert.equal(closingButton.textContent, 'Schließen');

    closingButton.click();
    const reopenedButton = container.children[0];
    assert.equal(document.activeElement, reopenedButton);
    assert.equal(reopenedButton.id, toggleId);
    assert.equal(reopenedButton.getAttribute('aria-expanded'), 'false');
    assert.equal(reopenedButton.textContent, 'Details');
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
assert.match(bundle, /tableScroll\.className = ['"]table-scroll profile-season-history['"][\s\S]{0,180}tableScroll\.tabIndex = 0[\s\S]{0,180}aria-label['"], ['"]Saisonverlauf['"]/);
assert.match(bundle, /class="table-scroll alltime-detail-table" tabindex="0"[^>]*aria-label="Saisondetails/);
assert.match(styles, /\.profile-season-history\s+table\s*,\s*\.alltime-detail-table\s+table\s*\{[^}]*min-width\s*:/s);

// PWA shell cache keys exactly match the versioned requests made by index.html.
const requestedShellUrls = versionedShellUrls(html);
const requestedLocalAssets = localAssetUrls(html);
const cachedAssets = serviceWorkerAssets(worker);
assert.deepEqual(requestedShellUrls, [
    './style.css?v=7',
    './app_utils.js?v=4',
    './bundle_v31.js?v=3.7',
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
