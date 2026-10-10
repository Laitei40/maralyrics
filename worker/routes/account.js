import { Hono } from 'hono';
import { hashPassword, verifyPassword } from '../lib/auth.js';
import { signPersonToken, requirePerson } from '../lib/personAuth.js';
import { verifyTurnstile } from '../lib/turnstile.js';
import { validateOwnerEdit } from '../lib/profile.js';
import { logAudit } from '../lib/audit.js';
import { loadOffer, validateOrderInput } from '../lib/green.js';

// Artist / composer accounts, mounted at /api/v1/account. Anyone can register an account, but an account can
// change nothing until a Manager / Super Admin approves a claim on a profile (see adminClaims.js).
//   POST   /register  /login               → { token, account }
//   GET    /me                             → the account and its claims
//   POST   /change-password
//   POST   /claims                         → ask to claim an artist / composer profile (pending review)
//   DELETE /claims/:id                     → withdraw a pending claim
//   GET    /claims/:id/profile  PUT …      → read / edit an APPROVED claim's profile (bio, photo, social links)
//   GET    /green                          → Green mark: plans, how to pay, my profiles' marks and my orders
//   POST   /green/orders  DELETE /green/orders/:id   → order a plan (reviewed by a Super Admin) / cancel a pending order
const app = new Hono();

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EVIDENCE_MIN = 10;
const EVIDENCE_MAX = 1000;
const MAX_OPEN_CLAIMS = 5;       // pending + approved per account
const MAX_NEW_CLAIMS_PER_DAY = 5;

const LOCKOUT_WINDOW_MINUTES = 15;
const LOCKOUT_THRESHOLD = 5;
// Same shape as a real hash, so a login for an unknown username costs the same as a wrong password.
const DUMMY_PASSWORD_HASH = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const TYPES = { artist: { table: 'artists', fk: 'artist_id' }, composer: { table: 'composers', fk: 'composer_id' } };
const ip = (c) => c.req.header('CF-Connecting-IP');

const publicAccount = (a) => ({ id: a.id, username: a.username, contact_email: a.contact_email ?? null });

app.post('/register', async (c) => {
  const data = await c.req.json().catch(() => ({}));
  const username = String(data.username || '').trim().toLowerCase();
  const password = String(data.password || '');
  const email = String(data.contact_email || '').trim();
  if (!USERNAME_RE.test(username)) return c.json({ error: 'Username must be 3–30 characters: letters, numbers, dot, dash or underscore' }, 400);
  if (password.length < PASSWORD_MIN) return c.json({ error: `Password must be at least ${PASSWORD_MIN} characters` }, 400);
  if (password.length > PASSWORD_MAX) return c.json({ error: 'Password is too long' }, 400);
  if (email && !EMAIL_RE.test(email)) return c.json({ error: 'That email address does not look right' }, 400);
  if (!(await verifyTurnstile(data.turnstile_token, c.env, ip(c)))) return c.json({ error: 'Security check failed. Please try again.' }, 400);

  const db = c.env.DB;
  if (await db.prepare('SELECT 1 FROM person_accounts WHERE username = ?').bind(username).first()) {
    return c.json({ error: 'That username is already taken' }, 409);
  }
  const result = await db
    .prepare('INSERT INTO person_accounts (username, password_hash, contact_email) VALUES (?, ?, ?)')
    .bind(username, await hashPassword(password), email || null)
    .run();
  const account = { id: result.meta.last_row_id, username, contact_email: email || null };
  return c.json({ token: await signPersonToken(account, c.env), account: publicAccount(account) }, 201);
});

app.post('/login', async (c) => {
  const { username: rawUsername, password } = await c.req.json().catch(() => ({}));
  const username = String(rawUsername || '').trim().toLowerCase();
  if (!username || !password) return c.json({ error: 'Username and password are required' }, 400);

  const db = c.env.DB;
  // Brute-force lockout, same scheme as the admin login (own key prefix so the two never share a counter).
  const key = `person:${username}`;
  await db.prepare(`DELETE FROM login_attempts WHERE username = ? AND created_at < datetime('now', ?)`).bind(key, `-${LOCKOUT_WINDOW_MINUTES} minutes`).run();
  const { count } = await db.prepare('SELECT COUNT(*) AS count FROM login_attempts WHERE username = ?').bind(key).first();
  if (count >= LOCKOUT_THRESHOLD) return c.json({ error: `Too many failed attempts. Try again in ${LOCKOUT_WINDOW_MINUTES} minutes.` }, 429);

  const account = await db.prepare('SELECT * FROM person_accounts WHERE username = ?').bind(username).first();
  const ok = await verifyPassword(String(password), account ? account.password_hash : DUMMY_PASSWORD_HASH);
  if (!account || !ok) {
    await db.prepare('INSERT INTO login_attempts (username) VALUES (?)').bind(key).run();
    return c.json({ error: 'Invalid username or password' }, 401);
  }
  await db.prepare('DELETE FROM login_attempts WHERE username = ?').bind(key).run();
  return c.json({ token: await signPersonToken(account, c.env), account: publicAccount(account) });
});

