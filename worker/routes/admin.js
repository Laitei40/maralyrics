import { Hono } from 'hono';
import { slugify, parsePagination, mapD1Error, CATEGORIES } from '../lib/helpers.js';
import { hashPassword, verifyPassword, signJWT, requireRole } from '../lib/auth.js';

const app = new Hono();

const ADMIN_ROLES = ['super_admin', 'editor', 'moderator'];

function fail(c, err, fallbackStatus = 500) {
  const mapped = mapD1Error(err);
  if (mapped) return c.json({ error: mapped.error }, mapped.status);
  console.error(err);
  return c.json({ error: err.message || 'Internal error' }, fallbackStatus);
}

// ── Auth: login is public (exempted in worker.js); /me and /change-password
// run behind requireAuth like everything else under /api/v1/admin/*. ──
app.post('/auth/login', async (c) => {
  const { username, password } = await c.req.json().catch(() => ({}));
  if (!username || !password) return c.json({ error: 'Username and password are required' }, 400);

  const user = await c.env.DB.prepare('SELECT * FROM admin_users WHERE username = ?').bind(username).first();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: 'Invalid username or password' }, 401);
  }

  const token = await signJWT({ sub: user.id, username: user.username, role: user.role }, c.env.JWT_SECRET);
  return c.json({ token, id: user.id, username: user.username, role: user.role });
});

app.get('/auth/me', (c) => {
  const admin = c.get('admin');
  return c.json({ id: admin.sub, username: admin.username, role: admin.role });
});

app.post('/auth/change-password', async (c) => {
  const admin = c.get('admin');
  const { current_password, new_password } = await c.req.json().catch(() => ({}));
  if (!current_password || !new_password) {
    return c.json({ error: 'current_password and new_password are required' }, 400);
  }
  if (new_password.length < 8) return c.json({ error: 'New password must be at least 8 characters' }, 400);

  const user = await c.env.DB.prepare('SELECT * FROM admin_users WHERE id = ?').bind(admin.sub).first();
  if (!user || !(await verifyPassword(current_password, user.password_hash))) {
    return c.json({ error: 'Current password is incorrect' }, 401);
  }

  const password_hash = await hashPassword(new_password);
  await c.env.DB.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').bind(password_hash, admin.sub).run();
  return c.json({ success: true });
});

// ── Admin account management (super_admin only) ──
app.get('/admin-users', requireRole('super_admin'), async (c) => {
  const rows = await c.env.DB
    .prepare('SELECT id, username, role, created_at, updated_at FROM admin_users ORDER BY username')
    .all();
  return c.json({ admin_users: rows.results, total: rows.results.length });
});

app.post('/admin-users', requireRole('super_admin'), async (c) => {
  const { username, password, role } = await c.req.json().catch(() => ({}));
  if (!username || !password || !role) return c.json({ error: 'username, password, and role are required' }, 400);
  if (!ADMIN_ROLES.includes(role)) return c.json({ error: `role must be one of: ${ADMIN_ROLES.join(', ')}` }, 400);
  if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);

  try {
    const password_hash = await hashPassword(password);
    const result = await c.env.DB
      .prepare('INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)')
      .bind(username, password_hash, role)
      .run();
    const row = await c.env.DB
      .prepare('SELECT id, username, role, created_at, updated_at FROM admin_users WHERE id = ?')
      .bind(result.meta.last_row_id)
      .first();
    return c.json(row, 201);
  } catch (err) {
    return fail(c, err);
  }
});

app.put('/admin-users/:id', requireRole('super_admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const { username, password, role } = await c.req.json().catch(() => ({}));
  if (!username || !role) return c.json({ error: 'username and role are required' }, 400);
  if (!ADMIN_ROLES.includes(role)) return c.json({ error: `role must be one of: ${ADMIN_ROLES.join(', ')}` }, 400);
  if (password && password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);

  const admin = c.get('admin');
  if (admin.sub === id && role !== 'super_admin') {
    const { count } = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM admin_users WHERE role = 'super_admin'").first();
    if (count <= 1) return c.json({ error: 'Cannot demote the last remaining Super Admin' }, 400);
  }

  try {
    if (password) {
      const password_hash = await hashPassword(password);
      await c.env.DB
        .prepare('UPDATE admin_users SET username = ?, role = ?, password_hash = ? WHERE id = ?')
        .bind(username, role, password_hash, id)
        .run();
    } else {
      await c.env.DB.prepare('UPDATE admin_users SET username = ?, role = ? WHERE id = ?').bind(username, role, id).run();
    }
    const row = await c.env.DB
      .prepare('SELECT id, username, role, created_at, updated_at FROM admin_users WHERE id = ?')
      .bind(id)
      .first();
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
  } catch (err) {
    return fail(c, err);
  }
});

