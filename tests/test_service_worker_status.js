const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const worker = fs.readFileSync(path.resolve(__dirname, '..', 'sw_v31.js'), 'utf8');
const cacheNameMatch = worker.match(/^const CACHE_NAME = '([^']+)';$/m);
assert.ok(cacheNameMatch, 'service worker declares one active cache name');
const currentCacheName = cacheNameMatch[1];
const previousCacheName = 'bwedl-dashboard-v33';
assert.equal(currentCacheName, 'bwedl-dashboard-v34');
assert.notEqual(currentCacheName, previousCacheName);
assert.doesNotMatch(worker, /bwedl-dashboard-v33/);

const listeners = {};
const calls = [];
const deletedCaches = [];
let installedAssets = [];
const cachedResponse = { source: 'cache' };
const sandbox = {
    URL,
    Promise,
    self: {
        addEventListener(type, handler) { listeners[type] = handler; },
        skipWaiting() {},
        clients: { claim() { return Promise.resolve(); } }
    },
    caches: {
        match(request, options) {
            calls.push({ type: 'cache', url: request.url, options });
            return Promise.resolve(cachedResponse);
        },
        open() {
            return Promise.resolve({
                addAll(assets) { installedAssets = [...assets]; return Promise.resolve(); },
                put() {},
            });
        },
        keys() { return Promise.resolve([previousCacheName, currentCacheName]); },
        delete(name) { deletedCaches.push(name); return Promise.resolve(true); }
    },
    fetch(request) {
        calls.push({ type: 'fetch', url: request.url });
        return Promise.reject(new Error('offline'));
    }
};

vm.createContext(sandbox);
vm.runInContext(worker, sandbox);

let responsePromise;
const request = {
    method: 'GET',
    url: 'https://example.test/data_status.js?v=1'
};
listeners.fetch({
    request,
    respondWith(promise) { responsePromise = promise; }
});

(async () => {
    let installPromise;
    listeners.install({ waitUntil(promise) { installPromise = promise; } });
    await installPromise;
    assert.ok(installedAssets.includes('./style.css?v=3'));
    assert.ok(installedAssets.includes('./app_utils.js?v=1'));
    assert.ok(installedAssets.includes('./bundle_v31.js?v=3.2'));

    let activatePromise;
    listeners.activate({ waitUntil(promise) { activatePromise = promise; } });
    await activatePromise;
    assert.deepEqual(deletedCaches, [previousCacheName]);

    const response = await responsePromise;
    assert.equal(response, cachedResponse);
    assert.deepEqual(calls.map(call => call.type), ['fetch', 'cache']);
    assert.equal(calls[1].url, request.url);
    assert.equal(calls[1].options.ignoreSearch, true);
    assert.deepEqual(Object.keys(calls[1].options), ['ignoreSearch']);
    console.log('service worker status fallback: ok');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
