// ╔══════════════════════════════════════════════════════════════╗
// ║          MaraLyrics — API Route Handlers                    ║
// ╚══════════════════════════════════════════════════════════════╝

import {
  getSongs,
  getSongBySlug,
  getSongBySlugRaw,
  searchSongs,
  incrementViews,
  getCategories,
  getPopularSongs,
  getSongById,
  createSong,
  updateSong,
  deleteSong,
  // Artists
  getArtists,
  getArtistBySlug,
  getArtistById,
  getSongsByArtist,
  createArtist,
  updateArtist,
  deleteArtist,
  // Composers
  getComposers,
  getComposerBySlug,
  getComposerById,
  getSongsByComposer,
  createComposer,
  updateComposer,
  deleteComposer,
  // Copyright Owners
  getCopyrightOwners,
  getCopyrightOwnerBySlug,
  getCopyrightOwnerById,
  getSongsByCopyrightOwner,
  createCopyrightOwner,
  updateCopyrightOwner,
  deleteCopyrightOwner,
  // Reports
  createReport,
  getReports,
  updateReportStatus,
  deleteReport,
  // Contact
  createContact,
} from './db.js';

// ─── Helpers ──────────────────────────────────────────────────

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

function notFound(message = 'Not found') { return json({ error: message }, 404); }
function badRequest(message = 'Bad request') { return json({ error: message }, 400); }
function tooManyRequests(message = 'Too many requests') { return json({ error: message }, 429); }