// ── Everything below needs a signed-in artist account ──
app.use('/me', requirePerson);
app.use('/change-password', requirePerson);
app.use('/claims', requirePerson);
app.use('/claims/*', requirePerson);
app.use('/green', requirePerson);
app.use('/green/*', requirePerson);

async function loadClaims(db, accountId) {
  const rows = await db
    .prepare(
      `SELECT c.id, c.status, c.evidence, c.review_note, c.created_at, c.reviewed_at,
              CASE WHEN c.artist_id IS NOT NULL THEN 'artist' ELSE 'composer' END AS type,
              COALESCE(a.name, p.name) AS name, COALESCE(a.slug, p.slug) AS slug
       FROM person_claims c
       LEFT JOIN artists a ON a.id = c.artist_id
       LEFT JOIN composers p ON p.id = c.composer_id
       WHERE c.account_id = ? ORDER BY c.created_at DESC, c.id DESC`
    )
    .bind(accountId)
    .all();
  return rows.results;
}

app.get('/me', async (c) => {
  const person = c.get('person');
  const account = await c.env.DB.prepare('SELECT id, username, contact_email FROM person_accounts WHERE id = ?').bind(person.id).first();
  return c.json({ account: publicAccount(account), claims: await loadClaims(c.env.DB, person.id) });
});

