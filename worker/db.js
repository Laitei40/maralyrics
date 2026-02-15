// ╔══════════════════════════════════════════════════════════════╗
// ║          MaraLyrics — Database Helper Module                ║
// ╚══════════════════════════════════════════════════════════════╝

// ─── Song list SELECT with JOINs ──────────────────────────────
const SONG_LIST_COLS = `
  s.id, s.title, s.slug, s.category, s.views, s.created_at,
  s.artist_id, s.composer_id, s.copyright_owner_id,
  a.name AS artist_name, a.slug AS artist_slug,
  c.name AS composer_name, c.slug AS composer_slug,
  co.name AS copyright_owner_name, co.slug AS copyright_owner_slug`;

const SONG_JOINS = `
  FROM songs s
  LEFT JOIN artists   a ON s.artist_id   = a.id
  LEFT JOIN composers c ON s.composer_id = c.id
  LEFT JOIN copyright_owners co ON s.copyright_owner_id = co.id`;

/**
 * Fetch paginated song list from D1.
 */
export async function getSongs(db, page = 1, limit = 20, category = null) {
  const offset = (page - 1) * limit;

  let countQuery = 'SELECT COUNT(*) as total FROM songs s';
  let dataQuery  = `SELECT ${SONG_LIST_COLS} ${SONG_JOINS}`;
  const params = [];

  if (category) {
    const w = ' WHERE s.category = ?';
    countQuery += w;
    dataQuery  += w;
    params.push(category);
  }

  dataQuery += ' ORDER BY s.created_at DESC LIMIT ? OFFSET ?';

  const [countResult, dataResult] = await Promise.all([
    db.prepare(countQuery).bind(...params).first(),
    db.prepare(dataQuery).bind(...params, limit, offset).all(),
  ]);

  return {
    songs: dataResult.results || [],
    total: countResult?.total || 0,
    page,
    totalPages: Math.ceil((countResult?.total || 0) / limit),
  };
}

/**
 * Fetch a single song by slug (full detail with artist/composer).
 */
export async function getSongBySlug(db, slug) {
  return db
    .prepare(
      `SELECT s.*, a.name AS artist_name, a.slug AS artist_slug,
              c.name AS composer_name, c.slug AS composer_slug,
              co.name AS copyright_owner_name, co.slug AS copyright_owner_slug
       ${SONG_JOINS}
       WHERE s.slug = ?`
    )
    .bind(slug)
    .first();
}

/**
 * Search songs by title or artist name.
 */
export async function searchSongs(db, query, limit = 30) {
  const pattern = `%${query}%`;
  return db
    .prepare(
      `SELECT ${SONG_LIST_COLS} ${SONG_JOINS}
       WHERE s.title LIKE ? OR a.name LIKE ?
       ORDER BY s.views DESC
       LIMIT ?`
    )
    .bind(pattern, pattern, limit)
    .all()
    .then((r) => r.results || []);
}

/**
 * Increment view count for a song.
 */
export async function incrementViews(db, slug) {
  const result = await db
    .prepare('UPDATE songs SET views = views + 1 WHERE slug = ?')
    .bind(slug)
    .run();
  return result.meta.changes > 0;
}

/**
 * Get all unique categories.
 */
export async function getCategories(db) {
  const result = await db
    .prepare('SELECT DISTINCT category FROM songs WHERE category IS NOT NULL ORDER BY category')
    .all();
  return (result.results || []).map((r) => r.category);
}

/**
 * Get popular songs (top viewed).
 */
export async function getPopularSongs(db, limit = 10) {
  return db
    .prepare(
      `SELECT ${SONG_LIST_COLS} ${SONG_JOINS}
       ORDER BY s.views DESC
       LIMIT ?`
    )
    .bind(limit)
    .all()
    .then((r) => r.results || []);
}

// ─── Song Admin CRUD ───────────────────────────────────────────

export async function getSongById(db, id) {
  return db
    .prepare(
      `SELECT s.*, a.name AS artist_name, a.slug AS artist_slug,
              c.name AS composer_name, c.slug AS composer_slug,
              co.name AS copyright_owner_name, co.slug AS copyright_owner_slug
       ${SONG_JOINS}
       WHERE s.id = ?`
    )
    .bind(id)
    .first();
}

