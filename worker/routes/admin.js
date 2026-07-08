import { Hono } from 'hono';
import { slugify, parsePagination, mapD1Error, CATEGORIES } from '../lib/helpers.js';

const app = new Hono();

function fail(c, err, fallbackStatus = 500) {
  const mapped = mapD1Error(err);
  if (mapped) return c.json({ error: mapped.error }, mapped.status);
  console.error(err);
  return c.json({ error: err.message || 'Internal error' }, fallbackStatus);
}

// ── Generic CRUD for simple "person" resources: artists, composers ──
function personCrud(table) {
  const sub = new Hono();

  sub.get('/', async (c) => {
    const rows = await c.env.DB.prepare(`SELECT * FROM ${table} ORDER BY name`).all();
    return c.json({ [table]: rows.results, total: rows.results.length });
  });

  sub.get('/:id', async (c) => {
    const row = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(c.req.param('id')).first();
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
  });

  sub.post('/', async (c) => {
    const data = await c.req.json().catch(() => ({}));
    const { name, bio, image_url, social_links } = data;
    if (!name) return c.json({ error: 'name is required' }, 400);
    const slug = data.slug?.trim() || slugify(name);

    try {
      const result = await c.env.DB
        .prepare(`INSERT INTO ${table} (name, slug, bio, image_url, social_links) VALUES (?, ?, ?, ?, ?)`)
        .bind(name, slug, bio || null, image_url || null, social_links || null)
        .run();
      const row = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(result.meta.last_row_id).first();
      return c.json(row, 201);
    } catch (err) {
      return fail(c, err);
    }
  });

  sub.put('/:id', async (c) => {
    const id = c.req.param('id');
    const data = await c.req.json().catch(() => ({}));
    const { name, bio, image_url, social_links } = data;
    if (!name) return c.json({ error: 'name is required' }, 400);
    const slug = data.slug?.trim() || slugify(name);

    try {
      const result = await c.env.DB
        .prepare(`UPDATE ${table} SET name = ?, slug = ?, bio = ?, image_url = ?, social_links = ? WHERE id = ?`)
        .bind(name, slug, bio || null, image_url || null, social_links || null, id)
        .run();
      if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
      const row = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
      return c.json(row);
    } catch (err) {
      return fail(c, err);
    }
  });

  sub.delete('/:id', async (c) => {
    const result = await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(c.req.param('id')).run();
    if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  });

  return sub;
}

app.route('/artists', personCrud('artists'));
app.route('/composers', personCrud('composers'));

// ── Copyright owners ──
const CO_FIELDS = [
  'full_legal_name', 'organization', 'territory', 'email', 'website',
  'address', 'ipi_number', 'isrc_prefix', 'pro_affiliation', 'notes',
];

app.get('/copyright-owners', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM copyright_owners ORDER BY name').all();
  return c.json({ copyright_owners: rows.results, total: rows.results.length });
});

