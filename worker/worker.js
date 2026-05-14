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
  // Artists
  handleGetArtist,
  handleGetComposer,
  handleGetArtistsList,
  handleGetComposersList,
  // Admin Artists
  handleAdminGetArtists,
  handleAdminGetArtist,
  handleAdminCreateArtist,
  handleAdminUpdateArtist,
  handleAdminDeleteArtist,
  // Admin Composers
  handleAdminGetComposers,
  handleAdminGetComposer,
  handleAdminCreateComposer,
  handleAdminUpdateComposer,
  handleAdminDeleteComposer,
  // Copyright Owners
  handleGetCopyrightOwner,
  handleGetCopyrightOwnersList,
  handleAdminGetCopyrightOwners,
  handleAdminGetCopyrightOwner,
  handleAdminCreateCopyrightOwner,
  handleAdminUpdateCopyrightOwner,
  handleAdminDeleteCopyrightOwner,
  // Reports
  handleCreateReport,
  handleGetReports,
  handleUpdateReportStatus,
  handleDeleteReport,
  // Contact
  handleCreateContact,
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

      // ─── Artist Public API Routes ─────────────────────

      // GET /api/artists
      if (path === '/api/artists' && method === 'GET') {
        return await handleGetArtistsList(env.DB);
      }

      // GET /api/artist/:slug
      if (path.startsWith('/api/artist/') && method === 'GET') {
        const slug = path.replace('/api/artist/', '').trim();
        return await handleGetArtist(slug, env.DB);
      }

      // ─── Composer Public API Routes ────────────────────

      // GET /api/composers
      if (path === '/api/composers' && method === 'GET') {
        return await handleGetComposersList(env.DB);
      }

      // GET /api/composer/:slug
      if (path.startsWith('/api/composer/') && method === 'GET') {
        const slug = path.replace('/api/composer/', '').trim();
        return await handleGetComposer(slug, env.DB);
      }

      // ─── Admin Artist CRUD Routes ─────────────────────

      // GET /api/admin/artists
      if (path === '/api/admin/artists' && method === 'GET') {
        return await handleAdminGetArtists(env.DB);
      }

      // POST /api/admin/artists
      if (path === '/api/admin/artists' && method === 'POST') {
        return await handleAdminCreateArtist(request, env.DB);
      }

      // GET /api/admin/artist/:id
      if (path.match(/^\/api\/admin\/artist\/\d+$/) && method === 'GET') {
        const id = path.split('/').pop();
        return await handleAdminGetArtist(id, env.DB);
      }

      // PUT /api/admin/artist/:id
      if (path.match(/^\/api\/admin\/artist\/\d+$/) && method === 'PUT') {
        const id = path.split('/').pop();
        return await handleAdminUpdateArtist(id, request, env.DB);
      }

      // DELETE /api/admin/artist/:id
      if (path.match(/^\/api\/admin\/artist\/\d+$/) && method === 'DELETE') {
        const id = path.split('/').pop();
        return await handleAdminDeleteArtist(id, env.DB);
      }

      // ─── Admin Composer CRUD Routes ────────────────────

      // GET /api/admin/composers
      if (path === '/api/admin/composers' && method === 'GET') {
        return await handleAdminGetComposers(env.DB);
      }

      // POST /api/admin/composers
      if (path === '/api/admin/composers' && method === 'POST') {
        return await handleAdminCreateComposer(request, env.DB);
      }

      // GET /api/admin/composer/:id
      if (path.match(/^\/api\/admin\/composer\/\d+$/) && method === 'GET') {
        const id = path.split('/').pop();
        return await handleAdminGetComposer(id, env.DB);
      }

      // PUT /api/admin/composer/:id
      if (path.match(/^\/api\/admin\/composer\/\d+$/) && method === 'PUT') {
        const id = path.split('/').pop();
        return await handleAdminUpdateComposer(id, request, env.DB);
      }

      // DELETE /api/admin/composer/:id
      if (path.match(/^\/api\/admin\/composer\/\d+$/) && method === 'DELETE') {
        const id = path.split('/').pop();
        return await handleAdminDeleteComposer(id, env.DB);
      }

      // ─── Copyright Owner Public API Routes ────────────

      // GET /api/copyright-owners
      if (path === '/api/copyright-owners' && method === 'GET') {
        return await handleGetCopyrightOwnersList(env.DB);
      }

      // GET /api/copyright-owner/:slug
      if (path.startsWith('/api/copyright-owner/') && method === 'GET') {
        const slug = path.replace('/api/copyright-owner/', '').trim();
        return await handleGetCopyrightOwner(slug, env.DB);
      }

      // ─── Admin Copyright Owner CRUD Routes ────────────

      // GET /api/admin/copyright-owners
      if (path === '/api/admin/copyright-owners' && method === 'GET') {
        return await handleAdminGetCopyrightOwners(env.DB);
      }

      // POST /api/admin/copyright-owners
      if (path === '/api/admin/copyright-owners' && method === 'POST') {
        return await handleAdminCreateCopyrightOwner(request, env.DB);
      }

      // GET /api/admin/copyright-owner/:id
      if (path.match(/^\/api\/admin\/copyright-owner\/\d+$/) && method === 'GET') {
        const id = path.split('/').pop();
        return await handleAdminGetCopyrightOwner(id, env.DB);
      }

      // PUT /api/admin/copyright-owner/:id
      if (path.match(/^\/api\/admin\/copyright-owner\/\d+$/) && method === 'PUT') {
        const id = path.split('/').pop();
        return await handleAdminUpdateCopyrightOwner(id, request, env.DB);
      }

      // DELETE /api/admin/copyright-owner/:id
      if (path.match(/^\/api\/admin\/copyright-owner\/\d+$/) && method === 'DELETE') {
        const id = path.split('/').pop();
        return await handleAdminDeleteCopyrightOwner(id, env.DB);
      }

      // ─── Report API Routes ─────────────────────────────

      // POST /api/report — Submit error report
      if (path === '/api/report' && method === 'POST') {
        return await handleCreateReport(request, env.DB, env);
      }

      // GET /api/admin/reports — List all reports
      if (path === '/api/admin/reports' && method === 'GET') {
        return await handleGetReports(env.DB);
      }

      // PUT /api/admin/report/:id — Update report status
      if (path.match(/^\/api\/admin\/report\/\d+$/) && method === 'PUT') {
        const id = path.split('/').pop();
        return await handleUpdateReportStatus(id, request, env.DB);
      }

      // DELETE /api/admin/report/:id — Delete report
      if (path.match(/^\/api\/admin\/report\/\d+$/) && method === 'DELETE') {
        const id = path.split('/').pop();
        return await handleDeleteReport(id, env.DB);
      }

      // ─── Contact API Route ─────────────────────────────

      // POST /api/contact — Submit contact form
      if (path === '/api/contact' && method === 'POST') {
        return await handleCreateContact(request, env.DB, env);
      }

      // ─── Static Files / SPA Routing ────────────────────

      // Static info pages
      if (path === '/about') return await serveAsset(request, env, ctx, '/about.html');
      if (path === '/contact') return await serveAsset(request, env, ctx, '/contact.html');
      if (path === '/faq') return await serveAsset(request, env, ctx, '/faq.html');
      if (path === '/privacy') return await serveAsset(request, env, ctx, '/privacy.html');
      if (path === '/terms') return await serveAsset(request, env, ctx, '/terms.html');
      if (path === '/copyright') return await serveAsset(request, env, ctx, '/copyright.html');

      // Report page: /report → serve report.html
      if (path === '/report') {
        return await serveAsset(request, env, ctx, '/report.html');
      }

      // Song page (clean URLs): /song/some-slug → serve songview.html
      if (path.startsWith('/song/')) {
        return await serveAsset(request, env, ctx, '/songview.html');
      }

      // Artist page (clean URLs): /artist/some-slug → serve artistview.html
      if (path.startsWith('/artist/')) {
        return await serveAsset(request, env, ctx, '/artistview.html');
      }

      // Composer page (clean URLs): /composer/some-slug → serve composerview.html
      if (path.startsWith('/composer/')) {
        return await serveAsset(request, env, ctx, '/composerview.html');
      }

      // Copyright owner page: /copyright-owner/some-slug → serve copyrightownerview.html
      if (path.startsWith('/copyright-owner/')) {
        return await serveAsset(request, env, ctx, '/copyrightownerview.html');
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
