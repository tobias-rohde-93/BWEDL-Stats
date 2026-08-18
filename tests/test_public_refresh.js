const assert = require('node:assert/strict');

const { probePublishedData } = require('../app_utils.js');

async function main() {
    assert.equal(typeof probePublishedData, 'function');

    const requests = [];
    const payload = {
        domains: {
            leagues: {
                season: '2026/27',
                state: 'current',
                updated_at: '2026-08-18T08:00:00Z',
            },
        },
    };
    const fetchImpl = async (url, options) => {
        requests.push({ url: String(url), options });
        return {
            ok: true,
            async json() { return payload; },
        };
    };

    const result = await probePublishedData(
        fetchImpl,
        'https://tobias-rohde-93.github.io/BWEDL-Stats/index.html#dashboard',
        1723968000123,
    );

    assert.equal(result, payload);
    assert.deepEqual(requests, [{
        url: 'https://tobias-rohde-93.github.io/BWEDL-Stats/data_status.json?t=1723968000123',
        options: {
            cache: 'no-store',
            credentials: 'omit',
            headers: { Accept: 'application/json' },
        },
    }]);
    assert.equal(requests[0].url.includes('api.github.com'), false);
    assert.equal(requests[0].url.includes('/api/'), false);

    await assert.rejects(
        () => probePublishedData(
            async () => ({ ok: false, status: 503, async json() { return payload; } }),
            'https://example.test/BWEDL-Stats/',
            1,
        ),
        /503/,
    );
    await assert.rejects(
        () => probePublishedData(
            async () => ({ ok: true, async json() { return {}; } }),
            'https://example.test/BWEDL-Stats/',
            2,
        ),
        /status/i,
    );
    await assert.rejects(
        () => probePublishedData(
            async () => ({ ok: true, async json() { return { domains: [] }; } }),
            'https://example.test/BWEDL-Stats/',
            3,
        ),
        /status/i,
    );

    console.log('public GitHub Pages refresh contract: ok');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
