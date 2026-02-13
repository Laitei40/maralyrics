// ╔══════════════════════════════════════════════════════════════╗
// ║          MaraLyrics — Database Helper Module                ║
// ╚══════════════════════════════════════════════════════════════╝

/**
 * Fetch paginated song list from D1.
 * @param {D1Database} db - Cloudflare D1 binding
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Items per page
 * @param {string|null} category - Optional category filter
 * @returns {Promise<{songs: Array, total: number, page: number, totalPages: number}>}
 */
export async function getSongs(db, page = 1, limit = 20, category = null) {
  const offset = (page - 1) * limit;

  let countQuery = 'SELECT COUNT(*) as total FROM songs';
  let dataQuery = 'SELECT id, title, slug, artist, category, views, created_at FROM songs';
  const params = [];

  if (category) {
    const whereClause = ' WHERE category = ?';
    countQuery += whereClause;
    dataQuery += whereClause;
    params.push(category);
  }

  dataQuery += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

  // Run count + data queries in parallel
  const [countResult, dataResult] = await Promise.all([
    db.prepare(countQuery).bind(...params).first(),
    db.prepare(dataQuery).bind(...params, limit, offset).all(),
  ]);

  const total = countResult?.total || 0;

  return {
    songs: dataResult.results || [],
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Fetch a single song by its slug.
 * @param {D1Database} db
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getSongBySlug(db, slug) {
  return db
    .prepare('SELECT * FROM songs WHERE slug = ?')
    .bind(slug)
    .first();
}

/**
 * Search songs by title or artist.
 * @param {D1Database} db
 * @param {string} query - Search term
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function searchSongs(db, query, limit = 30) {
  const pattern = `%${query}%`;
  return db
    .prepare(
      `SELECT id, title, slug, artist, category, views
       FROM songs
       WHERE title LIKE ? OR artist LIKE ?
       ORDER BY views DESC
       LIMIT ?`
    )
    .bind(pattern, pattern, limit)
    .all()
    .then((r) => r.results || []);
}

/**
 * Increment view count for a song.
 * @param {D1Database} db
 * @param {string} slug
 * @returns {Promise<boolean>} - true if updated
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
 * @param {D1Database} db
 * @returns {Promise<Array<string>>}
 */
export async function getCategories(db) {
  const result = await db
    .prepare('SELECT DISTINCT category FROM songs WHERE category IS NOT NULL ORDER BY category')
    .all();
  return (result.results || []).map((r) => r.category);
}

/**
 * Get popular songs (top viewed).
 * @param {D1Database} db
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function getPopularSongs(db, limit = 10) {
  return db
    .prepare(
      `SELECT id, title, slug, artist, category, views
       FROM songs
       ORDER BY views DESC
       LIMIT ?`
    )
    .bind(limit)
    .all()
    .then((r) => r.results || []);
}
