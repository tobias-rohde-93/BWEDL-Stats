// Increment this cache name whenever the static asset list or cache keys change.
const CACHE_NAME = 'bwedl-dashboard-v36';
const urlsToCache = [
    './',
    './index.html',
    './manifest.json',
    './style.css?v=4',
    './bwedl_logo.png',
    './league_data.js?v=5',
    './ranking_data.js?v=4',
    './club_data.js?v=4',
    './archive_data.js?v=8',
    './data_status.json',
    './archive_tables.js?v=5',
    './ligapokal_archive.js?v=3',
    './data_status.js?v=1',
    './app_utils.js?v=1',
    './bundle_v31.js?v=3.4',
    './pwa-icon-192.png',
    './pwa-icon-512.png'
];

self.addEventListener('install', event => {
    // Force new service worker to take over immediately
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', event => {
    // Skip non-GET requests (e.g. POST to /api/update)
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    const isDataFile = url.pathname.endsWith('_data.js') || 
                       url.pathname.endsWith('data_status.json') ||
                       url.pathname.endsWith('data_status.js') ||
                       url.pathname.endsWith('archive_tables.js') ||
                       url.pathname.endsWith('ligapokal_archive.js');

    if (isDataFile) {
        // Network-First Strategy for Data Files
        const matchCachedData = () => caches.match(event.request, { ignoreSearch: true });
        const networkRequest = fetch(event.request);
        const cacheWrite = networkRequest
            .then(response => {
                if (!response || response.status !== 200) return undefined;
                const responseToCache = response.clone();
                return caches.open(CACHE_NAME)
                    .then(cache => cache.put(event.request, responseToCache));
            })
            .catch(() => undefined);
        event.waitUntil(cacheWrite);
        event.respondWith(
            networkRequest
                .then(response => {
                    if (!response || response.status !== 200) {
                        return matchCachedData();
                    }
                    return response;
                })
                .catch(() => {
                    // Start offline or network fail
                    return matchCachedData();
                })
        );
    } else {
        // Cache-First Strategy for Static Assets
        event.respondWith(
            caches.match(event.request)
                .then(response => {
                    if (response) {
                        return response;
                    }
                    const fetchRequest = event.request.clone();
                    return fetch(fetchRequest).then(
                        response => {
                            if (!response || response.status !== 200 || response.type !== 'basic') {
                                return response;
                            }
                            const responseToCache = response.clone();
                            caches.open(CACHE_NAME)
                                .then(cache => {
                                    cache.put(event.request, responseToCache);
                                });
                            return response;
                        }
                    );
                })
        );
    }
});

self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        Promise.all([
            // Claim clients immediately so the new SW controls the page
            self.clients.claim(),
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheWhitelist.indexOf(cacheName) === -1) {
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
        ])
    );
});
