import { Hono } from 'hono';
import { parsePagination } from '../lib/helpers.js';
import { verifyTurnstile } from '../lib/turnstile.js';

const SONG_COLUMNS = `
  s.id, s.title, s.slug, s.category, s.lyrics, s.views, s.created_at, s.updated_at,
  a.name AS artist_name, a.slug AS artist_slug,
  c.name AS composer_name, c.slug AS composer_slug,
  co.name AS copyright_owner_name, co.slug AS copyright_owner_slug
`;

const SONG_JOINS = `
  FROM songs s
  LEFT JOIN artists a ON s.artist_id = a.id
  LEFT JOIN composers c ON s.composer_id = c.id
  LEFT JOIN copyright_owners co ON s.copyright_owner_id = co.id
`;

const app = new Hono();

app.get('/version', async (c) => {
  const row = await c.env.DB
    .prepare(
      `SELECT
         MAX(updated_at) AS updated_at,
         (SELECT COUNT(*) FROM songs) AS songs,
         (SELECT COUNT(*) FROM artists) AS artists,
         (SELECT COUNT(*) FROM composers) AS composers,
         (SELECT COUNT(*) FROM copyright_owners) AS copyright_owners
       FROM (
         SELECT updated_at FROM songs
         UNION ALL SELECT updated_at FROM artists
         UNION ALL SELECT updated_at FROM composers
         UNION ALL SELECT updated_at FROM copyright_owners
       )`
    )
    .first();

  return c.json({
    version: 1,
    updated_at: row.updated_at,
    counts: {
      songs: row.songs,
      artists: row.artists,
      composers: row.composers,
      copyright_owners: row.copyright_owners,
    },
  });
});

app.get('/stats', async (c) => {
  const row = await c.env.DB
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM songs) AS songs,
         (SELECT COUNT(*) FROM artists) AS artists,
         (SELECT COUNT(*) FROM composers) AS composers,
         (SELECT COUNT(*) FROM copyright_owners) AS copyright_owners,
         (SELECT COUNT(DISTINCT category) FROM songs WHERE category IS NOT NULL AND category != '') AS categories,
         (SELECT COALESCE(SUM(views), 0) FROM songs) AS total_views`
    )
    .first();

  return c.json(row);
});

app.get('/contributors', async (c) => {
  const cache = caches.default;
  const cacheKey = new Request('https://api.maralyrics.com/api/v1/contributors?v=2', c.req.raw);

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const ghRes = await fetch('https://api.github.com/repos/Laitei40/maralyrics/contributors', {
    headers: {
      'User-Agent': 'maralyrics-worker',
      Accept: 'application/vnd.github+json',
      ...(c.env.GITHUB_TOKEN ? { Authorization: `Bearer ${c.env.GITHUB_TOKEN}` } : {}),
    },
  });

  if (!ghRes.ok) {
    return c.json({ error: 'Failed to fetch contributors' }, 502);
  }

  const contributors = (await ghRes.json())
    .filter((u) => u.type !== 'Bot')
    .map((u) => ({
      login: u.login,
      avatar_url: u.avatar_url,
      html_url: u.html_url,
      contributions: u.contributions,
    }));

  const response = c.json({ contributors }, 200, { 'Cache-Control': 'public, max-age=3600' });
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
});

app.get('/bootstrap', async (c) => {
  const db = c.env.DB;
  // `since` is a datetime string in the same format as the `updated_at` fields this
  // endpoint (and /version) return, e.g. "2026-07-08 12:34:56" — pass back the value
  // from a previous /version or /bootstrap call to fetch only what changed since then.
  const since = c.req.query('since') || null;
  const songsWhere = since ? 'WHERE s.updated_at > ?' : '';
  const peopleWhere = since ? 'WHERE updated_at > ?' : '';
  const bindings = since ? [since] : [];

  const [songs, artists, composers, copyrightOwners, counts] = await Promise.all([
    db.prepare(`SELECT ${SONG_COLUMNS} ${SONG_JOINS} ${songsWhere} ORDER BY s.title`).bind(...bindings).all(),
    db.prepare(`SELECT * FROM artists ${peopleWhere} ORDER BY name`).bind(...bindings).all(),
    db.prepare(`SELECT * FROM composers ${peopleWhere} ORDER BY name`).bind(...bindings).all(),
    db.prepare(`SELECT * FROM copyright_owners ${peopleWhere} ORDER BY name`).bind(...bindings).all(),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM songs) AS songs,
         (SELECT COUNT(*) FROM artists) AS artists,
         (SELECT COUNT(*) FROM composers) AS composers,
         (SELECT COUNT(*) FROM copyright_owners) AS copyright_owners`
    ).first(),
  ]);

  // `counts` are the CURRENT total rows in each table, unaffected by `since`. Since
  // deletions aren't tracked with tombstones, a delta bootstrap can't tell the caller
  // what was removed — comparing these counts against locally stored totals is how the
  // caller detects that something disappeared and a full re-sync (no `since`) is needed.
  return c.json({
    version: 1,
    since,
    counts,
    songs: songs.results,
    artists: artists.results,
    composers: composers.results,
    copyright_owners: copyrightOwners.results,
  });
});

