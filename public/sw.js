/**
 * CLOUDSTOCK PWA SERVICE WORKER
 * This file is automatically versioned by Vite on every build.
 */

const CACHE_VERSION = '1714553200000'; // AUTO-REPLACED BY VITE
const CACHE_NAME = `cloudstock-${CACHE_VERSION}`;

// Assets that should be cached first for speed
const STATIC_ASSETS = [
  '/manifest.json',
  '/LOGO.png'
];

// Helper to check if a request is for an asset (JS, CSS, Images, Fonts)
const isAsset = (url) => {
  return url.pathname.includes('/assets/') || 
         url.pathname.endsWith('.png') || 
         url.pathname.endsWith('.jpg') || 
         url.pathname.endsWith('.jpeg') || 
         url.pathname.endsWith('.svg') || 
         url.pathname.endsWith('.webp') || 
         url.pathname.endsWith('.woff') || 
         url.pathname.endsWith('.woff2');
};

// Helper to check if a request should NEVER be cached (Firebase, Google APIs)
const isExternalApi = (url) => {
  return url.hostname.includes('firebase') || 
         url.hostname.includes('googleapis') || 
         url.hostname.includes('google.com');
};

// Install Event
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Do not wait for old worker to close
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim(); // Take control of all tabs immediately
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 1. Never cache Firebase/Google APIs
  if (isExternalApi(url)) {
    return; // Let browser handle it (no caching)
  }

  // 2. index.html / Navigation: Network-Only (with offline fallback)
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/'); // Return root from cache ONLY if offline
      })
    );
    return;
  }

  // 3. Assets (JS, CSS, Images): Cache-First Strategy
  if (isAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        
        return fetch(event.request).then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) return networkResponse;
          
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        });
      })
    );
    return;
  }

  // 4. Everything else: Network-First Strategy
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// Listen for SKIP_WAITING message
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
