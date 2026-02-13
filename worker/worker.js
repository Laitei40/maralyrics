// ╔══════════════════════════════════════════════════════════════╗
// ║         MaraLyrics — Cloudflare Worker Entry Point          ║
// ╚══════════════════════════════════════════════════════════════╝

import { getAssetFromKV, NotFoundError } from '@cloudflare/kv-asset-handler';
import manifestJSON from '__STATIC_CONTENT_MANIFEST';

import {
  handleGetSongs,
  handleGetSong,
  handleSearch,
  handleViewIncrement,
  handleGetCategories,
  handleGetPopular,
  handleAdminGetSong,
  handleAdminCreateSong,
  handleAdminUpdateSong,
  handleAdminDeleteSong,
} from './routes.js';

const assetManifest = JSON.parse(manifestJSON);

export default {
  /**
   * Main fetch handler for all incoming requests.
   * Routes to API handlers or serves static files.
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ─── CORS Preflight ────────────────────────────────
    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    try {
      // ─── API Routes ────────────────────────────────────

      // GET /api/songs
      if (path === '/api/songs' && method === 'GET') {
        return await handleGetSongs(request, env.DB);
      }

      // GET /api/categories
      if (path === '/api/categories' && method === 'GET') {
        return await handleGetCategories(env.DB);
      }

      // GET /api/popular
      if (path === '/api/popular' && method === 'GET') {
        return await handleGetPopular(request, env.DB);
      }

      // GET /api/search?q=
      if (path === '/api/search' && method === 'GET') {
        return await handleSearch(request, env.DB);
      }

      // GET /api/song/:slug
      if (path.startsWith('/api/song/') && method === 'GET') {
        const slug = path.replace('/api/song/', '').trim();
        return await handleGetSong(slug, env.DB);
      }

      // POST /api/view/:slug
      if (path.startsWith('/api/view/') && method === 'POST') {
        const slug = path.replace('/api/view/', '').trim();
        return await handleViewIncrement(slug, request, env.DB);
      }

      // ─── Admin API Routes ──────────────────────────────

      // GET /api/admin/songs (reuse paginated list with higher limit)
      if (path === '/api/admin/songs' && method === 'GET') {
        return await handleGetSongs(request, env.DB);
      }

      // POST /api/admin/songs — Create
      if (path === '/api/admin/songs' && method === 'POST') {
        return await handleAdminCreateSong(request, env.DB);
      }

      // GET /api/admin/song/:id — Get by ID
      if (path.match(/^\/api\/admin\/song\/\d+$/) && method === 'GET') {
        const id = path.split('/').pop();
        return await handleAdminGetSong(id, env.DB);
      }

      // PUT /api/admin/song/:id — Update
      if (path.match(/^\/api\/admin\/song\/\d+$/) && method === 'PUT') {
        const id = path.split('/').pop();
        return await handleAdminUpdateSong(id, request, env.DB);
      }

      // DELETE /api/admin/song/:id — Delete
      if (path.match(/^\/api\/admin\/song\/\d+$/) && method === 'DELETE') {
        const id = path.split('/').pop();
        return await handleAdminDeleteSong(id, env.DB);
      }

      // ─── Static Files / SPA Routing ────────────────────

      // Song page (clean URLs): /song/some-slug → serve song/index.html
      if (path.startsWith('/song/')) {
        return await serveAsset(request, env, ctx, '/song/index.html');
      }

      // Try to serve the static asset directly
      return await serveAsset(request, env, ctx, path);

    } catch (err) {
      console.error('Worker error:', err);
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  },
};

/**
 * Serve a static file using @cloudflare/kv-asset-handler.
 * Handles caching, ETags, content-type detection, and 404 fallback.
 * @param {Request} request
 * @param {object} env
 * @param {object} ctx
 * @param {string} overridePath - Optional path override (e.g., serve song.html for /song/:slug)
 */
async function serveAsset(request, env, ctx, overridePath = null) {
  const options = {
    ASSET_NAMESPACE: env.__STATIC_CONTENT,
    ASSET_MANIFEST: assetManifest,
    cacheControl: {
      bypassCache: false,
      edgeTTL: 60 * 60 * 24, // 24h at CDN edge
      browserTTL: 60 * 60,    // 1h in browser
    },
  };

  // If we need to override the URL path (e.g., /song/:slug → /song.html)
  if (overridePath) {
    const url = new URL(request.url);
    url.pathname = overridePath;
    request = new Request(url.toString(), request);
  }

  try {
    const response = await getAssetFromKV(
      { request, waitUntil: ctx.waitUntil.bind(ctx) },
      options
    );

    // Add security headers
    const headers = new Response(response.body, response);
    headers.headers.set('X-Content-Type-Options', 'nosniff');
    headers.headers.set('X-Frame-Options', 'DENY');
    headers.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    return headers;

  } catch (e) {
    if (e instanceof NotFoundError) {
      // Serve 404.html page
      try {
        const url = new URL(request.url);
        url.pathname = '/404.html';
        const notFoundReq = new Request(url.toString(), request);
        const notFoundResp = await getAssetFromKV(
          { request: notFoundReq, waitUntil: ctx.waitUntil.bind(ctx) },
          options
        );
        return new Response(notFoundResp.body, {
          ...notFoundResp,
          status: 404,
          headers: notFoundResp.headers,
        });
      } catch {
        return new Response('Page not found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    }
    throw e;
  }
}