// NOTE: static sub-paths (popular) must be registered before the /:slug param route.
app.get('/songs/popular', async (c) => {
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit'), 10) || 6));
  const songs = await c.env.DB
    .prepare(`SELECT ${SONG_COLUMNS} ${SONG_JOINS} ORDER BY s.views DESC LIMIT ?`)
    .bind(limit)
    .all();
  return c.json({ songs: songs.results });
});

app.get('/songs', async (c) => {
  const db = c.env.DB;
  const { page, limit, offset } = parsePagination(c.req.query());
  const category = c.req.query('category') || null;

  const where = category ? 'WHERE s.category = ?' : '';
  const bindings = category ? [category] : [];

  const [rows, countRow] = await Promise.all([
    db.prepare(`SELECT ${SONG_COLUMNS} ${SONG_JOINS} ${where} ORDER BY s.title LIMIT ? OFFSET ?`)
      .bind(...bindings, limit, offset)
      .all(),
    db.prepare(`SELECT COUNT(*) AS total FROM songs s ${where}`)
      .bind(...bindings)
      .first(),
  ]);

  const total = countRow.total;
  return c.json({ songs: rows.results, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
});

app.get('/songs/:slug', async (c) => {
  const song = await c.env.DB
    .prepare(`SELECT ${SONG_COLUMNS} ${SONG_JOINS} WHERE s.slug = ?`)
    .bind(c.req.param('slug'))
    .first();

  if (!song) return c.json({ error: 'Song not found' }, 404);
  return c.json(song);
});

app.post('/songs/:slug/view', async (c) => {
  const result = await c.env.DB
    .prepare('UPDATE songs SET views = views + 1 WHERE slug = ?')
    .bind(c.req.param('slug'))
    .run();

  if (result.meta.changes === 0) return c.json({ error: 'Song not found' }, 404);
  return c.json({ success: true });
});

app.get('/search', async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (!q) return c.json({ results: [], suggestions: [] });

  const ftsQuery = q
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"*`)
    .join(' ');

  const results = await c.env.DB
    .prepare(
      `SELECT ${SONG_COLUMNS}
       FROM songs_fts f
       JOIN songs s ON s.id = f.rowid
       LEFT JOIN artists a ON s.artist_id = a.id
       LEFT JOIN composers c ON s.composer_id = c.id
       LEFT JOIN copyright_owners co ON s.copyright_owner_id = co.id
       WHERE songs_fts MATCH ?
       ORDER BY rank
       LIMIT 30`
    )
    .bind(ftsQuery)
    .all()
    .catch(() => ({ results: [] })); // malformed FTS query (e.g. bare punctuation) — fall back to no results

  let suggestions = [];
  if (results.results.length === 0) {
    const firstWord = q.split(/\s+/)[0];
    const like = await c.env.DB
      .prepare('SELECT slug, title FROM songs WHERE title LIKE ? LIMIT 5')
      .bind(`%${firstWord}%`)
      .all();
    suggestions = like.results;
  }

  return c.json({ results: results.results, suggestions });
});

app.get('/categories', async (c) => {
  const rows = await c.env.DB
    .prepare('SELECT DISTINCT category FROM songs WHERE category IS NOT NULL AND category != \'\' ORDER BY category')
    .all();
  return c.json({ categories: rows.results.map((r) => r.category) });
});

async function listPeople(c, table) {
  const rows = await c.env.DB.prepare(`SELECT * FROM ${table} ORDER BY name`).all();
  return c.json({ [table]: rows.results, total: rows.results.length });
}

async function getPerson(c, table, fkColumn) {
  const db = c.env.DB;
  const person = await db.prepare(`SELECT * FROM ${table} WHERE slug = ?`).bind(c.req.param('slug')).first();
  if (!person) return c.json({ error: 'Not found' }, 404);

  const songs = await db
    .prepare(`SELECT ${SONG_COLUMNS} ${SONG_JOINS} WHERE s.${fkColumn} = ? ORDER BY s.title`)
    .bind(person.id)
    .all();

  return c.json({ ...person, songs: songs.results });
}

app.get('/artists', (c) => listPeople(c, 'artists'));
app.get('/artists/:slug', (c) => getPerson(c, 'artists', 'artist_id'));
app.get('/composers', (c) => listPeople(c, 'composers'));
app.get('/composers/:slug', (c) => getPerson(c, 'composers', 'composer_id'));

app.get('/copyright-owners', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM copyright_owners ORDER BY name').all();
  return c.json({ copyright_owners: rows.results, total: rows.results.length });
});

