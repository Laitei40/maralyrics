/**
 * Recognition badges for artists and composers: a Super Admin awards a badge for a month
 * ('YYYY-MM'), a year ('YYYY') or a lifetime (no date). Shared by the admin routes (write)
 * and the public routes (read) so validation and ordering live in one place.
 */

export const BADGE_PERIODS = ['month', 'year', 'lifetime'];
export const BADGE_TITLE_MAX = 60;

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

/** Validates an award request body → { ok: true, value } | { ok: false, error }. */
export function validateBadgeInput(data = {}) {
  const period = String(data.period || '').trim();
  if (!BADGE_PERIODS.includes(period)) {
    return { ok: false, error: 'period must be one of: month, year, lifetime' };
  }

  let value = '';
  if (period === 'month') {
    value = String(data.period_value || '').trim();
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
    if (!m || Number(m[1]) < MIN_YEAR || Number(m[1]) > MAX_YEAR) {
      return { ok: false, error: `period_value must be a month as YYYY-MM (${MIN_YEAR}–${MAX_YEAR})` };
    }
  } else if (period === 'year') {
    value = String(data.period_value || '').trim();
    if (!/^\d{4}$/.test(value) || Number(value) < MIN_YEAR || Number(value) > MAX_YEAR) {
      return { ok: false, error: `period_value must be a year as YYYY (${MIN_YEAR}–${MAX_YEAR})` };
    }
  } // lifetime: no value

  // Optional custom label. Stored as plain text (every renderer escapes it); control
  // characters and runs of whitespace are normalised away.
  let title = null;
  if (data.title !== undefined && data.title !== null && String(data.title).trim() !== '') {
    title = String(data.title).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (title.length > BADGE_TITLE_MAX) return { ok: false, error: `title must be ${BADGE_TITLE_MAX} characters or fewer` };
  }

  return { ok: true, value: { period, period_value: value, title } };
}

const RANK = { lifetime: 0, year: 1, month: 2 };

/** Most prestigious first: lifetime, then years (newest first), then months (newest first). */
export function sortBadges(list) {
  return [...list].sort((a, b) =>
    RANK[a.period] - RANK[b.period] || String(b.period_value).localeCompare(String(a.period_value)));
}

/**
 * Attaches a `badges` array to each person row. `type` is 'artist' | 'composer'.
 * One query for the whole list (no N+1). `withIds` is for the admin API only — the public
 * API never exposes badge ids or who awarded them.
 */
export async function attachBadges(db, rows, type, { withIds = false } = {}) {
  const fk = type === 'artist' ? 'artist_id' : 'composer_id';
  const ids = rows.map((r) => r.id);
  const byPerson = new Map();
  if (ids.length) {
    // A handful of ids → filter in SQL; a whole directory listing → one scan of the (small) table.
    const filter = ids.length <= 50 ? `${fk} IN (${ids.map(() => '?').join(',')})` : `${fk} IS NOT NULL`;
    const found = await db
      .prepare(
        `SELECT ${fk} AS person_id, ${withIds ? 'id, ' : ''}period, period_value, title, created_at
         FROM person_badges WHERE ${filter}`
      )
      .bind(...(ids.length <= 50 ? ids : []))
      .all();
    for (const b of found.results || []) {
      const { person_id, ...badge } = b;
      if (!byPerson.has(person_id)) byPerson.set(person_id, []);
      byPerson.get(person_id).push(badge);
    }
  }
  return rows.map((r) => ({ ...r, badges: sortBadges(byPerson.get(r.id) || []) }));
}
