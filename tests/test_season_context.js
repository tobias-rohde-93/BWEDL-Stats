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
        constructor(tagName) {
            this.tagName = tagName.toUpperCase();
            this.children = [];
            this.className = '';
            this.dataset = {};
            this.attributes = {};
            this.listeners = {};
            this.textContent = '';
            this.type = '';
        }

        appendChild(child) {
            this.children.push(child);
            return child;
        }

        setAttribute(name, value) {
            this.attributes[name] = value;
        }

        addEventListener(name, handler) {
            this.listeners[name] = handler;
        }

        querySelectorAll(tagName) {
            const target = tagName.toUpperCase();
            return this.children.flatMap((child) => [
                ...(child.tagName === target ? [child] : []),
                ...child.querySelectorAll(target),
            ]);
        }
    }

    return { createElement: (tagName) => new Element(tagName) };
}

const createSeasonNoticeSource = extractFunction('createSeasonNotice');
assert.doesNotMatch(createSeasonNoticeSource, /\.style\b|style\s*=/);

const retainedStatus = {
    domains: {
        rankings: { season: '2025/26', state: 'retained' },
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
)(currentDocument, { domains: { rankings: { season: '2026/27', state: 'current' } } }, {
    buildSeasonNotice: () => ({ state: 'current', season: '2026/27' }),
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

const dashboardSource = extractFunction('renderDashboard');
assert.equal((dashboardSource.match(/createSeasonNotice\('dashboard-profile'\)/g) || []).length, 1);
assert.equal((dashboardSource.match(/createSeasonNotice\('top-20'\)/g) || []).length, 1);
assert.match(
    dashboardSource,
    /if\s*\(\s*!myPlayerName\s*\)\s*\{[\s\S]*?createProfileOnboardingCard\(\)[\s\S]*?\}/,
);
assert.equal((dashboardSource.match(/createProfileOnboardingCard\(\)/g) || []).length, 1);

for (const [renderer, context] of [
    ['renderRanking', 'ranking'],
    ['renderComparisonView', 'h2h'],
    ['renderMatchPreview', 'match-preview'],
]) {
    const rendererSource = extractFunction(renderer);
    assert.equal(
        (rendererSource.match(new RegExp(`createSeasonNotice\\('${context}'\\)`, 'g')) || []).length,
        1,
        `Expected ${renderer} to add exactly one ${context} notice`,
    );
}

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
