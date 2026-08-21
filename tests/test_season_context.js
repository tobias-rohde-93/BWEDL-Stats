const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'bundle_v31.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const BwedlAppUtils = require('../app_utils.js');

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
    const closingBrace = findClosingBrace(openingBrace, `function ${name}`);
    return source.slice(declarationStart, closingBrace + 1);
}

function createDocument() {
    class Element {
        constructor(tagName, ownerDocument) {
            this.tagName = tagName.toUpperCase();
            this.ownerDocument = ownerDocument;
            this.children = [];
            this.className = '';
            this.dataset = {};
            this.attributes = {};
            this.listeners = {};
            this.textContent = '';
            this.type = '';
            this.id = '';
            this.value = '';
            this.options = [];
            this.parentElement = null;
            this.style = {};
            this.classList = {
                add: (...names) => {
                    const classes = new Set(this.className.split(/\s+/).filter(Boolean));
                    names.forEach((name) => classes.add(name));
                    this.className = [...classes].join(' ');
                },
                remove: (...names) => {
                    const removed = new Set(names);
                    this.className = this.className.split(/\s+/).filter((name) => !removed.has(name)).join(' ');
                },
                contains: (name) => this.className.split(/\s+/).includes(name),
            };
        }

        get firstChild() { return this.children[0] || null; }

        appendChild(child) {
            this.children.push(child);
            child.parentElement = this;
            return child;
        }

        append(...children) {
            children.forEach((child) => this.appendChild(child));
        }

        insertBefore(child, reference) {
            const referenceIndex = this.children.indexOf(reference);
            if (reference === null) return this.appendChild(child);
            if (referenceIndex === -1) {
                const error = new Error('NotFoundError: reference is not a child of this element');
                error.name = 'NotFoundError';
                throw error;
            }
            this.children.splice(referenceIndex, 0, child);
            child.parentElement = this;
            return child;
        }

        setAttribute(name, value) {
            this.attributes[name] = value;
        }

        addEventListener(name, handler) {
            this.listeners[name] = handler;
        }

        querySelectorAll(selector) {
            const matches = (element) => {
                if (selector.startsWith('.')) {
                    return element.className.split(/\s+/).includes(selector.slice(1));
                }
                if (selector.startsWith('#')) return element.id === selector.slice(1);
                return element.tagName === selector.toUpperCase();
            };
            return this.children.flatMap((child) => [
                ...(matches(child) ? [child] : []),
                ...child.querySelectorAll(selector),
            ]);
        }

        querySelector(selector) {
            return this.querySelectorAll(selector)[0] || null;
        }

        contains(target) {
            return target === this || this.children.some((child) => child.contains(target));
        }

        dispatchEvent(event) {
            if (this.listeners[event.type]) this.listeners[event.type](event);
        }

        scrollIntoView() {}

        set innerHTML(value) {
            this._innerHTML = value;
            this.children = [];
        }

        get innerHTML() {
            return this._innerHTML || '';
        }
    }

    const elementsById = new Map();
    const document = {
        createElement: (tagName) => new Element(tagName, document),
        getElementById(id) {
            if (!elementsById.has(id)) {
                const element = new Element('div', document);
                element.id = id;
                elementsById.set(id, element);
            }
            return elementsById.get(id);
        },
        querySelectorAll: () => [],
    };
    return document;
}

function compileFunction(name, bindings) {
    return new Function(
        ...Object.keys(bindings),
        `${extractFunction(name)}; return ${name};`,
    )(...Object.values(bindings));
}

function makeSeasonNotice(document, status) {
    return new Function(
        'document',
        'dataStatus',
        'BwedlAppUtils',
        `${extractFunction('createSeasonNotice')}; return createSeasonNotice;`,
    )(document, status, BwedlAppUtils);
}

function seasonContexts(root) {
    return root.querySelectorAll('.season-notice').map((notice) => notice.dataset.seasonContext);
}

function findById(root, id) {
    if (root.id === id) return root;
    for (const child of root.children) {
        const match = findById(child, id);
        if (match) return match;
    }
    return null;
}

const createSeasonNoticeSource = extractFunction('createSeasonNotice');
assert.doesNotMatch(createSeasonNoticeSource, /\.style\b|style\s*=/);

const retainedStatus = {
    domains: {
        rankings: { season: '2025/26', state: 'retained' },
    },
};
const publishedStatus = {
    domains: {
        rankings: { season: '2026/27', state: 'published' },
    },
};
const document = createDocument();
const createSeasonNotice = new Function(
    'document',
    'dataStatus',
    'BwedlAppUtils',
    `${createSeasonNoticeSource}; return createSeasonNotice;`,
)(document, retainedStatus, BwedlAppUtils);

