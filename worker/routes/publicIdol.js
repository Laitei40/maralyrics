import { Hono } from 'hono';
import { attachBadges } from '../lib/badges.js';
import { parseVideos, CONTESTANT_ORDER } from '../lib/idol.js';

// Public Mara Idol API, mounted at /api/v1/mara-idol. Only PUBLISHED seasons (and their
// contestants) are ever returned — a draft is invisible here, including by direct slug.
//   GET /mara-idol                 all published seasons + every idol (the index page)
//   GET /mara-idol/:season         one season with its contestants
//   GET /mara-idol/:season/:idol   one idol with season and linked artist
const app = new Hono();
const CACHE = { 'Cache-Control': 'public, max-age=60' };

const summary = (text, max = 300) => {
  const t = String(text || '').trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t || null;
};

app.get('/', async (c) => {
  const db = c.env.DB;
  const [seasonRows, idolRows] = await Promise.all([
    db.prepare(
      `SELECT s.id, s.title, s.slug, s.year, s.description, s.venue, s.start_date, s.end_date, s.cover_url, s.photo_url,
              (SELECT COUNT(*) FROM idol_contestants c WHERE c.season_id = s.id) AS contestant_count
       FROM idol_seasons s WHERE s.status = 'published'
       ORDER BY s.year DESC, s.start_date DESC, s.title COLLATE NOCASE`
    ).all(),
    db.prepare(
      `SELECT c.name, c.slug, c.photo_url, c.result, c.placement,
              s.slug AS season_slug, s.title AS season_title, s.year AS season_year, a.slug AS artist_slug
       FROM idol_contestants c
       JOIN idol_seasons s ON s.id = c.season_id AND s.status = 'published'
       LEFT JOIN artists a ON a.id = c.artist_id
       ORDER BY s.year DESC, s.id, ${CONTESTANT_ORDER}`
    ).all(),
  ]);

  const idols = idolRows.results;
  const seasons = seasonRows.results.map(({ id, description, ...s }) => ({
    ...s,
    summary: summary(description),
    winners: idols.filter((i) => i.season_slug === s.slug && i.result === 'winner').map((i) => ({ name: i.name, slug: i.slug, photo_url: i.photo_url })),
  }));
  return c.json({ seasons, idols, total: idols.length }, 200, CACHE);
});

async function loadSeason(db, slug) {
  return db.prepare(
    `SELECT id, title, slug, year, description, venue, start_date, end_date, cover_url, photo_url, videos
     FROM idol_seasons WHERE slug = ? AND status = 'published'`
  ).bind(slug).first();
}

app.get('/:season', async (c) => {
  const db = c.env.DB;
  const season = await loadSeason(db, c.req.param('season'));
  if (!season) return c.json({ error: 'Not found' }, 404);
  const rows = await db.prepare(
    `SELECT c.name, c.slug, c.bio, c.photo_url, c.result, c.placement, a.slug AS artist_slug
     FROM idol_contestants c LEFT JOIN artists a ON a.id = c.artist_id
     WHERE c.season_id = ? ORDER BY ${CONTESTANT_ORDER}`
  ).bind(season.id).all();
  const { id, videos, ...rest } = season;
  return c.json({
    ...rest,
    videos: parseVideos(videos),
    contestants: rows.results.map(({ bio, ...r }) => ({ ...r, summary: summary(bio, 160) })),
  }, 200, CACHE);
});

app.get('/:season/:idol', async (c) => {
  const db = c.env.DB;
  const season = await loadSeason(db, c.req.param('season'));
  if (!season) return c.json({ error: 'Not found' }, 404);
  const idol = await db.prepare(
    `SELECT id, name, slug, bio, photo_url, result, placement, videos, artist_id
     FROM idol_contestants WHERE season_id = ? AND slug = ?`
  ).bind(season.id, c.req.param('idol')).first();
  if (!idol) return c.json({ error: 'Not found' }, 404);

  let artist = null;
  if (idol.artist_id) {
    const row = await db.prepare('SELECT id, name, slug, image_url FROM artists WHERE id = ?').bind(idol.artist_id).first();
    if (row) {
      const [withBadges] = await attachBadges(db, [row], 'artist');
      const { id, ...pub } = withBadges;
      artist = pub;
    }
  }
  const { artist_id, id, videos, ...rest } = idol;
  return c.json({
    ...rest,
    videos: parseVideos(videos),
    season: { title: season.title, slug: season.slug, year: season.year },
    artist,
  }, 200, CACHE);
});

export default app;