export async function getSongBySlugRaw(db, slug) {
  return db.prepare('SELECT * FROM songs WHERE slug = ?').bind(slug).first();
}

export async function createSong(db, { title, slug, artist_id, composer_id, copyright_owner_id, category, lyrics }) {
  const result = await db
    .prepare(
      `INSERT INTO songs (title, slug, artist_id, composer_id, copyright_owner_id, category, lyrics)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(title, slug, artist_id || null, composer_id || null, copyright_owner_id || null, category || null, lyrics)
    .run();
  return { id: result.meta.last_row_id };
}

export async function updateSong(db, id, { title, slug, artist_id, composer_id, copyright_owner_id, category, lyrics }) {
  const result = await db
    .prepare(
      `UPDATE songs SET title = ?, slug = ?, artist_id = ?, composer_id = ?, copyright_owner_id = ?, category = ?, lyrics = ?
       WHERE id = ?`
    )
    .bind(title, slug, artist_id || null, composer_id || null, copyright_owner_id || null, category || null, lyrics, id)
    .run();
  return result.meta.changes > 0;
}

export async function deleteSong(db, id) {
  const result = await db
    .prepare('DELETE FROM songs WHERE id = ?')
    .bind(id)
    .run();
  return result.meta.changes > 0;
}

// ─── Artist CRUD ───────────────────────────────────────────────

export async function getArtists(db) {
  const result = await db
    .prepare('SELECT * FROM artists ORDER BY name ASC')
    .all();
  return result.results || [];
}

export async function getArtistBySlug(db, slug) {
  return db.prepare('SELECT * FROM artists WHERE slug = ?').bind(slug).first();
}

export async function getArtistById(db, id) {
  return db.prepare('SELECT * FROM artists WHERE id = ?').bind(id).first();
}

export async function getSongsByArtist(db, artistId) {
  return db
    .prepare(
      `SELECT ${SONG_LIST_COLS} ${SONG_JOINS} WHERE s.artist_id = ? ORDER BY s.views DESC`
    )
    .bind(artistId)
    .all()
    .then((r) => r.results || []);
}

export async function createArtist(db, { name, slug, bio, image_url, social_links }) {
  const result = await db
    .prepare('INSERT INTO artists (name, slug, bio, image_url, social_links) VALUES (?, ?, ?, ?, ?)')
    .bind(name, slug, bio || null, image_url || null, social_links || null)
    .run();
  return { id: result.meta.last_row_id };
}

export async function updateArtist(db, id, { name, slug, bio, image_url, social_links }) {
  const result = await db
    .prepare('UPDATE artists SET name = ?, slug = ?, bio = ?, image_url = ?, social_links = ? WHERE id = ?')
    .bind(name, slug, bio || null, image_url || null, social_links || null, id)
    .run();
  return result.meta.changes > 0;
}

export async function deleteArtist(db, id) {
  const result = await db.prepare('DELETE FROM artists WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

// ─── Composer CRUD ─────────────────────────────────────────────

export async function getComposers(db) {
  const result = await db
    .prepare('SELECT * FROM composers ORDER BY name ASC')
    .all();
  return result.results || [];
}

export async function getComposerBySlug(db, slug) {
  return db.prepare('SELECT * FROM composers WHERE slug = ?').bind(slug).first();
}

export async function getComposerById(db, id) {
  return db.prepare('SELECT * FROM composers WHERE id = ?').bind(id).first();
}

export async function getSongsByComposer(db, composerId) {
  return db
    .prepare(
      `SELECT ${SONG_LIST_COLS} ${SONG_JOINS} WHERE s.composer_id = ? ORDER BY s.views DESC`
    )
    .bind(composerId)
    .all()
    .then((r) => r.results || []);
}

export async function createComposer(db, { name, slug, bio, image_url, social_links }) {
  const result = await db
    .prepare('INSERT INTO composers (name, slug, bio, image_url, social_links) VALUES (?, ?, ?, ?, ?)')
    .bind(name, slug, bio || null, image_url || null, social_links || null)
    .run();
  return { id: result.meta.last_row_id };
}

export async function updateComposer(db, id, { name, slug, bio, image_url, social_links }) {
  const result = await db
    .prepare('UPDATE composers SET name = ?, slug = ?, bio = ?, image_url = ?, social_links = ? WHERE id = ?')
    .bind(name, slug, bio || null, image_url || null, social_links || null, id)
    .run();
  return result.meta.changes > 0;
}

export async function deleteComposer(db, id) {
  const result = await db.prepare('DELETE FROM composers WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

// ─── Reports ──────────────────────────────────────────────────

export async function createReport(db, { song_slug, song_title, song_artist, reporter_name, reporter_email, body }) {
  const result = await db
    .prepare('INSERT INTO reports (song_slug, song_title, song_artist, reporter_name, reporter_email, body) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(song_slug || null, song_title || null, song_artist || null, reporter_name, reporter_email, body)
    .run();
  return { id: result.meta.last_row_id };
}

export async function getReports(db) {
  return db
    .prepare('SELECT * FROM reports ORDER BY created_at DESC')
    .all()
    .then(r => r.results || []);
}

export async function updateReportStatus(db, id, status) {
  const result = await db
    .prepare('UPDATE reports SET status = ? WHERE id = ?')
    .bind(status, id)
    .run();
  return result.meta.changes > 0;
}

export async function deleteReport(db, id) {
  const result = await db.prepare('DELETE FROM reports WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

// ─── Contact ──────────────────────────────────────────────────

export async function createContact(db, { name, email, subject, message }) {
  const result = await db
    .prepare('INSERT INTO contacts (name, email, subject, message) VALUES (?, ?, ?, ?)')
    .bind(name, email, subject || 'General', message)
    .run();
  return { id: result.meta.last_row_id };
}

// ─── Copyright Owners ─────────────────────────────────────────

export async function getCopyrightOwners(db) {
  const result = await db
    .prepare('SELECT * FROM copyright_owners ORDER BY name ASC')
    .all();
  return result.results || [];
}

export async function getCopyrightOwnerBySlug(db, slug) {
  return db.prepare('SELECT * FROM copyright_owners WHERE slug = ?').bind(slug).first();
}

export async function getCopyrightOwnerById(db, id) {
  return db.prepare('SELECT * FROM copyright_owners WHERE id = ?').bind(id).first();
}

export async function getSongsByCopyrightOwner(db, ownerId) {
  return db
    .prepare(
      `SELECT ${SONG_LIST_COLS} ${SONG_JOINS} WHERE s.copyright_owner_id = ? ORDER BY s.title ASC`
    )
    .bind(ownerId)
    .all()
    .then((r) => r.results || []);
}

export async function createCopyrightOwner(db, { name, slug, full_legal_name, organization, territory, email, website, address, ipi_number, isrc_prefix, pro_affiliation, notes }) {
  const result = await db
    .prepare(
      `INSERT INTO copyright_owners (name, slug, full_legal_name, organization, territory, email, website, address, ipi_number, isrc_prefix, pro_affiliation, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(name, slug, full_legal_name || null, organization || null, territory || null, email || null, website || null, address || null, ipi_number || null, isrc_prefix || null, pro_affiliation || null, notes || null)
    .run();
  return { id: result.meta.last_row_id };
}

export async function updateCopyrightOwner(db, id, { name, slug, full_legal_name, organization, territory, email, website, address, ipi_number, isrc_prefix, pro_affiliation, notes }) {
  const result = await db
    .prepare(
      `UPDATE copyright_owners SET name = ?, slug = ?, full_legal_name = ?, organization = ?, territory = ?, email = ?, website = ?, address = ?, ipi_number = ?, isrc_prefix = ?, pro_affiliation = ?, notes = ?
       WHERE id = ?`
    )
    .bind(name, slug, full_legal_name || null, organization || null, territory || null, email || null, website || null, address || null, ipi_number || null, isrc_prefix || null, pro_affiliation || null, notes || null, id)
    .run();
  return result.meta.changes > 0;
}

export async function deleteCopyrightOwner(db, id) {
  const result = await db.prepare('DELETE FROM copyright_owners WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}