function sanitizeQuery(q) {
  return (q || '').trim().replace(/[<>"';]/g, '').substring(0, 100);
}

function generateSlug(text) {
  return text
    .toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Rate limiter ────────────────────────────────────────────
const viewRateMap = new Map();
const RATE_LIMIT_MS = 60 * 60 * 1000;

function isRateLimited(slug, ip) {
  const key = `${slug}:${ip}`;
  const last = viewRateMap.get(key);
  if (last && Date.now() - last < RATE_LIMIT_MS) return true;
  viewRateMap.set(key, Date.now());
  if (viewRateMap.size > 5000) {
    const cutoff = Date.now() - RATE_LIMIT_MS;
    for (const [k, v] of viewRateMap) { if (v < cutoff) viewRateMap.delete(k); }
  }
  return false;
}

// ─── Song Route Handlers ─────────────────────────────────────

export async function handleGetSongs(request, db) {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));
  const category = sanitizeQuery(url.searchParams.get('category')) || null;
  const data = await getSongs(db, page, limit, category);
  return json(data);
}

export async function handleGetSong(slug, db) {
  if (!slug) return badRequest('Slug is required');
  const song = await getSongBySlug(db, slug);
  if (!song) return notFound('Song not found');
  return json(song, 200, { 'Cache-Control': 'public, max-age=300' });
}

export async function handleSearch(request, db) {
  const url = new URL(request.url);
  const q = sanitizeQuery(url.searchParams.get('q'));
  if (!q || q.length < 1) return badRequest('Search query too short');
  const results = await searchSongs(db, q);
  return json({ query: q, results, count: results.length });
}

export async function handleViewIncrement(slug, request, db) {
  if (!slug) return badRequest('Slug is required');
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (isRateLimited(slug, ip)) return tooManyRequests('View already counted recently');
  const updated = await incrementViews(db, slug);
  if (!updated) return notFound('Song not found');
  return json({ success: true, slug });
}

export async function handleGetCategories(db) {
  const categories = await getCategories(db);
  return json({ categories }, 200, { 'Cache-Control': 'public, max-age=600' });
}

export async function handleGetPopular(request, db) {
  const url = new URL(request.url);
  const limit = Math.min(30, Math.max(1, parseInt(url.searchParams.get('limit') || '10', 10)));
  const songs = await getPopularSongs(db, limit);
  return json({ songs });
}

// ─── Artist / Composer Public Routes ─────────────────────────

export async function handleGetArtist(slug, db) {
  if (!slug) return badRequest('Slug is required');
  const artist = await getArtistBySlug(db, slug);
  if (!artist) return notFound('Artist not found');
  const songs = await getSongsByArtist(db, artist.id);
  return json({ ...artist, songs }, 200, { 'Cache-Control': 'public, max-age=300' });
}

export async function handleGetComposer(slug, db) {
  if (!slug) return badRequest('Slug is required');
  const composer = await getComposerBySlug(db, slug);
  if (!composer) return notFound('Composer not found');
  const songs = await getSongsByComposer(db, composer.id);
  return json({ ...composer, songs }, 200, { 'Cache-Control': 'public, max-age=300' });
}

export async function handleGetArtistsList(db) {
  const artists = await getArtists(db);
  return json({ artists }, 200, { 'Cache-Control': 'public, max-age=300' });
}

export async function handleGetComposersList(db) {
  const composers = await getComposers(db);
  return json({ composers }, 200, { 'Cache-Control': 'public, max-age=300' });
}

// ─── Admin Song CRUD ─────────────────────────────────────────

export async function handleAdminGetSong(id, db) {
  if (!id) return badRequest('Song ID is required');
  const song = await getSongById(db, parseInt(id, 10));
  if (!song) return notFound('Song not found');
  return json(song);
}

export async function handleAdminCreateSong(request, db) {
  let body;
  try { body = await request.json(); } catch { return badRequest('Invalid JSON body'); }

  const { title, artist_id, composer_id, copyright_owner_id, category, lyrics } = body;
  let { slug } = body;

  if (!title || !title.trim()) return badRequest('Title is required');
  if (!lyrics || !lyrics.trim()) return badRequest('Lyrics are required');

  slug = (slug && slug.trim()) ? slug.trim() : generateSlug(title);

  const existing = await getSongBySlugRaw(db, slug);
  if (existing) return json({ error: 'A song with this slug already exists' }, 409);

  const result = await createSong(db, {
    title: title.trim(),
    slug,
    artist_id: artist_id ? parseInt(artist_id, 10) : null,
    composer_id: composer_id ? parseInt(composer_id, 10) : null,
    copyright_owner_id: copyright_owner_id ? parseInt(copyright_owner_id, 10) : null,
    category: category?.trim() || null,
    lyrics: lyrics.trim(),
  });

  return json({ success: true, id: result.id, slug }, 201);
}

export async function handleAdminUpdateSong(id, request, db) {
  if (!id) return badRequest('Song ID is required');
  let body;
  try { body = await request.json(); } catch { return badRequest('Invalid JSON body'); }

  const { title, artist_id, composer_id, copyright_owner_id, category, lyrics } = body;
  let { slug } = body;

  if (!title || !title.trim()) return badRequest('Title is required');
  if (!lyrics || !lyrics.trim()) return badRequest('Lyrics are required');

  slug = (slug && slug.trim()) ? slug.trim() : generateSlug(title);

  const existing = await getSongBySlugRaw(db, slug);
  if (existing && existing.id !== parseInt(id, 10)) {
    return json({ error: 'A different song with this slug already exists' }, 409);
  }

  const updated = await updateSong(db, parseInt(id, 10), {
    title: title.trim(),
    slug,
    artist_id: artist_id ? parseInt(artist_id, 10) : null,
    composer_id: composer_id ? parseInt(composer_id, 10) : null,
    copyright_owner_id: copyright_owner_id ? parseInt(copyright_owner_id, 10) : null,
    category: category?.trim() || null,
    lyrics: lyrics.trim(),
  });

  if (!updated) return notFound('Song not found');
  return json({ success: true, id: parseInt(id, 10), slug });
}

export async function handleAdminDeleteSong(id, db) {
  if (!id) return badRequest('Song ID is required');
  const deleted = await deleteSong(db, parseInt(id, 10));
  if (!deleted) return notFound('Song not found');
  return json({ success: true });
}

// ─── Admin Artist CRUD ───────────────────────────────────────

export async function handleAdminGetArtists(db) {
  const artists = await getArtists(db);
  return json({ artists });
}

export async function handleAdminGetArtist(id, db) {
  if (!id) return badRequest('Artist ID is required');
  const artist = await getArtistById(db, parseInt(id, 10));
  if (!artist) return notFound('Artist not found');
  return json(artist);
}

export async function handleAdminCreateArtist(request, db) {
  let body;
  try { body = await request.json(); } catch { return badRequest('Invalid JSON body'); }

  const { name, bio, image_url, social_links } = body;
  let { slug } = body;

  if (!name || !name.trim()) return badRequest('Name is required');
  slug = (slug && slug.trim()) ? slug.trim() : generateSlug(name);

  const existing = await getArtistBySlug(db, slug);
  if (existing) return json({ error: 'An artist with this slug already exists' }, 409);

  const result = await createArtist(db, {
    name: name.trim(), slug, bio: bio?.trim() || null, image_url: image_url?.trim() || null,
    social_links: social_links || null,
  });
  return json({ success: true, id: result.id, slug }, 201);
}

export async function handleAdminUpdateArtist(id, request, db) {
  if (!id) return badRequest('Artist ID is required');
  let body;
  try { body = await request.json(); } catch { return badRequest('Invalid JSON body'); }

  const { name, bio, image_url, social_links } = body;
  let { slug } = body;

  if (!name || !name.trim()) return badRequest('Name is required');
  slug = (slug && slug.trim()) ? slug.trim() : generateSlug(name);

  const existing = await getArtistBySlug(db, slug);
  if (existing && existing.id !== parseInt(id, 10)) {
    return json({ error: 'A different artist with this slug already exists' }, 409);
  }

  const updated = await updateArtist(db, parseInt(id, 10), {
    name: name.trim(), slug, bio: bio?.trim() || null, image_url: image_url?.trim() || null,
    social_links: social_links || null,
  });
  if (!updated) return notFound('Artist not found');
  return json({ success: true, id: parseInt(id, 10), slug });
}

export async function handleAdminDeleteArtist(id, db) {
  if (!id) return badRequest('Artist ID is required');
  const deleted = await deleteArtist(db, parseInt(id, 10));
  if (!deleted) return notFound('Artist not found');
  return json({ success: true });
}

// ─── Admin Composer CRUD ─────────────────────────────────────

export async function handleAdminGetComposers(db) {
  const composers = await getComposers(db);
  return json({ composers });
}

export async function handleAdminGetComposer(id, db) {
  if (!id) return badRequest('Composer ID is required');
  const composer = await getComposerById(db, parseInt(id, 10));
  if (!composer) return notFound('Composer not found');
  return json(composer);
}

export async function handleAdminCreateComposer(request, db) {
  let body;
  try { body = await request.json(); } catch { return badRequest('Invalid JSON body'); }

  const { name, bio, image_url, social_links } = body;
  let { slug } = body;

  if (!name || !name.trim()) return badRequest('Name is required');
  slug = (slug && slug.trim()) ? slug.trim() : generateSlug(name);

  const existing = await getComposerBySlug(db, slug);
  if (existing) return json({ error: 'A composer with this slug already exists' }, 409);

  const result = await createComposer(db, {
    name: name.trim(), slug, bio: bio?.trim() || null, image_url: image_url?.trim() || null,
    social_links: social_links || null,
  });
  return json({ success: true, id: result.id, slug }, 201);
}

export async function handleAdminUpdateComposer(id, request, db) {
  if (!id) return badRequest('Composer ID is required');
  let body;
  try { body = await request.json(); } catch { return badRequest('Invalid JSON body'); }

  const { name, bio, image_url, social_links } = body;
  let { slug } = body;

  if (!name || !name.trim()) return badRequest('Name is required');
  slug = (slug && slug.trim()) ? slug.trim() : generateSlug(name);

  const existing = await getComposerBySlug(db, slug);
  if (existing && existing.id !== parseInt(id, 10)) {
    return json({ error: 'A different composer with this slug already exists' }, 409);
  }

  const updated = await updateComposer(db, parseInt(id, 10), {
    name: name.trim(), slug, bio: bio?.trim() || null, image_url: image_url?.trim() || null,
    social_links: social_links || null,
  });
  if (!updated) return notFound('Composer not found');
  return json({ success: true, id: parseInt(id, 10), slug });
}

export async function handleAdminDeleteComposer(id, db) {
  if (!id) return badRequest('Composer ID is required');
  const deleted = await deleteComposer(db, parseInt(id, 10));
  if (!deleted) return notFound('Composer not found');
  return json({ success: true });
}

// ─── Copyright Owner Public Route ────────────────────────────

export async function handleGetCopyrightOwner(slug, db) {
  if (!slug) return badRequest('Slug is required');
  const owner = await getCopyrightOwnerBySlug(db, slug);
  if (!owner) return notFound('Copyright owner not found');
  const songs = await getSongsByCopyrightOwner(db, owner.id);
  return json({ ...owner, songs }, 200, { 'Cache-Control': 'public, max-age=300' });
}

export async function handleGetCopyrightOwnersList(db) {
  const owners = await getCopyrightOwners(db);
  return json({ copyright_owners: owners }, 200, { 'Cache-Control': 'public, max-age=300' });
}

// ─── Admin Copyright Owner CRUD ──────────────────────────────

export async function handleAdminGetCopyrightOwners(db) {
  const owners = await getCopyrightOwners(db);
  return json({ copyright_owners: owners });
}

export async function handleAdminGetCopyrightOwner(id, db) {
  if (!id) return badRequest('Copyright Owner ID is required');
  const owner = await getCopyrightOwnerById(db, parseInt(id, 10));
  if (!owner) return notFound('Copyright owner not found');
  return json(owner);
}

export async function handleAdminCreateCopyrightOwner(request, db) {
  let body;
  try { body = await request.json(); } catch { return badRequest('Invalid JSON body'); }

  const { name, full_legal_name, organization, territory, email, website, address, ipi_number, isrc_prefix, pro_affiliation, notes } = body;
  let { slug } = body;

  if (!name || !name.trim()) return badRequest('Name is required');
  slug = (slug && slug.trim()) ? slug.trim() : generateSlug(name);

  const existing = await getCopyrightOwnerBySlug(db, slug);
  if (existing) return json({ error: 'A copyright owner with this slug already exists' }, 409);

  const result = await createCopyrightOwner(db, {
    name: name.trim(), slug,
    full_legal_name: full_legal_name?.trim() || null,
    organization: organization?.trim() || null,
    territory: territory?.trim() || null,
    email: email?.trim() || null,
    website: website?.trim() || null,
    address: address?.trim() || null,
    ipi_number: ipi_number?.trim() || null,
    isrc_prefix: isrc_prefix?.trim() || null,
    pro_affiliation: pro_affiliation?.trim() || null,
    notes: notes?.trim() || null,
  });
  return json({ success: true, id: result.id, slug }, 201);
}

export async function handleAdminUpdateCopyrightOwner(id, request, db) {
  if (!id) return badRequest('Copyright Owner ID is required');
  let body;
  try { body = await request.json(); } catch { return badRequest('Invalid JSON body'); }

  const { name, full_legal_name, organization, territory, email, website, address, ipi_number, isrc_prefix, pro_affiliation, notes } = body;
  let { slug } = body;

  if (!name || !name.trim()) return badRequest('Name is required');
  slug = (slug && slug.trim()) ? slug.trim() : generateSlug(name);

  const existing = await getCopyrightOwnerBySlug(db, slug);
  if (existing && existing.id !== parseInt(id, 10)) {
    return json({ error: 'A different copyright owner with this slug already exists' }, 409);
  }

  const updated = await updateCopyrightOwner(db, parseInt(id, 10), {
    name: name.trim(), slug,
    full_legal_name: full_legal_name?.trim() || null,
    organization: organization?.trim() || null,
    territory: territory?.trim() || null,
    email: email?.trim() || null,
    website: website?.trim() || null,
    address: address?.trim() || null,
    ipi_number: ipi_number?.trim() || null,
    isrc_prefix: isrc_prefix?.trim() || null,
    pro_affiliation: pro_affiliation?.trim() || null,
    notes: notes?.trim() || null,
  });
  if (!updated) return notFound('Copyright owner not found');
  return json({ success: true, id: parseInt(id, 10), slug });
}

export async function handleAdminDeleteCopyrightOwner(id, db) {
  if (!id) return badRequest('Copyright Owner ID is required');
  const deleted = await deleteCopyrightOwner(db, parseInt(id, 10));
  if (!deleted) return notFound('Copyright owner not found');
  return json({ success: true });
}

// ╔══════════════════════════════════════════════════════════════╗
// ║                    Report Handlers                          ║
// ╚══════════════════════════════════════════════════════════════╝

export async function handleCreateReport(request, db, env) {
  const { song_slug, song_title, song_artist, reporter_name, reporter_email, body, turnstile_token } = await request.json();

  if (!reporter_name || !reporter_email || !body) {
    return badRequest('Name, email, and description are required.');
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reporter_email)) {
    return badRequest('Invalid email address.');
  }

  // Verify Cloudflare Turnstile token
  if (!turnstile_token) {
    return badRequest('Verification challenge is required.');
  }
  try {
    const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET,
        response: turnstile_token,
      }),
    });
    const tsData = await tsRes.json();
    if (!tsData.success) {
      return json({ error: 'Verification failed. Please try again.' }, 403);
    }
  } catch (err) {
    console.error('Turnstile verification error:', err);
    return json({ error: 'Verification service unavailable.' }, 500);
  }

  const result = await createReport(db, { song_slug, song_title, song_artist, reporter_name, reporter_email, body });

  return json({ success: true, id: result.id }, 201);
}