app.get('/copyright-owners/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM copyright_owners WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

app.post('/copyright-owners', async (c) => {
  const data = await c.req.json().catch(() => ({}));
  if (!data.name) return c.json({ error: 'name is required' }, 400);
  const slug = data.slug?.trim() || slugify(data.name);
  const values = CO_FIELDS.map((f) => data[f] || null);

  try {
    const result = await c.env.DB
      .prepare(
        `INSERT INTO copyright_owners (name, slug, ${CO_FIELDS.join(', ')})
         VALUES (?, ?, ${CO_FIELDS.map(() => '?').join(', ')})`
      )
      .bind(data.name, slug, ...values)
      .run();
    const row = await c.env.DB.prepare('SELECT * FROM copyright_owners WHERE id = ?').bind(result.meta.last_row_id).first();
    return c.json(row, 201);
  } catch (err) {
    return fail(c, err);
  }
});

app.put('/copyright-owners/:id', async (c) => {
  const id = c.req.param('id');
  const data = await c.req.json().catch(() => ({}));
  if (!data.name) return c.json({ error: 'name is required' }, 400);
  const slug = data.slug?.trim() || slugify(data.name);
  const values = CO_FIELDS.map((f) => data[f] || null);

  try {
    const result = await c.env.DB
      .prepare(
        `UPDATE copyright_owners SET name = ?, slug = ?, ${CO_FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`
      )
      .bind(data.name, slug, ...values, id)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
    const row = await c.env.DB.prepare('SELECT * FROM copyright_owners WHERE id = ?').bind(id).first();
    return c.json(row);
  } catch (err) {
    return fail(c, err);
  }
});

app.delete('/copyright-owners/:id', async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM copyright_owners WHERE id = ?').bind(c.req.param('id')).run();
  if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

// ── Songs ──
app.get('/songs', async (c) => {
  const db = c.env.DB;
  const { page, limit, offset } = parsePagination(c.req.query(), 50);

  const [rows, countRow] = await Promise.all([
    db.prepare(
      `SELECT s.*, a.name AS artist_name, cm.name AS composer_name
       FROM songs s
       LEFT JOIN artists a ON s.artist_id = a.id
       LEFT JOIN composers cm ON s.composer_id = cm.id
       ORDER BY s.created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(limit, offset).all(),
    db.prepare('SELECT COUNT(*) AS total FROM songs').first(),
  ]);

  const total = countRow.total;
  return c.json({ songs: rows.results, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
});

app.get('/songs/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM songs WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

app.post('/songs', async (c) => {
  const data = await c.req.json().catch(() => ({}));
  const { title, lyrics, artist_id, composer_id, copyright_owner_id, category } = data;

  if (!title || !lyrics) return c.json({ error: 'title and lyrics are required' }, 400);
  if (category && !CATEGORIES.includes(category)) {
    return c.json({ error: `category must be one of: ${CATEGORIES.join(', ')}` }, 400);
  }
  const slug = data.slug?.trim() || slugify(title);

  try {
    const result = await c.env.DB
      .prepare(
        `INSERT INTO songs (title, slug, artist_id, composer_id, copyright_owner_id, category, lyrics)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(title, slug, artist_id || null, composer_id || null, copyright_owner_id || null, category || null, lyrics)
      .run();
    const row = await c.env.DB.prepare('SELECT * FROM songs WHERE id = ?').bind(result.meta.last_row_id).first();
    return c.json(row, 201);
  } catch (err) {
    return fail(c, err);
  }
});

app.put('/songs/:id', async (c) => {
  const id = c.req.param('id');
  const data = await c.req.json().catch(() => ({}));
  const { title, lyrics, artist_id, composer_id, copyright_owner_id, category } = data;

  if (!title || !lyrics) return c.json({ error: 'title and lyrics are required' }, 400);
  if (category && !CATEGORIES.includes(category)) {
    return c.json({ error: `category must be one of: ${CATEGORIES.join(', ')}` }, 400);
  }
  const slug = data.slug?.trim() || slugify(title);

  try {
    const result = await c.env.DB
      .prepare(
        `UPDATE songs SET title = ?, slug = ?, artist_id = ?, composer_id = ?, copyright_owner_id = ?, category = ?, lyrics = ?
         WHERE id = ?`
      )
      .bind(title, slug, artist_id || null, composer_id || null, copyright_owner_id || null, category || null, lyrics, id)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
    const row = await c.env.DB.prepare('SELECT * FROM songs WHERE id = ?').bind(id).first();
    return c.json(row);
  } catch (err) {
    return fail(c, err);
  }
});

app.delete('/songs/:id', async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM songs WHERE id = ?').bind(c.req.param('id')).run();
  if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

// ── Reports (status: pending | reviewed | resolved | dismissed) ──
app.get('/reports', async (c) => {
  const status = c.req.query('status');
  const where = status ? 'WHERE status = ?' : '';
  const rows = await c.env.DB
    .prepare(`SELECT * FROM reports ${where} ORDER BY created_at DESC`)
    .bind(...(status ? [status] : []))
    .all();
  return c.json({ reports: rows.results, total: rows.results.length });
});

app.put('/reports/:id', async (c) => {
  const data = await c.req.json().catch(() => ({}));
  if (!data.status) return c.json({ error: 'status is required' }, 400);

  try {
    const result = await c.env.DB
      .prepare('UPDATE reports SET status = ? WHERE id = ?')
      .bind(data.status, c.req.param('id'))
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    return fail(c, err);
  }
});

app.delete('/reports/:id', async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM reports WHERE id = ?').bind(c.req.param('id')).run();
  if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

// ── Contacts (status: unread | read | archived) ──
app.get('/contacts', async (c) => {
  const status = c.req.query('status');
  const where = status ? 'WHERE status = ?' : '';
  const rows = await c.env.DB
    .prepare(`SELECT * FROM contacts ${where} ORDER BY created_at DESC`)
    .bind(...(status ? [status] : []))
    .all();
  return c.json({ contacts: rows.results, total: rows.results.length });
});

app.put('/contacts/:id', async (c) => {
  const data = await c.req.json().catch(() => ({}));
  if (!data.status) return c.json({ error: 'status is required' }, 400);

  try {
    const result = await c.env.DB
      .prepare('UPDATE contacts SET status = ? WHERE id = ?')
      .bind(data.status, c.req.param('id'))
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    return fail(c, err);
  }
});

app.delete('/contacts/:id', async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM contacts WHERE id = ?').bind(c.req.param('id')).run();
  if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

export default app;