app.post('/change-password', async (c) => {
  const person = c.get('person');
  const { current_password, new_password } = await c.req.json().catch(() => ({}));
  if (!current_password || !new_password) return c.json({ error: 'current_password and new_password are required' }, 400);
  if (String(new_password).length < PASSWORD_MIN) return c.json({ error: `New password must be at least ${PASSWORD_MIN} characters` }, 400);
  if (String(new_password).length > PASSWORD_MAX) return c.json({ error: 'Password is too long' }, 400);
  const account = await c.env.DB.prepare('SELECT * FROM person_accounts WHERE id = ?').bind(person.id).first();
  if (!(await verifyPassword(String(current_password), account.password_hash))) return c.json({ error: 'Current password is incorrect' }, 401);
  await c.env.DB.prepare('UPDATE person_accounts SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(await hashPassword(String(new_password)), person.id).run();
  return c.json({ success: true });
});

app.post('/claims', async (c) => {
  const person = c.get('person');
  const data = await c.req.json().catch(() => ({}));
  const type = TYPES[data.type];
  if (!type) return c.json({ error: 'type must be artist or composer' }, 400);
  const evidence = String(data.evidence || '').trim();
  if (evidence.length < EVIDENCE_MIN) return c.json({ error: 'Tell us how we can verify it is you (a link to your official page or social account, for example)' }, 400);
  if (evidence.length > EVIDENCE_MAX) return c.json({ error: `Please keep it under ${EVIDENCE_MAX} characters` }, 400);
  const email = String(data.contact_email || '').trim();
  if (email && !EMAIL_RE.test(email)) return c.json({ error: 'That email address does not look right' }, 400);
  if (!(await verifyTurnstile(data.turnstile_token, c.env, ip(c)))) return c.json({ error: 'Security check failed. Please try again.' }, 400);

  const db = c.env.DB;
  const profile = await db.prepare(`SELECT id, name, slug FROM ${type.table} WHERE slug = ?`).bind(String(data.slug || '')).first();
  if (!profile) return c.json({ error: 'That profile does not exist' }, 404);

  if (await db.prepare(`SELECT 1 FROM person_claims WHERE ${type.fk} = ? AND status = 'approved'`).bind(profile.id).first()) {
    return c.json({ error: 'This profile has already been claimed. If you think that is a mistake, contact us.' }, 409);
  }
  if (await db.prepare(`SELECT 1 FROM person_claims WHERE account_id = ? AND ${type.fk} = ? AND status IN ('pending', 'approved')`).bind(person.id, profile.id).first()) {
    return c.json({ error: 'You already have a claim on this profile' }, 409);
  }
  const open = await db.prepare(`SELECT COUNT(*) AS n FROM person_claims WHERE account_id = ? AND status IN ('pending', 'approved')`).bind(person.id).first();
  if (open.n >= MAX_OPEN_CLAIMS) return c.json({ error: `You can have at most ${MAX_OPEN_CLAIMS} claims open at once` }, 429);
  const today = await db.prepare(`SELECT COUNT(*) AS n FROM person_claims WHERE account_id = ? AND created_at > datetime('now', '-1 day')`).bind(person.id).first();
  if (today.n >= MAX_NEW_CLAIMS_PER_DAY) return c.json({ error: 'Too many claims today. Try again tomorrow.' }, 429);

  if (email) await db.prepare('UPDATE person_accounts SET contact_email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(email, person.id).run();
  try {
    const result = await db.prepare(`INSERT INTO person_claims (account_id, ${type.fk}, evidence) VALUES (?, ?, ?)`).bind(person.id, profile.id, evidence).run();
    return c.json({ id: result.meta.last_row_id, status: 'pending', type: data.type, name: profile.name, slug: profile.slug }, 201);
  } catch (err) {
    // Lost a race against another claim or this account's duplicate (the unique indexes are the real guard).
    if (/UNIQUE/i.test(String(err.message))) return c.json({ error: 'This profile cannot be claimed right now' }, 409);
    throw err;
  }
});

const claimId = (c) => {
  const n = Number(c.req.param('id'));
  return Number.isInteger(n) && n > 0 ? n : null;
};

app.delete('/claims/:id', async (c) => {
  const id = claimId(c);
  if (!id) return c.json({ error: 'Not found' }, 404);
  const result = await c.env.DB
    .prepare(`DELETE FROM person_claims WHERE id = ? AND account_id = ? AND status = 'pending'`)
    .bind(id, c.get('person').id)
    .run();
  if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

/** The approved claim (and profile row) this account may edit — re-checked on every request. */
async function ownedProfile(c) {
  const id = claimId(c);
  if (!id) return null;
  const claim = await c.env.DB
    .prepare(`SELECT id, artist_id, composer_id FROM person_claims WHERE id = ? AND account_id = ? AND status = 'approved'`)
    .bind(id, c.get('person').id)
    .first();
  if (!claim) return null;
  const type = claim.artist_id ? 'artist' : 'composer';
  const t = TYPES[type];
  const profile = await c.env.DB.prepare(`SELECT id, name, slug, bio, image_url, social_links FROM ${t.table} WHERE id = ?`).bind(claim.artist_id ?? claim.composer_id).first();
  return profile ? { type, table: t.table, profile } : null;
}

const profileView = ({ type, profile }) => ({
  type, name: profile.name, slug: profile.slug, bio: profile.bio || '', image_url: profile.image_url || '',
  social_links: (() => { try { return JSON.parse(profile.social_links || '[]'); } catch { return []; } })(),
});

app.get('/claims/:id/profile', async (c) => {
  const owned = await ownedProfile(c);
  if (!owned) return c.json({ error: 'Not found' }, 404);
  return c.json(profileView(owned));
});

app.put('/claims/:id/profile', async (c) => {
  const owned = await ownedProfile(c);
  if (!owned) return c.json({ error: 'Not found' }, 404);
  const parsed = validateOwnerEdit(await c.req.json().catch(() => ({})));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { bio, image_url, social_links } = parsed.values;
  const before = owned.profile;

  await c.env.DB
    .prepare(`UPDATE ${owned.table} SET bio = ?, image_url = ?, social_links = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(bio, image_url, social_links, before.id)
    .run();

  // Visible in the admin Audit Log (as "artist:<username>"), with what changed. Photos are named, not copied.
  const changed = [];
  if ((before.bio || null) !== bio) changed.push(`bio (was: ${String(before.bio || '').slice(0, 120) || '—'})`);
  if ((before.image_url || null) !== image_url) changed.push('photo');
  if ((before.social_links || null) !== social_links) changed.push(`social links (was: ${before.social_links || '—'})`);
  if (changed.length) {
    await logAudit(c.env.DB, { sub: null, username: `${owned.type}:${c.get('person').username}` }, 'profile.owner_edit', owned.type, before.id, `${before.name} — ${changed.join('; ')}`);
  }
  const fresh = await c.env.DB.prepare(`SELECT id, name, slug, bio, image_url, social_links FROM ${owned.table} WHERE id = ?`).bind(before.id).first();
  return c.json(profileView({ type: owned.type, profile: fresh }));
});

// ── Green mark ──────────────────────────────────────────────────────────────────────
const MAX_ORDERS_PER_DAY = 5;

app.get('/green', async (c) => {
  const db = c.env.DB;
  const person = c.get('person');
  const offer = await loadOffer(db);
  // Only profiles this account owns (approved claim) can get a mark.
  const profiles = (await db
    .prepare(
      `SELECT c.id AS claim_id,
              CASE WHEN c.artist_id IS NOT NULL THEN 'artist' ELSE 'composer' END AS type,
              COALESCE(a.name, p.name) AS name, COALESCE(a.slug, p.slug) AS slug,
              COALESCE(ma.expires_at, mp.expires_at) AS expires_at,
              (COALESCE(ma.expires_at, mp.expires_at) > datetime('now')) AS active,
              EXISTS (SELECT 1 FROM green_orders o WHERE o.account_id = c.account_id AND o.status = 'pending'
                        AND ((c.artist_id IS NOT NULL AND o.artist_id = c.artist_id) OR (c.composer_id IS NOT NULL AND o.composer_id = c.composer_id))) AS has_pending
       FROM person_claims c
       LEFT JOIN artists a ON a.id = c.artist_id LEFT JOIN composers p ON p.id = c.composer_id
       LEFT JOIN green_marks ma ON ma.artist_id = c.artist_id LEFT JOIN green_marks mp ON mp.composer_id = c.composer_id
       WHERE c.account_id = ? AND c.status = 'approved' ORDER BY name COLLATE NOCASE`
    )
    .bind(person.id)
    .all()).results.map((r) => ({ ...r, active: !!r.active, has_pending: !!r.has_pending, expires_at: r.expires_at || null }));
  const orders = (await db
    .prepare(
      `SELECT o.id, o.months, o.amount_cents, o.currency, o.method, o.reference, o.status, o.review_note, o.created_at,
              COALESCE(a.name, p.name) AS name
       FROM green_orders o LEFT JOIN artists a ON a.id = o.artist_id LEFT JOIN composers p ON p.id = o.composer_id
       WHERE o.account_id = ? ORDER BY o.created_at DESC, o.id DESC LIMIT 50`
    )
    .bind(person.id)
    .all()).results;
  return c.json({ ...offer, profiles, orders });
});

app.post('/green/orders', async (c) => {
  const db = c.env.DB;
  const person = c.get('person');
  const data = await c.req.json().catch(() => ({}));
  const parsed = validateOrderInput(data);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { months, reference, note, receipt } = parsed.values;

  // The profile must be one this account owns right now.
  const claimRef = Number(data.claim_id);
  const claim = Number.isInteger(claimRef) && claimRef > 0
    ? await db.prepare(`SELECT artist_id, composer_id FROM person_claims WHERE id = ? AND account_id = ? AND status = 'approved'`).bind(claimRef, person.id).first()
    : null;
  if (!claim) return c.json({ error: 'Choose one of your approved profiles' }, 404);

  const offer = await loadOffer(db);
  const plan = offer.plans.find((p) => p.months === months);
  if (!plan) return c.json({ error: 'That plan is not available right now' }, 400);

  const recent = await db.prepare(`SELECT COUNT(*) AS n FROM green_orders WHERE account_id = ? AND created_at > datetime('now', '-1 day')`).bind(person.id).first();
  if (recent.n >= MAX_ORDERS_PER_DAY) return c.json({ error: 'Too many orders today. Try again tomorrow.' }, 429);

  const fk = claim.artist_id ? 'artist_id' : 'composer_id';
  try {
    const result = await db
      .prepare(`INSERT INTO green_orders (account_id, ${fk}, months, amount_cents, currency, method, reference, note, receipt) VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?)`)
      .bind(person.id, claim.artist_id ?? claim.composer_id, months, plan.price_cents, offer.currency, reference, note, receipt)
      .run();
    return c.json({ id: result.meta.last_row_id, status: 'pending', months, amount_cents: plan.price_cents, currency: offer.currency }, 201);
  } catch (err) {
    if (/UNIQUE/i.test(String(err.message))) return c.json({ error: 'You already have an order waiting for review for this profile' }, 409);
    throw err;
  }
});

app.delete('/green/orders/:id', async (c) => {
  const id = claimId(c);
  if (!id) return c.json({ error: 'Not found' }, 404);
  const result = await c.env.DB
    .prepare(`UPDATE green_orders SET status = 'cancelled' WHERE id = ? AND account_id = ? AND status = 'pending'`)
    .bind(id, c.get('person').id)
    .run();
  if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

export default app;