app.get('/copyright-owners/:slug', async (c) => {
  const db = c.env.DB;
  const owner = await db.prepare('SELECT * FROM copyright_owners WHERE slug = ?').bind(c.req.param('slug')).first();
  if (!owner) return c.json({ error: 'Not found' }, 404);

  const songs = await db
    .prepare(`SELECT ${SONG_COLUMNS} ${SONG_JOINS} WHERE s.copyright_owner_id = ? ORDER BY s.title`)
    .bind(owner.id)
    .all();

  return c.json({ owner, songs: songs.results });
});

app.post('/reports', async (c) => {
  const data = await c.req.json().catch(() => ({}));
  const { song_slug, song_title, song_artist, reporter_name, reporter_email, body, turnstile_token } = data;

  if (!song_slug || !body) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }

  const ok = await verifyTurnstile(turnstile_token, c.env, c.req.header('CF-Connecting-IP'));
  if (!ok) return c.json({ success: false, error: 'Security check failed. Please try again.' }, 400);

  const song = await c.env.DB.prepare('SELECT id FROM songs WHERE slug = ?').bind(song_slug).first();

  await c.env.DB
    .prepare(
      `INSERT INTO reports (song_id, song_slug, song_title, song_artist, reporter_name, reporter_email, body, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
    .bind(song?.id ?? null, song_slug, song_title || '', song_artist || '', reporter_name || '', reporter_email || '', body)
    .run();

  return c.json({ success: true, message: 'Report submitted successfully' }, 201);
});

app.post('/contacts', async (c) => {
  const data = await c.req.json().catch(() => ({}));
  const { name, email, subject, message, turnstile_token } = data;

  if (!name || !email || !message) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }

  const ok = await verifyTurnstile(turnstile_token, c.env, c.req.header('CF-Connecting-IP'));
  if (!ok) return c.json({ success: false, error: 'Security check failed. Please try again.' }, 400);

  await c.env.DB
    .prepare(`INSERT INTO contacts (name, email, subject, message, status) VALUES (?, ?, ?, ?, 'unread')`)
    .bind(name, email, subject || 'General', message)
    .run();

  return c.json({ success: true, message: 'Message sent successfully' }, 201);
});

export default app;
