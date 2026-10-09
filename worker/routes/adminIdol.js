import { Hono } from 'hono';
import { requireRole } from '../lib/auth.js';
import { CAN_MANAGE_IDOL, CAN_DELETE_IDOL } from '../lib/permissions.js';
import { logAudit } from '../lib/audit.js';
import { mapD1Error } from '../lib/helpers.js';
import { validateSeason, validateContestant, parseVideos } from '../lib/idol.js';

// Mara Idol admin API, mounted by admin.js (which has already run requireAuth):
//   /idol-seasons      editions of the competition (draft → published)
//   /idol-contestants  the idols in each edition
// Read: any admin. Create / edit / publish: Editor, Manager, Admin. Delete: Manager, Admin.

function fail(c, err) {
  const mapped = mapD1Error(err);
  if (mapped) return c.json({ error: mapped.error }, mapped.status);
  console.error(err);
  return c.json({ error: err.message || 'Internal error' }, 500);
}

const idParam = (c, name = 'id') => {
  const n = Number(c.req.param(name));
  return Number.isInteger(n) && n > 0 ? n : null;
};

const withVideos = (row) => (row ? { ...row, videos: parseVideos(row.videos) } : row);

// ── Seasons ─────────────────────────────────────────────────────────────────────
export const idolSeasonsApp = new Hono();

const SEASON_COLS = ['title', 'slug', 'year', 'description', 'venue', 'start_date', 'end_date', 'cover_url', 'videos', 'status'];

idolSeasonsApp.get('/', async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM idol_contestants c WHERE c.season_id = s.id) AS contestant_count
       FROM idol_seasons s ORDER BY s.year DESC, s.start_date DESC, s.title COLLATE NOCASE`
    )
    .all();
  return c.json({ seasons: rows.results.map(withVideos), total: rows.results.length });
});

idolSeasonsApp.get('/:id', async (c) => {
  const id = idParam(c);
  const row = id && (await c.env.DB.prepare('SELECT * FROM idol_seasons WHERE id = ?').bind(id).first());
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(withVideos(row));
});

idolSeasonsApp.post('/', requireRole(...CAN_MANAGE_IDOL), async (c) => {
  const parsed = validateSeason(await c.req.json().catch(() => ({})));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  try {
    const result = await c.env.DB
      .prepare(`INSERT INTO idol_seasons (${SEASON_COLS.join(', ')}) VALUES (${SEASON_COLS.map(() => '?').join(', ')})`)
      .bind(...SEASON_COLS.map((k) => parsed.values[k]))
      .run();
    const row = await c.env.DB.prepare('SELECT * FROM idol_seasons WHERE id = ?').bind(result.meta.last_row_id).first();
    await logAudit(c.env.DB, c.get('admin'), 'idol_season.create', 'idol_season', row.id, `${row.title} (${row.status})`);
    return c.json(withVideos(row), 201);
  } catch (err) {
    return fail(c, err);
  }
});

idolSeasonsApp.put('/:id', requireRole(...CAN_MANAGE_IDOL), async (c) => {
  const id = idParam(c);
  if (!id) return c.json({ error: 'Not found' }, 404);
  const parsed = validateSeason(await c.req.json().catch(() => ({})));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  try {
    const result = await c.env.DB
      .prepare(`UPDATE idol_seasons SET ${SEASON_COLS.map((k) => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(...SEASON_COLS.map((k) => parsed.values[k]), id)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
    const row = await c.env.DB.prepare('SELECT * FROM idol_seasons WHERE id = ?').bind(id).first();
    await logAudit(c.env.DB, c.get('admin'), 'idol_season.edit', 'idol_season', id, `${row.title} (${row.status})`);
    return c.json(withVideos(row));
  } catch (err) {
    return fail(c, err);
  }
});

idolSeasonsApp.delete('/:id', requireRole(...CAN_DELETE_IDOL), async (c) => {
  const id = idParam(c);
  const row = id && (await c.env.DB.prepare('SELECT title FROM idol_seasons WHERE id = ?').bind(id).first());
  if (!row) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.prepare('DELETE FROM idol_seasons WHERE id = ?').bind(id).run(); // contestants cascade
  await logAudit(c.env.DB, c.get('admin'), 'idol_season.delete', 'idol_season', id, row.title);
  return c.json({ success: true });
});

