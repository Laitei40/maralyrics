/**
 * Green mark: plans, prices and the entitlement itself. Shared by the artist-facing order routes (account.js),
 * the Super Admin review routes (adminGreen.js) and the public routes (which only need "does this profile have
 * an active mark").
 */

export const PLAN_MONTHS = [1, 3, 6, 12, 36];
export const ORDER_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

export const INSTRUCTIONS_MAX = 2000;
export const REFERENCE_MIN = 3;
export const REFERENCE_MAX = 120;
export const NOTE_MAX = 500;
export const RECEIPT_MAX_CHARS = 300000; // a downscaled JPEG/PNG receipt as a data: URL
const RECEIPT_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/** "4.99" | 4.99 | "5" → integer cents, or null when it is not a sensible price (> 0, ≤ 1,000,000.00, 2 decimals max). */
export function parsePriceToCents(value) {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return cents > 0 && cents <= 100000000 ? cents : null;
}

export const centsToPrice = (cents) => (cents == null ? '' : (cents / 100).toFixed(2));

/** Validates the settings body → { ok, currency, instructions, plans: [{ months, price_cents, enabled }] } | { ok: false, error } */
export function validateSettings(data = {}) {
  const currency = String(data.currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: 'currency must be a 3-letter code such as USD' };

  const instructions = typeof data.payment_instructions === 'string' ? data.payment_instructions.trim() : '';
  if (instructions.length > INSTRUCTIONS_MAX) return { ok: false, error: `payment instructions are too long (max ${INSTRUCTIONS_MAX} characters)` };

  const incoming = Array.isArray(data.plans) ? data.plans : [];
  const plans = [];
  for (const months of PLAN_MONTHS) {
    const row = incoming.find((p) => Number(p && p.months) === months) || {};
    const hasPrice = row.price !== undefined && row.price !== null && String(row.price).trim() !== '';
    const cents = hasPrice ? parsePriceToCents(row.price) : null;
    if (hasPrice && cents === null) return { ok: false, error: `the ${months}-month price must be a positive amount like 4.99` };
    const enabled = row.enabled === true || row.enabled === 1;
    if (enabled && cents === null) return { ok: false, error: `set a price for the ${months}-month plan before enabling it` };
    plans.push({ months, price_cents: cents, enabled: enabled ? 1 : 0 });
  }
  return { ok: true, currency, instructions: instructions || null, plans };
}

/** Validates what a buyer submits with an order → { ok, values } | { ok: false, error } */
export function validateOrderInput(data = {}) {
  const months = Number(data.months);
  if (!PLAN_MONTHS.includes(months)) return { ok: false, error: 'choose one of the plans' };
  const reference = String(data.reference || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (reference.length < REFERENCE_MIN) return { ok: false, error: 'enter your payment reference (for example the transaction ID)' };
  if (reference.length > REFERENCE_MAX) return { ok: false, error: `the reference is too long (max ${REFERENCE_MAX} characters)` };
  const note = typeof data.note === 'string' ? data.note.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
  if (note.length > NOTE_MAX) return { ok: false, error: `the note is too long (max ${NOTE_MAX} characters)` };
  const receipt = typeof data.receipt === 'string' ? data.receipt.trim() : '';
  if (receipt && (!RECEIPT_RE.test(receipt) || receipt.length > RECEIPT_MAX_CHARS)) {
    return { ok: false, error: 'the receipt must be a JPEG, PNG or WebP image under about 200 KB' };
  }
  return { ok: true, values: { months, reference, note: note || null, receipt: receipt || null } };
}

/** The plans currently on offer (priced AND enabled), plus currency and the how-to-pay text. */
export async function loadOffer(db) {
  const settings = (await db.prepare('SELECT currency, payment_instructions FROM green_settings WHERE id = 1').first()) || { currency: 'USD', payment_instructions: null };
  const plans = (await db.prepare('SELECT months, price_cents FROM green_plans WHERE enabled = 1 AND price_cents IS NOT NULL ORDER BY months').all()).results;
  return { currency: settings.currency, payment_instructions: settings.payment_instructions || '', plans };
}

/**
 * Switches the mark on for a profile for `months` months, or extends it: time is added to whichever is later,
 * the current expiry or now, so buying while active never loses days and buying after expiry starts fresh.
 * `type` is 'artist' | 'composer'; `months` must be one of PLAN_MONTHS (it is placed in a SQL modifier).
 */
export async function activateMark(db, type, profileId, months) {
  if (!PLAN_MONTHS.includes(months)) throw new Error('invalid plan length');
  const fk = type === 'artist' ? 'artist_id' : 'composer_id';
  const mod = `+${months} months`;
  await db
    .prepare(
      `INSERT INTO green_marks (${fk}, expires_at) VALUES (?, datetime('now', ?))
       ON CONFLICT(${fk}) DO UPDATE SET expires_at = datetime(max(green_marks.expires_at, datetime('now')), ?), updated_at = CURRENT_TIMESTAMP`
    )
    .bind(profileId, mod, mod)
    .run();
}

/**
 * Adds `green: true|false` to each person row for the public API. One query for the whole list. Tolerates the
 * tables not existing yet (Pages/Worker deploy on push, migrations are run by hand) — then nobody has a mark.
 */
export async function attachGreen(db, rows, type) {
  const fk = type === 'artist' ? 'artist_id' : 'composer_id';
  let active = new Set();
  try {
    const found = await db.prepare(`SELECT ${fk} AS id FROM green_marks WHERE ${fk} IS NOT NULL AND expires_at > datetime('now')`).all();
    active = new Set((found.results || []).map((r) => r.id));
  } catch { /* migration 0016 not applied yet */ }
  return rows.map((r) => ({ ...r, green: active.has(r.id) }));
}
