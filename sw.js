// sw.js — Spicetify Furina Service Worker for Offline Playback
const CACHE_NAME = 'spicetify-furina-v1';

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/css/app.css',
  './assets/css/themes.css',
  './assets/js/db.js',
  './assets/js/lyrics.js',
  './assets/js/player.js',
  './assets/js/spotify-api.js',
  './assets/js/spicetify-engine.js',
  './assets/js/app.js',
  './assets/images/furina_logo.jpg',
  './assets/images/furina_bg.jpg',
  './assets/images/furina_portrait.jpg',
  './assets/images/furina_star.jpg',
  './assets/icons/app-icon.jpg',
  './assets/audio/la_vaguelette.wav',
  './assets/audio/fontaine_waltz.wav',
  './assets/audio/hydro_solitaire.wav'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching static assets for offline play');
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Some assets failed to pre-cache:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Clearing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Ignore non-http/https
  if (!url.protocol.startsWith('http')) return;

  // Cache first for audio and image assets
  if (url.pathname.includes('/assets/audio/') || url.pathname.includes('/assets/images/')) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Stale-while-revalidate for html, css, js
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return networkResponse;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