// ── Contestants ─────────────────────────────────────────────────────────────────
export const idolContestantsApp = new Hono();

const CONTESTANT_COLS = ['season_id', 'name', 'slug', 'bio', 'photo_url', 'result', 'placement', 'videos', 'artist_id', 'sort_order'];

/** The season (and artist, when linked) a contestant points at must exist. */
async function checkReferences(db, v) {
  const season = await db.prepare('SELECT id FROM idol_seasons WHERE id = ?').bind(v.season_id).first();
  if (!season) return 'That season does not exist';
  if (v.artist_id) {
    const artist = await db.prepare('SELECT id FROM artists WHERE id = ?').bind(v.artist_id).first();
    if (!artist) return 'That artist does not exist';
  }
  return null;
}

idolContestantsApp.get('/', async (c) => {
  const seasonId = Number(c.req.query('season_id'));
  const where = Number.isInteger(seasonId) && seasonId > 0 ? 'WHERE c.season_id = ?' : '';
  const stmt = c.env.DB.prepare(
    `SELECT c.*, s.title AS season_title, s.year AS season_year, a.name AS artist_name
     FROM idol_contestants c
     JOIN idol_seasons s ON s.id = c.season_id
     LEFT JOIN artists a ON a.id = c.artist_id
     ${where}
     ORDER BY s.year DESC, s.title COLLATE NOCASE, c.sort_order, c.name COLLATE NOCASE`
  );
  const rows = await (where ? stmt.bind(seasonId) : stmt).all();
  return c.json({ contestants: rows.results.map(withVideos), total: rows.results.length });
});

idolContestantsApp.get('/:id', async (c) => {
  const id = idParam(c);
  const row = id && (await c.env.DB.prepare('SELECT * FROM idol_contestants WHERE id = ?').bind(id).first());
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(withVideos(row));
});

idolContestantsApp.post('/', requireRole(...CAN_MANAGE_IDOL), async (c) => {
  const parsed = validateContestant(await c.req.json().catch(() => ({})));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const refError = await checkReferences(c.env.DB, parsed.values);
  if (refError) return c.json({ error: refError }, 400);
  try {
    const result = await c.env.DB
      .prepare(`INSERT INTO idol_contestants (${CONTESTANT_COLS.join(', ')}) VALUES (${CONTESTANT_COLS.map(() => '?').join(', ')})`)
      .bind(...CONTESTANT_COLS.map((k) => parsed.values[k]))
      .run();
    const row = await c.env.DB.prepare('SELECT * FROM idol_contestants WHERE id = ?').bind(result.meta.last_row_id).first();
    await logAudit(c.env.DB, c.get('admin'), 'idol.create', 'idol', row.id, row.name);
    return c.json(withVideos(row), 201);
  } catch (err) {
    return fail(c, err);
  }
});

idolContestantsApp.put('/:id', requireRole(...CAN_MANAGE_IDOL), async (c) => {
  const id = idParam(c);
  if (!id) return c.json({ error: 'Not found' }, 404);
  const parsed = validateContestant(await c.req.json().catch(() => ({})));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const refError = await checkReferences(c.env.DB, parsed.values);
  if (refError) return c.json({ error: refError }, 400);
  try {
    const result = await c.env.DB
      .prepare(`UPDATE idol_contestants SET ${CONTESTANT_COLS.map((k) => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(...CONTESTANT_COLS.map((k) => parsed.values[k]), id)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
    const row = await c.env.DB.prepare('SELECT * FROM idol_contestants WHERE id = ?').bind(id).first();
    await logAudit(c.env.DB, c.get('admin'), 'idol.edit', 'idol', id, row.name);
    return c.json(withVideos(row));
  } catch (err) {
    return fail(c, err);
  }
});

idolContestantsApp.delete('/:id', requireRole(...CAN_DELETE_IDOL), async (c) => {
  const id = idParam(c);
  const row = id && (await c.env.DB.prepare('SELECT name FROM idol_contestants WHERE id = ?').bind(id).first());
  if (!row) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.prepare('DELETE FROM idol_contestants WHERE id = ?').bind(id).run();
  await logAudit(c.env.DB, c.get('admin'), 'idol.delete', 'idol', id, row.name);
  return c.json({ success: true });
});
