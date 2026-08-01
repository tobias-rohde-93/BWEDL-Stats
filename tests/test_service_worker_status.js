const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const listeners = {};
const calls = [];
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
        open() { return Promise.resolve({ addAll() {}, put() {} }); },
        keys() { return Promise.resolve([]); },
        delete() { return Promise.resolve(true); }
    },
    fetch(request) {
        calls.push({ type: 'fetch', url: request.url });
        return Promise.reject(new Error('offline'));
    }
};

const worker = fs.readFileSync(path.resolve(__dirname, '..', 'sw_v31.js'), 'utf8');
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