app.delete('/admin-users/:id', requireRole('super_admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const admin = c.get('admin');
  if (admin.sub === id) return c.json({ error: 'Cannot delete your own account' }, 400);

  const target = await c.env.DB.prepare('SELECT role FROM admin_users WHERE id = ?').bind(id).first();
  if (!target) return c.json({ error: 'Not found' }, 404);

  if (target.role === 'super_admin') {
    const { count } = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM admin_users WHERE role = 'super_admin'").first();
    if (count <= 1) return c.json({ error: 'Cannot delete the last remaining Super Admin' }, 400);
  }

  await c.env.DB.prepare('DELETE FROM admin_users WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ── Generic CRUD for simple "person" resources: artists, composers ──
// Content management is restricted to super_admin + editor.
function personCrud(table) {
  const sub = new Hono();
  sub.use('*', requireRole('super_admin', 'editor'));

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

// ── Copyright owners (content management: super_admin + editor) ──
const CO_FIELDS = [
  'full_legal_name', 'organization', 'territory', 'email', 'website',
  'address', 'ipi_number', 'isrc_prefix', 'pro_affiliation', 'notes',
];

const coApp = new Hono();
coApp.use('*', requireRole('super_admin', 'editor'));

coApp.get('/', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM copyright_owners ORDER BY name').all();
  return c.json({ copyright_owners: rows.results, total: rows.results.length });
});

coApp.get('/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM copyright_owners WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

coApp.post('/', async (c) => {
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

coApp.put('/:id', async (c) => {
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

coApp.delete('/:id', async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM copyright_owners WHERE id = ?').bind(c.req.param('id')).run();
  if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

app.route('/copyright-owners', coApp);

// ── Songs (content management: super_admin + editor) ──
const MAX_CREDITED_PEOPLE = 20;

// Dedupes, coerces to positive integers, and caps at MAX_CREDITED_PEOPLE, preserving order.
function normalizeIds(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const v of raw) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0 && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out.slice(0, MAX_CREDITED_PEOPLE);
}

// Confirms every id actually exists in `table` — checked before any song write happens, so a
// bad id is rejected with a clear 400 instead of leaving a half-written song behind (the songs
// INSERT/UPDATE and the junction-table writes aren't one atomic transaction).
async function idsExist(db, table, ids) {
  if (!ids.length) return true;
  const placeholders = ids.map(() => '?').join(',');
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE id IN (${placeholders})`).bind(...ids).first();
  return row.count === ids.length;
}

// Replaces a song's rows in a junction table (song_artists / song_composers) with the given ids, in order.
async function writeSongPeople(db, songId, table, fkColumn, ids) {
  const stmts = [db.prepare(`DELETE FROM ${table} WHERE song_id = ?`).bind(songId)];
  ids.forEach((id, i) => {
    stmts.push(db.prepare(`INSERT INTO ${table} (song_id, ${fkColumn}, position) VALUES (?, ?, ?)`).bind(songId, id, i));
  });
  await db.batch(stmts);
}

async function getSongWithPeople(db, id) {
  const song = await db.prepare('SELECT * FROM songs WHERE id = ?').bind(id).first();
  if (!song) return null;
  const [artists, composers] = await Promise.all([
    db.prepare(
      `SELECT a.id, a.name, a.slug FROM song_artists sa JOIN artists a ON a.id = sa.artist_id
       WHERE sa.song_id = ? ORDER BY sa.position`
    ).bind(id).all(),
    db.prepare(
      `SELECT c.id, c.name, c.slug FROM song_composers sc JOIN composers c ON c.id = sc.composer_id
       WHERE sc.song_id = ? ORDER BY sc.position`
    ).bind(id).all(),
  ]);
  return { ...song, artists: artists.results, composers: composers.results };
}

const songsApp = new Hono();
songsApp.use('*', requireRole('super_admin', 'editor'));

songsApp.get('/', async (c) => {
  const db = c.env.DB;
  const { page, limit, offset } = parsePagination(c.req.query(), 50);

  const [rows, countRow] = await Promise.all([
    db.prepare(
      `SELECT s.*,
         (SELECT GROUP_CONCAT(name, ', ') FROM (
            SELECT a.name AS name FROM song_artists sa JOIN artists a ON a.id = sa.artist_id
            WHERE sa.song_id = s.id ORDER BY sa.position
          )) AS artist_name,
         (SELECT GROUP_CONCAT(name, ', ') FROM (
            SELECT cm.name AS name FROM song_composers sc JOIN composers cm ON cm.id = sc.composer_id
            WHERE sc.song_id = s.id ORDER BY sc.position
          )) AS composer_name
       FROM songs s
       ORDER BY s.created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(limit, offset).all(),
    db.prepare('SELECT COUNT(*) AS total FROM songs').first(),
  ]);

  const total = countRow.total;
  return c.json({ songs: rows.results, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
});

songsApp.get('/:id', async (c) => {
  const row = await getSongWithPeople(c.env.DB, c.req.param('id'));
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

songsApp.post('/', async (c) => {
  const data = await c.req.json().catch(() => ({}));
  const { title, lyrics, copyright_owner_id, category } = data;
  const artist_ids = normalizeIds(data.artist_ids);
  const composer_ids = normalizeIds(data.composer_ids);

  if (!title || !lyrics) return c.json({ error: 'title and lyrics are required' }, 400);
  if (category && !CATEGORIES.includes(category)) {
    return c.json({ error: `category must be one of: ${CATEGORIES.join(', ')}` }, 400);
  }
  const slug = data.slug?.trim() || slugify(title);

  try {
    const db = c.env.DB;
    const [artistsOk, composersOk] = await Promise.all([
      idsExist(db, 'artists', artist_ids),
      idsExist(db, 'composers', composer_ids),
    ]);
    if (!artistsOk) return c.json({ error: 'One or more selected artists do not exist' }, 400);
    if (!composersOk) return c.json({ error: 'One or more selected composers do not exist' }, 400);

    const result = await db
      .prepare(
        `INSERT INTO songs (title, slug, artist_id, composer_id, copyright_owner_id, category, lyrics)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(title, slug, artist_ids[0] || null, composer_ids[0] || null, copyright_owner_id || null, category || null, lyrics)
      .run();
    const songId = result.meta.last_row_id;

    await writeSongPeople(db, songId, 'song_artists', 'artist_id', artist_ids);
    await writeSongPeople(db, songId, 'song_composers', 'composer_id', composer_ids);

    const row = await getSongWithPeople(db, songId);
    return c.json(row, 201);
  } catch (err) {
    return fail(c, err);
  }
});

songsApp.put('/:id', async (c) => {
  const id = c.req.param('id');
  const data = await c.req.json().catch(() => ({}));
  const { title, lyrics, copyright_owner_id, category } = data;
  const artist_ids = normalizeIds(data.artist_ids);
  const composer_ids = normalizeIds(data.composer_ids);

  if (!title || !lyrics) return c.json({ error: 'title and lyrics are required' }, 400);
  if (category && !CATEGORIES.includes(category)) {
    return c.json({ error: `category must be one of: ${CATEGORIES.join(', ')}` }, 400);
  }
  const slug = data.slug?.trim() || slugify(title);

  try {
    const db = c.env.DB;
    const [artistsOk, composersOk] = await Promise.all([
      idsExist(db, 'artists', artist_ids),
      idsExist(db, 'composers', composer_ids),
    ]);
    if (!artistsOk) return c.json({ error: 'One or more selected artists do not exist' }, 400);
    if (!composersOk) return c.json({ error: 'One or more selected composers do not exist' }, 400);

    const result = await db
      .prepare(
        `UPDATE songs SET title = ?, slug = ?, artist_id = ?, composer_id = ?, copyright_owner_id = ?, category = ?, lyrics = ?
         WHERE id = ?`
      )
      .bind(title, slug, artist_ids[0] || null, composer_ids[0] || null, copyright_owner_id || null, category || null, lyrics, id)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);

    await writeSongPeople(db, id, 'song_artists', 'artist_id', artist_ids);
    await writeSongPeople(db, id, 'song_composers', 'composer_id', composer_ids);

    const row = await getSongWithPeople(db, id);
    return c.json(row);
  } catch (err) {
    return fail(c, err);
  }
});

songsApp.delete('/:id', async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM songs WHERE id = ?').bind(c.req.param('id')).run();
  if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

app.route('/songs', songsApp);

// ── Reports (status: pending | reviewed | resolved | dismissed) ──
// Handling reports/contacts is restricted to super_admin + moderator.
const reportsApp = new Hono();
reportsApp.use('*', requireRole('super_admin', 'moderator'));

reportsApp.get('/', async (c) => {
  const status = c.req.query('status');
  const where = status ? 'WHERE status = ?' : '';
  const rows = await c.env.DB
    .prepare(`SELECT * FROM reports ${where} ORDER BY created_at DESC`)
    .bind(...(status ? [status] : []))
    .all();
  return c.json({ reports: rows.results, total: rows.results.length });
});

reportsApp.put('/:id', async (c) => {
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

reportsApp.delete('/:id', async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM reports WHERE id = ?').bind(c.req.param('id')).run();
  if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

app.route('/reports', reportsApp);

// ── Contacts (status: unread | read | archived) ──
const contactsApp = new Hono();
contactsApp.use('*', requireRole('super_admin', 'moderator'));

contactsApp.get('/', async (c) => {
  const status = c.req.query('status');
  const where = status ? 'WHERE status = ?' : '';
  const rows = await c.env.DB
    .prepare(`SELECT * FROM contacts ${where} ORDER BY created_at DESC`)
    .bind(...(status ? [status] : []))
    .all();
  return c.json({ contacts: rows.results, total: rows.results.length });
});

contactsApp.put('/:id', async (c) => {
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

contactsApp.delete('/:id', async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM contacts WHERE id = ?').bind(c.req.param('id')).run();
  if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

app.route('/contacts', contactsApp);

export default app;