const notice = createSeasonNotice('ranking');
assert.equal(notice.tagName, 'SECTION');
assert.equal(notice.className, 'season-notice');
assert.equal(notice.dataset.seasonContext, 'ranking');
assert.equal(notice.attributes.role, 'note');
assert.equal(notice.querySelectorAll('H2').length, 1);
assert.match(notice.textContent + notice.children.map((child) => child.textContent).join(' '), /Vorjahresstand 2025\/26/);
assert.match(notice.children.map((child) => child.textContent).join(' '), /vollständigem Saisonstart/);
assert.match(notice.children.map((child) => child.textContent).join(' '), /andere aktuelle Daten/i);

const currentDocument = createDocument();
const createCurrentSeasonNotice = new Function(
    'document',
    'dataStatus',
    'BwedlAppUtils',
    `${createSeasonNoticeSource}; return createSeasonNotice;`,
)(currentDocument, publishedStatus, {
    buildSeasonNotice: BwedlAppUtils.buildSeasonNotice,
});
assert.equal(createCurrentSeasonNotice('ranking'), null);

const createProfileOnboardingCardSource = extractFunction('createProfileOnboardingCard');
assert.doesNotMatch(createProfileOnboardingCardSource, /\.style\b|style\s*=/);
const navigationCalls = [];
const createProfileOnboardingCard = new Function(
    'document',
    'navigateTo',
    `${createProfileOnboardingCardSource}; return createProfileOnboardingCard;`,
)(document, (...args) => navigationCalls.push(args));
const onboarding = createProfileOnboardingCard();
assert.equal(onboarding.tagName, 'SECTION');
assert.equal(onboarding.className, 'profile-onboarding-card');
assert.equal(onboarding.querySelectorAll('H2').length, 1);
assert.match(onboarding.children.map((child) => child.textContent).join(' '), /persönliche Übersicht/i);
assert.match(onboarding.children.map((child) => child.textContent).join(' '), /bleibt.*Browser/i);
const buttons = onboarding.querySelectorAll('BUTTON');
assert.equal(buttons.length, 1);
buttons[0].listeners.click();
assert.deepEqual(navigationCalls, [['profile']]);

function runDashboard(status, playerName) {
    const document = createDocument();
    const contentArea = document.createElement('main');
    const topBarTitle = document.createElement('div');
    const navigationCalls = [];
    const calendarCards = [];
    const createSeasonNotice = makeSeasonNotice(document, status);
    const createProfileOnboardingCard = new Function(
        'document',
        'navigateTo',
        `${createProfileOnboardingCardSource}; return createProfileOnboardingCard;`,
    )(document, (...args) => navigationCalls.push(args));
    const players = playerName ? [{
        name: playerName,
        rank: 8,
        league: 'Bezirksliga',
        rounds: { R1: '54' },
    }] : [];
    const renderDashboard = compileFunction('renderDashboard', {
        topBarTitle,
        contentArea,
        document,
        myTeamName: null,
        getMyPrimaryPlayer: () => players[0] || null,
        isMyPlayerRecord: (player) => player === players[0],
        escapeHtmlText: BwedlAppUtils.escapeHtmlText,
        rankingData: { players },
        calculatePlayerStats: () => ({ avg: 54, count: 1 }),
        calculateTrend: () => null,
        leagueData: { leagues: {} },
        normalizeTeamName: (value) => value,
        clubData: { clubs: [] },
        navigateTo: (...args) => navigationCalls.push(args),
        createSeasonNotice,
        createProfileOnboardingCard,
        createCalendarSubscriptionCard: () => {
            const card = document.createElement('section');
            card.className = 'calendar-subscription-card';
            calendarCards.push(card);
            return card;
        },
    });

    renderDashboard();
    return { contentArea, navigationCalls, renderDashboard, calendarCards };
}

{
    const dashboard = runDashboard(retainedStatus, 'Public Player');
    const { contentArea } = dashboard;
    assert.deepEqual(seasonContexts(contentArea).sort(), ['dashboard-profile', 'top-20']);
    assert.equal(contentArea.querySelectorAll('.profile-onboarding-card').length, 0);
    const renderedCards = contentArea.querySelectorAll('.calendar-subscription-card');
    assert.equal(renderedCards.length, 1);
    const calendarCard = renderedCards[0];
    const grid = calendarCard.parentElement;
    const calendarIndex = grid.children.indexOf(calendarCard);
    const actionCard = grid.children[calendarIndex + 1];
    assert.ok(actionCard, 'Expected the next-game action area immediately after the calendar card');
    assert.equal(actionCard.parentElement, grid);
    dashboard.renderDashboard();
    assert.equal(contentArea.querySelectorAll('.calendar-subscription-card').length, 1);
}