export async function handleGetReports(db) {
  const reports = await getReports(db);
  return json({ reports });
}

export async function handleUpdateReportStatus(id, request, db) {
  const { status } = await request.json();
  if (!status) return badRequest('Status is required');
  const updated = await updateReportStatus(db, parseInt(id, 10), status);
  if (!updated) return notFound('Report not found');
  return json({ success: true });
}

export async function handleDeleteReport(id, db) {
  const deleted = await deleteReport(db, parseInt(id, 10));
  if (!deleted) return notFound('Report not found');
  return json({ success: true });
}

// ─── Contact ─────────────────────────────────────────────────

export async function handleCreateContact(request, db, env) {
  const { name, email, subject, message, turnstile_token } = await request.json();

  if (!name || !email || !message) {
    return badRequest('Name, email, and message are required.');
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return badRequest('Invalid email address.');
  }

  // Verify Cloudflare Turnstile token
  if (!turnstile_token) {
    return badRequest('Verification challenge is required.');
  }
  try {
    const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET,
        response: turnstile_token,
      }),
    });
    const tsData = await tsRes.json();
    if (!tsData.success) {
      return json({ error: 'Verification failed. Please try again.' }, 403);
    }
  } catch (err) {
    console.error('Turnstile verification error:', err);
    return json({ error: 'Verification service unavailable.' }, 500);
  }

  const result = await createContact(db, { name, email, subject: subject || 'General', message });

  return json({ success: true, id: result.id }, 201);
}
