// ╔══════════════════════════════════════════════════════════════╗
// ║          MaraLyrics — API Route Handlers                    ║
// ╚══════════════════════════════════════════════════════════════╝

import {
  getSongs,
  getSongBySlug,
  searchSongs,
  incrementViews,
  getCategories,
  getPopularSongs,
} from './db.js';

// ─── Helpers ──────────────────────────────────────────────────

/** Build a JSON response with standard headers. */
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60',
      ...extraHeaders,
    },
  });
}

/** 404 JSON response */
function notFound(message = 'Not found') {
  return json({ error: message }, 404);
}

/** 400 JSON response */
function badRequest(message = 'Bad request') {
  return json({ error: message }, 400);
}

/** 429 JSON response */
function tooManyRequests(message = 'Too many requests') {
  return json({ error: message }, 429);
}

/** Sanitize a search query string. */
function sanitizeQuery(q) {
  return (q || '').trim().replace(/[<>"';]/g, '').substring(0, 100);
}

// ─── Simple in-memory rate limiter (per-isolate) ─────────────
const viewRateMap = new Map();
const RATE_LIMIT_MS = 60 * 60 * 1000; // 1 hour

function isRateLimited(slug, ip) {
  const key = `${slug}:${ip}`;
  const last = viewRateMap.get(key);
  if (last && Date.now() - last < RATE_LIMIT_MS) return true;
  viewRateMap.set(key, Date.now());
  // Cleanup old entries periodically
  if (viewRateMap.size > 5000) {
    const cutoff = Date.now() - RATE_LIMIT_MS;
    for (const [k, v] of viewRateMap) {
      if (v < cutoff) viewRateMap.delete(k);
    }
  }
  return false;
}

// ─── Route Handlers ──────────────────────────────────────────

/**
 * GET /api/songs?page=1&limit=20&category=Traditional
 */
export async function handleGetSongs(request, db) {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));
  const category = sanitizeQuery(url.searchParams.get('category')) || null;

  const data = await getSongs(db, page, limit, category);
  return json(data);
}

/**
 * GET /api/song/:slug
 */
export async function handleGetSong(slug, db) {
  if (!slug) return badRequest('Slug is required');

  const song = await getSongBySlug(db, slug);
  if (!song) return notFound('Song not found');

  return json(song, 200, {
    'Cache-Control': 'public, max-age=300',
  });
}

/**
 * GET /api/search?q=keyword
 */
export async function handleSearch(request, db) {
  const url = new URL(request.url);
  const q = sanitizeQuery(url.searchParams.get('q'));
  if (!q || q.length < 1) return badRequest('Search query too short');

  const results = await searchSongs(db, q);
  return json({ query: q, results, count: results.length });
}

/**
 * POST /api/view/:slug
 * Increments view counter with rate limiting.
 */
export async function handleViewIncrement(slug, request, db) {
  if (!slug) return badRequest('Slug is required');

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (isRateLimited(slug, ip)) {
    return tooManyRequests('View already counted recently');
  }

  const updated = await incrementViews(db, slug);
  if (!updated) return notFound('Song not found');

  return json({ success: true, slug });
}

/**
 * GET /api/categories
 */
export async function handleGetCategories(db) {
  const categories = await getCategories(db);
  return json({ categories }, 200, {
    'Cache-Control': 'public, max-age=600',
  });
}

/**
 * GET /api/popular?limit=10
 */
export async function handleGetPopular(request, db) {
  const url = new URL(request.url);
  const limit = Math.min(30, Math.max(1, parseInt(url.searchParams.get('limit') || '10', 10)));

  const songs = await getPopularSongs(db, limit);
  return json({ songs });
}