{
    const { contentArea, navigationCalls } = runDashboard(retainedStatus, null);
    assert.deepEqual(seasonContexts(contentArea), ['top-20']);
    const cards = contentArea.querySelectorAll('.profile-onboarding-card');
    assert.equal(cards.length, 1);
    const action = cards[0].querySelector('button');
    assert.ok(action, 'Expected onboarding action to be attached by renderDashboard');
    action.listeners.click();
    assert.deepEqual(navigationCalls, [['profile']]);
}

assert.deepEqual(
    seasonContexts(runDashboard(publishedStatus, 'Public Player').contentArea),
    [],
);

function runRenderer(name, context, status) {
    const document = createDocument();
    const contentArea = document.createElement('main');
    const topBarTitle = document.createElement('div');
    const createSeasonNotice = makeSeasonNotice(document, status);
    const common = {
        document,
        contentArea,
        topBarTitle,
        createSeasonNotice,
        BwedlAppUtils: { mergeMatchPreviewGames: (_selected, detected) => detected },
    };
    let bindings;

    if (name === 'renderRanking') {
        bindings = {
            ...common,
            rankingData: { players: [], rankings: {} },
            myPlayerProfile: null,
            isMyPlayerRecord: () => false,
        };
    } else if (name === 'renderComparisonView') {
        bindings = {
            ...common,
            window: { searchIndex: [] },
            rankingData: { players: [] },
            archiveData: {},
        };
    } else {
        const neutralLineup = () => Array.from({ length: 4 }, (_unused, index) => ({
            id: `neutral-${index + 1}`,
            name: 'Unbekannter Spieler (Klassenwert)',
            adjustedRating: 35,
            rating: 35,
            evidence: 'neutral',
            confidence: 'very-low',
            currentAppearances: 0,
            sourceSeasons: [],
            rounds: {},
            rosterUnconfirmed: true,
        }));
        const previewModel = {
            buildClassCalibration: () => ({}),
            buildOutcomeTrainingExamples: () => [],
            calibrateOutcomeModel: () => ({ calibrated: false }),
            buildTeamRoster: () => ({
                players: [], classMean: 35, classMeanAvailable: false,
                teamConfidence: 'very-low', diagnostics: {},
            }),
            completeLineup: neutralLineup,
            comparePairStrength: () => ({
                homeShare: 0.5, awayShare: 0.5,
                homePercent: 50, awayPercent: 50, uncertain: true,
            }),
            forecastMatch: () => ({
                mode: 'relative', homeScore: 35, awayScore: 35,
                relative: { homeShare: 0.5, awayShare: 0.5 },
                teamConfidence: 'very-low',
                uncertaintyText: 'Relative Aufstellungsstärke mit unsicherer Datenbasis',
            }),
        };
        bindings = {
            ...common,
            window: { BwedlMatchPreviewModel: previewModel, ARCHIVE_TABLES: [] },
            leagueData: { leagues: {} },
            rankingData: { players: [] },
            archiveData: {},
            clubData: { clubs: [] },
            dataStatus: status,
            detectNextMatch: () => [],
            myPlayerName: null,
            isMyPlayerRecord: () => false,
        };
    }

    const renderer = compileFunction(name, bindings);
    renderer(name === 'renderRanking' ? 'Bezirksliga' : undefined);
    assert.deepEqual(seasonContexts(contentArea), status.domains.rankings.state === 'retained' ? [context] : []);
    return contentArea;
}

for (const [renderer, context] of [
    ['renderRanking', 'ranking'],
    ['renderComparisonView', 'h2h'],
    ['renderMatchPreview', 'match-preview'],
]) {
    runRenderer(renderer, context, retainedStatus);
    runRenderer(renderer, context, publishedStatus);
}

const matchPreviewRoot = runRenderer('renderMatchPreview', 'match-preview', retainedStatus);
const matchPreviewNotice = matchPreviewRoot.querySelector('.season-notice');
const playerSelectionArea = findById(matchPreviewRoot, 'player-selection-area');
assert.ok(playerSelectionArea, 'Expected Match Preview renderer to attach its player selection area');
const listA = findById(playerSelectionArea, 'list-a');
const listB = findById(playerSelectionArea, 'list-b');
const playerListGrid = listA && listA.parentElement === listB.parentElement
    ? listA.parentElement
    : null;
assert.ok(playerListGrid, 'Expected player selection area to contain the ranking-derived player lists');
assert.equal(matchPreviewNotice.parentElement, playerSelectionArea);
assert.equal(
    playerSelectionArea.children.indexOf(matchPreviewNotice) + 1,
    playerSelectionArea.children.indexOf(playerListGrid),
    'Expected retained notice immediately before ranking-derived Match Preview player lists',
);

for (const selector of [
    '.season-notice',
    '.season-notice__title',
    '.season-notice__detail',
    '.profile-onboarding-card',
    '.profile-onboarding-card__action',
]) {
    assert.match(styles, new RegExp(selector.replace('.', '\\.') + '\\s*\\{'));
}

console.log('season context and onboarding contract: ok');
