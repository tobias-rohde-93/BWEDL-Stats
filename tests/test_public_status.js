const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'bundle_v31.js'), 'utf8');
const sandbox = {
    console,
    Intl,
    Date,
    window: {},
    document: {
        addEventListener() {},
        createElement() { return {}; },
        body: { appendChild() {} }
    }
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const { formatDomainStatus, getDomainState } = sandbox.window.BWEDL_STATUS_FORMATTERS;
assert.equal(
    formatDomainStatus('Liga', {
        season: '2026/27',
        state: 'current',
        updated_at: '2026-08-01T13:17:22Z'
    }),
    'Liga: 2026/27 · aktualisiert 01.08.2026, 15:17'
);
assert.equal(
    formatDomainStatus('Rangliste', {
        season: '2025/26',
        state: 'retained',
        updated_at: '2026-06-10T03:04:09Z'
    }),
    'Rangliste: Vorjahresstand 2025/26 · Stand 10.06.2026, 05:04'
);
assert.equal(formatDomainStatus('Archiv', undefined), 'Archiv: Status unbekannt');
assert.equal(
    formatDomainStatus('Vereine', { state: 'current', updated_at: 'not-an-iso-date' }),
    'Vereine: Status unbekannt'
);
assert.equal(
    getDomainState({ season: 'current', state: 'current', updated_at: 'not-an-iso-date' }),
    'unknown'
);

console.log('public status formatter: ok');
