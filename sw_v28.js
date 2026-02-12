const CACHE_NAME = 'bwedl-dashboard-v32-network-first';
const urlsToCache = [
    './',
    './index.html',
    './style.css',
    './bundle_v28.js',
    './league_data.js',
    './ranking_data.js',
    './club_data.js',
    './archive_data.js',
    './archive_tables.js',
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
    const isDataFile = url.pathname.endsWith('_data.js') || url.pathname.endsWith('archive_tables.js');

    if (isDataFile) {
        // Network-First Strategy for Data Files
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Check if valid response
                    if (!response || response.status !== 200) {
                        return caches.match(event.request);
                    }

                    // Clone response stream
                    const responseToCache = response.clone();

                    caches.open(CACHE_NAME)
                        .then(cache => {
                            cache.put(event.request, responseToCache);
                        });

                    return response;
                })
                .catch(() => {
                    // Start offline or network fail
                    return caches.match(event.request);
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
