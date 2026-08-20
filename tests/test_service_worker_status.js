const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const worker = fs.readFileSync(path.resolve(__dirname, '..', 'sw_v31.js'), 'utf8');
const cacheNameMatch = worker.match(/^const CACHE_NAME = '([^']+)';$/m);
assert.ok(cacheNameMatch, 'service worker declares one active cache name');
const currentCacheName = cacheNameMatch[1];
const previousCacheName = 'bwedl-dashboard-v41';
assert.equal(currentCacheName, 'bwedl-dashboard-v42');
assert.notEqual(currentCacheName, previousCacheName);
assert.doesNotMatch(worker, /bwedl-dashboard-v40/);

const listeners = {};
const calls = [];
const deletedCaches = [];
let installedAssets = [];
let fetchImpl = () => Promise.reject(new Error('offline'));
let putImpl = () => Promise.resolve();
const cachedResponse = { source: 'cache' };
const sandbox = {
    URL,
    Request,
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
                put(request, response) { return putImpl(request, response); },
            });
        },
        keys() { return Promise.resolve([previousCacheName, currentCacheName]); },
        delete(name) { deletedCaches.push(name); return Promise.resolve(true); }
    },
    fetch(request) {
        calls.push({ type: 'fetch', url: request.url, cache: request.cache });
        return fetchImpl(request);
    }
};

vm.createContext(sandbox);
vm.runInContext(worker, sandbox);

(async () => {
    let installPromise;
    listeners.install({ waitUntil(promise) { installPromise = promise; } });
    await installPromise;
    assert.ok(installedAssets.includes('./style.css?v=8'));
    assert.ok(installedAssets.includes('./archive_data.js?v=9'));
    assert.ok(installedAssets.includes('./app_utils.js?v=4'));
    assert.ok(installedAssets.includes('./match_preview_model.js?v=1'));
    assert.ok(installedAssets.includes('./calendar_index.js?v=1'));
    assert.ok(installedAssets.includes('./bundle_v31.js?v=3.9'));

    let activatePromise;
    listeners.activate({ waitUntil(promise) { activatePromise = promise; } });
    await activatePromise;
    assert.deepEqual(deletedCaches, [previousCacheName]);

    let releasePut;
    let putCompleted = false;
    const delayedPut = new Promise((resolve) => { releasePut = resolve; }).then(() => { putCompleted = true; });
    const onlineResponse = { status: 200, clone: () => ({ source: 'network-clone' }) };
    fetchImpl = () => Promise.resolve(onlineResponse);
    putImpl = () => delayedPut;
    let onlineResponsePromise;
    let cacheWriteLifetime;
    listeners.fetch({
        request: { method: 'GET', url: 'https://example.test/data_status.js?v=2' },
        respondWith(promise) { onlineResponsePromise = promise; },
        waitUntil(promise) { cacheWriteLifetime = promise; },
    });
    assert.equal(await onlineResponsePromise, onlineResponse, 'network response is not blocked by cache write');
    assert.ok(cacheWriteLifetime instanceof Promise, 'cache write extends the fetch event lifetime');
    assert.equal(putCompleted, false);
    releasePut();
    await cacheWriteLifetime;
    assert.equal(putCompleted, true);

    const cacheFailureResponse = { status: 200, clone: () => ({ source: 'failure-clone' }) };
    fetchImpl = () => Promise.resolve(cacheFailureResponse);
    putImpl = () => Promise.reject(new Error('cache unavailable'));
    let cacheFailureResponsePromise;
    let handledCacheFailure;
    listeners.fetch({
        request: { method: 'GET', url: 'https://example.test/data_status.js?v=3' },
        respondWith(promise) { cacheFailureResponsePromise = promise; },
        waitUntil(promise) { handledCacheFailure = promise; },
    });
    assert.equal(await cacheFailureResponsePromise, cacheFailureResponse);
    await handledCacheFailure;

    calls.length = 0;
    fetchImpl = () => Promise.reject(new Error('offline'));
    let responsePromise;
    const request = { method: 'GET', url: 'https://example.test/data_status.js?v=1' };
    listeners.fetch({
        request,
        respondWith(promise) { responsePromise = promise; },
        waitUntil() {},
    });
    const response = await responsePromise;
    assert.equal(response, cachedResponse);
    assert.deepEqual(calls.map(call => call.type), ['fetch', 'cache']);
    assert.equal(calls[1].url, request.url);
    assert.equal(calls[1].options.ignoreSearch, true);
    assert.deepEqual(Object.keys(calls[1].options), ['ignoreSearch']);

    for (const url of [
        'https://example.test/archive_data.js?v=9',
        'https://example.test/calendar_index.js?v=1',
        'https://example.test/calendar_index.json?v=1',
    ]) {
        calls.length = 0;
        fetchImpl = () => Promise.reject(new Error('offline'));
        let indexResponsePromise;
        listeners.fetch({
            request: { method: 'GET', url },
            respondWith(promise) { indexResponsePromise = promise; },
            waitUntil() {},
        });
        assert.equal(await indexResponsePromise, cachedResponse, `${url} uses network-first cached fallback`);
        assert.deepEqual(calls.map(call => call.type), ['fetch', 'cache']);
        assert.equal(calls[1].options.ignoreSearch, true);
    }

    for (const url of [
        'https://example.test/calendars/club-010-team-2.ics?download=1',
        'https://example.test/calendar_state.json?revision=2',
    ]) {
        calls.length = 0;
        const networkOnlyResponse = { status: 200, type: 'basic', clone: () => ({ source: 'network-clone' }) };
        let forwardedRequest;
        fetchImpl = () => Promise.resolve(networkOnlyResponse);
        putImpl = () => { throw new Error(`${url} must not be cached`); };
        let calendarResponsePromise;
        const originalRequest = new Request(url, {
            method: 'GET',
            headers: { 'X-Calendar-Test': 'preserved' },
            credentials: 'include',
            mode: 'same-origin',
            redirect: 'manual',
        });
        fetchImpl = (request) => {
            forwardedRequest = request;
            return Promise.resolve(networkOnlyResponse);
        };
        listeners.fetch({
            request: originalRequest,
            respondWith(promise) { calendarResponsePromise = promise; },
            waitUntil() {},
        });
        assert.equal(await calendarResponsePromise, networkOnlyResponse, `${url} stays network-only`);
        assert.deepEqual(calls.map(call => call.type), ['fetch']);
        assert.equal(forwardedRequest.url, originalRequest.url);
        assert.equal(forwardedRequest.cache, 'no-store');
        assert.equal(forwardedRequest.method, originalRequest.method);
        assert.equal(forwardedRequest.headers.get('X-Calendar-Test'), 'preserved');
        assert.equal(forwardedRequest.credentials, originalRequest.credentials);
        assert.equal(forwardedRequest.mode, originalRequest.mode);
        assert.equal(forwardedRequest.redirect, originalRequest.redirect);
    }

    calls.length = 0;
    const offlineError = new Error('calendar offline');
    fetchImpl = () => Promise.reject(offlineError);
    let offlineResponsePromise;
    listeners.fetch({
        request: new Request('https://example.test/calendars/club-010-team-2.ics?offline=1'),
        respondWith(promise) { offlineResponsePromise = promise; },
        waitUntil() {},
    });
    await assert.rejects(offlineResponsePromise, offlineError);
    assert.deepEqual(calls.map(call => call.type), ['fetch']);
    assert.equal(calls[0].cache, 'no-store');
    console.log('service worker status fallback: ok');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
