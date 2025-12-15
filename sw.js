const CACHE_NAME = 'bwedl-dashboard-v12';
const urlsToCache = [
    './',
    './index.html',
    './style.css',
    './script_v13.js',
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
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Return cache hit if found
                if (response) {
                    return response;
                }
                // Clone request stream
                const fetchRequest = event.request.clone();

                return fetch(fetchRequest).then(
                    response => {
                        // Check if valid response
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        // Clone response stream
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
