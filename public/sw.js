// ╔══════════════════════════════════════════════════════════════╗
// ║       MaraLyrics — Smart Cache Service Worker               ║
// ║       Stale-While-Revalidate · Offline-First                ║
// ╚══════════════════════════════════════════════════════════════╝

const CACHE_VERSION = 'ml-v11';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;

// Core assets to precache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/consent.js',
  '/toast.js',
  '/app.js',
  '/i18n.js',
  '/theme.js',
  '/404.html',
  '/locales/en.json',
  '/locales/mrh.json',
  '/locales/my.json',
];

// Page shells that should be cached when visited
const PAGE_SHELLS = [
  '/songview.html',
  '/artistview.html',
  '/composerview.html',
  '/copyrightownerview.html',
  '/about/',
  '/contact/',
  '/copyright/',
  '/faq/',
  '/privacy/',
  '/terms/',
  '/report/',
];

// ─── Install: Precache core assets ────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate: Clean old caches ───────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((k) => k.startsWith('ml-') && k !== STATIC_CACHE && k !== API_CACHE && k !== PAGE_CACHE)
          .map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// ─── Fetch: Smart routing strategy ────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip admin paths, external origins (except fonts/CDN)
  if (url.pathname.startsWith('/admin')) return;

  // ── API requests: Network-first with cache fallback ──
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithCache(request, API_CACHE, 5 * 60 * 1000));
    return;
  }

  // ── SPA page routes (e.g. /song/slug, /artist/slug) ──
  // Network-first: let Pages Functions / Worker handle routing,
  // fall back to cached shell HTML when offline.
  if (isSpaRoute(url.pathname)) {
    event.respondWith(serveSpaShell(request, url.pathname));
    return;
  }

  // ── Static assets: Cache-first ──
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirstWithNetwork(request, STATIC_CACHE));
    return;
  }

  // ── HTML pages: Stale-while-revalidate ──
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(staleWhileRevalidate(request, PAGE_CACHE));
    return;
  }

  // ── Everything else: Network with cache fallback ──
  event.respondWith(networkFirstWithCache(request, STATIC_CACHE, 24 * 60 * 60 * 1000));
});

// ─── Strategies ───────────────────────────────────────────────

/**
 * Network-first: Try network, cache the response, fall back to cache.
 * Good for API calls where freshness matters but offline should work.
 */
async function networkFirstWithCache(request, cacheName, maxAge) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // For API, return a JSON error so the app can handle gracefully
    if (request.url.includes('/api/')) {
      return new Response(
        JSON.stringify({ error: 'Offline', offline: true }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return (await caches.match('/404.html')) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/html' } });
  }
}

/**
 * Cache-first: Check cache, fallback to network (and cache the result).
 * Good for static assets that rarely change.
 */
async function cacheFirstWithNetwork(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match('/404.html')) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/html' } });
  }
}

/**
 * Stale-while-revalidate: Return cached immediately, update in background.
 * Good for HTML pages — fast load + eventual freshness.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || (await fetchPromise) || (await caches.match('/404.html')) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/html' } });
}

/**
 * Serve the correct SPA shell for dynamic routes.
 * Network-first: let the server handle the request (Pages Function / Worker),
 * cache the shell response, and fall back to cache when offline.
 */
async function serveSpaShell(request, pathname) {
  let shellPath;
  if (pathname.startsWith('/song/')) shellPath = '/songview.html';
  else if (pathname.startsWith('/artist/')) shellPath = '/artistview.html';
  else if (pathname.startsWith('/composer/')) shellPath = '/composerview.html';
  else if (pathname.startsWith('/copyright-owner/')) shellPath = '/copyrightownerview.html';
  else shellPath = '/index.html';

  // Network-first: try the actual request first
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(PAGE_CACHE);
      cache.put(shellPath, response.clone());
    }
    return response;
  } catch {
    // Offline: serve cached shell HTML
    const cached = await caches.match(shellPath);
    if (cached) return cached;
    return (await caches.match('/404.html')) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/html' } });
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function isSpaRoute(path) {
  return /^\/(song|artist|composer|copyright-owner)\//.test(path);
}

function isStaticAsset(path) {
  return /\.(css|js|json|svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot)(\?.*)?$/.test(path);
}

// ─── Background Sync: Prefetch popular content ────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'PRECACHE_PAGES') {
    // Cache page shells in background
    caches.open(PAGE_CACHE).then((cache) => {
      PAGE_SHELLS.forEach((page) => {
        cache.match(page).then((existing) => {
          if (!existing) {
            fetch(page).then((res) => {
              if (res.ok) cache.put(page, res);
            }).catch(() => {});
          }
        });
      });
    });
  }

  if (event.data?.type === 'PRECACHE_API') {
    // Cache API responses for popular/categories
    const apiBase = event.data.apiBase || '/api';
    caches.open(API_CACHE).then((cache) => {
      ['/popular?limit=6', '/categories'].forEach((endpoint) => {
        const url = apiBase + endpoint;
        fetch(url).then((res) => {
          if (res.ok) cache.put(url, res);
        }).catch(() => {});
      });
    });
  }
});
