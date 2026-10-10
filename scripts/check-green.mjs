#!/usr/bin/env node
// Integration checks for the Green mark (paid plans, hand-reviewed orders, expiry).   npm run test:green
//
// Runs the real Hono worker against an in-memory SQLite database built from schema.sql: plan/price rules,
// who may do what (Super Admin only for money), the order → review → mark flow, extending vs restarting
// an expiry, what the public API shows (and never shows), and behaviour before the migration. Exit 1 on failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const { default: app } = await load('worker/worker.js');
const { signJWT } = await load('worker/lib/auth.js');
const { parsePriceToCents, centsToPrice, validateSettings, validateOrderInput } = await load('worker/lib/green.js');

let passes = 0;
let failures = 0;
const check = (cond, msg) => { if (cond) passes++; else { failures++; console.error(`  ✗ ${msg}`); } };

const makeDb = (schemaTransform = (s) => s) => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(schemaTransform(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8')));
  const DB = {
    prepare(sql) {
      const st = sqlite.prepare(sql);
      const bound = (args) => ({
        first: async () => st.get(...args) ?? null,
        all: async () => ({ results: st.all(...args) }),
        run: async () => { const r = st.run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
      });
      return { ...bound([]), bind: (...args) => bound(args) };
    },
  };
  return { sqlite, DB };
};
const { sqlite, DB } = makeDb();
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
const get = (sql, ...a) => sqlite.prepare(sql).get(...a);
const all = (sql, ...a) => sqlite.prepare(sql).all(...a);

const ROLES = ['viewer', 'translator', 'reviewer', 'editor', 'manager', 'super_admin'];
ROLES.forEach((role, i) => run(`INSERT INTO admin_users (id, username, password_hash, role) VALUES (?, ?, 'x', ?)`, i + 1, role, role));
const SECRET = 'test-secret';
const adminToken = {};
for (const [i, role] of ROLES.entries()) adminToken[role] = await signJWT({ sub: i + 1, username: role }, SECRET);

run(`INSERT INTO artists (id, name, slug) VALUES (1, 'Ann Artist', 'ann-artist'), (2, 'Ben Singer', 'ben-singer')`);
run(`INSERT INTO composers (id, name, slug) VALUES (1, 'Cy Composer', 'cy-composer')`);

const ENV = { DB, JWT_SECRET: SECRET };
const call = async (method, url, { token, body, env = ENV } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await app.fetch(new Request(`https://api.test${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: res.status, json: await res.json().catch(() => null) };
};
const acct = (method, url, token, body) => call(method, `/api/v1/account${url}`, { token, body });
const adm = (method, url, role, body) => call(method, `/api/v1/admin/green${url}`, { token: adminToken[role], body });
const SA = 'super_admin';
const day = (offsetSql) => get(`SELECT date('now', ?) AS d`, offsetSql).d;
const dateOf = (dt) => String(dt).slice(0, 10);

// ─── Pure rules ──────────────────────────────────────────────────────────────
console.log('Prices and validation');
check(parsePriceToCents('4.99') === 499 && parsePriceToCents(5) === 500 && parsePriceToCents('0.5') === 50 && parsePriceToCents(' 12 ') === 1200 && parsePriceToCents('1000000') === 100000000, 'prices parse to cents');
for (const bad of ['0', '0.00', '-1', '4.999', 'abc', '', '1e3', '1,5', '10000001', null, undefined, '4.']) check(parsePriceToCents(bad) === null, `price ${JSON.stringify(bad)} rejected`);
check(centsToPrice(499) === '4.99' && centsToPrice(500) === '5.00' && centsToPrice(null) === '', 'cents format back');
check(validateSettings({ currency: 'usd', plans: [] }).ok && validateSettings({ currency: 'usd' }).currency === 'USD', 'currency is upper-cased');
check(!validateSettings({ currency: 'DOLLARS' }).ok && !validateSettings({ currency: 'US' }).ok && !validateSettings({}).ok, 'currency must be a 3-letter code');
check(!validateSettings({ currency: 'USD', plans: [{ months: 1, enabled: true }] }).ok, 'a plan cannot be enabled without a price');
check(!validateSettings({ currency: 'USD', plans: [{ months: 1, price: '-3' }] }).ok, 'a bad price is an error, not ignored');
check(!validateSettings({ currency: 'USD', payment_instructions: 'x'.repeat(2001) }).ok, 'instructions length capped');
check(validateSettings({ currency: 'USD', plans: [{ months: 7, price: '9', enabled: true }] }).plans.every((p) => !p.enabled) && validateSettings({ currency: 'USD' }).plans.length === 5, 'only the five real plans exist (unknown lengths ignored)');
check(!validateOrderInput({ months: 2, reference: 'abc' }).ok && !validateOrderInput({ months: 1, reference: 'ab' }).ok && !validateOrderInput({ months: 1, reference: 'x'.repeat(121) }).ok, 'order: plan and reference rules');
check(!validateOrderInput({ months: 1, reference: 'abc', receipt: 'javascript:alert(1)' }).ok && !validateOrderInput({ months: 1, reference: 'abc', receipt: 'data:text/html;base64,AAAA' }).ok && !validateOrderInput({ months: 1, reference: 'abc', receipt: `data:image/png;base64,${'A'.repeat(300000)}` }).ok, 'order: unsafe or oversized receipt rejected');
check(validateOrderInput({ months: 12, reference: ' TXN-123 ', note: ' hi ', receipt: 'data:image/jpeg;base64,/9j/AAAA' }).ok, 'order: valid input accepted');

// ─── Who may do what ─────────────────────────────────────────────────────────
console.log('Permissions');
for (const role of ROLES.filter((r) => r !== SA)) {
  check((await adm('GET', '/settings', role)).status === 403 && (await adm('PUT', '/settings', role, { currency: 'USD' })).status === 403 && (await adm('GET', '/orders', role)).status === 403 && (await adm('POST', '/marks', role, { type: 'artist', id: 1, months: 1 })).status === 403, `${role} cannot touch the Green mark (settings, orders, marks)`);
}
check((await call('GET', '/api/v1/admin/green/settings')).status === 401, 'anonymous → 401');
const register = async (username) => { const r = await call('POST', '/api/v1/account/register', { body: { username, password: 'correct horse', contact_email: `${username}@example.com`, contact_phone: '+91 98765 43210' } }); return r.json.token; };
const ann = await register('ann_real');
const bob = await register('bob_real');
check((await call('GET', '/api/v1/admin/green/settings', { token: ann })).status === 401, 'an artist token does not work on the Green mark admin API');
check((await acct('GET', '/green')).status === 401 && (await acct('GET', '/green', adminToken[SA])).status === 401, 'the artist Green mark API needs an artist login (admin token refused)');

// ─── Settings ────────────────────────────────────────────────────────────────
console.log('Settings (Super Admin)');
const initial = await adm('GET', '/settings', SA);
check(initial.status === 200 && initial.json.currency === 'USD' && initial.json.plans.map((p) => p.months).join() === '1,3,6,12,36' && initial.json.plans.every((p) => !p.enabled && p.price === ''), 'defaults: five plans, none priced, none on');
check((await acct('GET', '/green', ann)).json.plans.length === 0, '…so nothing is offered to buyers yet');
check((await adm('PUT', '/settings', SA, { currency: 'USD', plans: [{ months: 1, enabled: true }] })).status === 400, 'cannot enable a plan with no price');
const saved = await adm('PUT', '/settings', SA, {
  currency: 'usd', payment_instructions: 'Bank: Example Bank, IBAN 123.\nPlease put your username in the reference.',
  plans: [{ months: 1, price: '4.99', enabled: true }, { months: 3, price: '12', enabled: true }, { months: 6, price: '22.50', enabled: false }, { months: 12, price: '39.99', enabled: true }, { months: 36, price: '' }],
});
check(saved.status === 200 && saved.json.currency === 'USD' && saved.json.plans.find((p) => p.months === 6).price === '22.50' && !saved.json.plans.find((p) => p.months === 6).enabled && saved.json.plans.find((p) => p.months === 36).price === '', 'settings saved (a priced plan can be switched off)');
check(get(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'green.settings_edit'`).n === 1, 'settings change is in the audit log');
const offer = await acct('GET', '/green', ann);
check(offer.json.currency === 'USD' && offer.json.payment_instructions.startsWith('Bank: Example Bank') && offer.json.plans.map((p) => `${p.months}:${p.price_cents}`).join() === '1:499,3:1200,12:3999', 'buyers see only enabled, priced plans, plus how to pay');

// ─── Ordering ────────────────────────────────────────────────────────────────
console.log('Ordering');
const order = (token, body) => acct('POST', '/green/orders', token, body);
check((await acct('GET', '/green', ann)).json.profiles.length === 0, 'no approved claim → no profile to buy for');
check((await order(ann, { claim_id: 1, months: 1, reference: 'TXN-1' })).status === 404, 'cannot order without an approved claim');
// claims: ann owns artist 1 + composer 1; bob only has a pending claim on artist 2
run(`INSERT INTO person_claims (id, account_id, artist_id, status, evidence) VALUES (1, 1, 1, 'approved', 'proof here')`);
run(`INSERT INTO person_claims (id, account_id, composer_id, status, evidence) VALUES (2, 1, 1, 'approved', 'proof here')`);
run(`INSERT INTO person_claims (id, account_id, artist_id, status, evidence) VALUES (3, 2, 2, 'pending', 'proof here')`);
const profiles = (await acct('GET', '/green', ann)).json.profiles;
check(profiles.length === 2 && profiles.every((p) => p.active === false && p.expires_at === null), 'owner sees their approved profiles, no mark yet');
check((await acct('GET', '/green', bob)).json.profiles.length === 0, 'a pending claim is not enough');
check((await order(bob, { claim_id: 3, months: 1, reference: 'TXN-B' })).status === 404, 'bob cannot buy for a profile he has only claimed, not been approved for');
check((await order(bob, { claim_id: 1, months: 1, reference: 'TXN-B' })).status === 404, "bob cannot buy for ann's profile with her claim id");
check((await order(undefined, { claim_id: 1, months: 1, reference: 'TXN-1' })).status === 401, 'ordering needs a login');
check((await order(ann, { claim_id: 1, months: 6, reference: 'TXN-1' })).status === 400, 'a plan that is switched off cannot be ordered');
check((await order(ann, { claim_id: 1, months: 36, reference: 'TXN-1' })).status === 400, 'a plan without a price cannot be ordered');
check((await order(ann, { claim_id: 1, months: 2, reference: 'TXN-1' })).status === 400 && (await order(ann, { claim_id: 1, months: 1, reference: '' })).status === 400, 'bad plan / missing reference → 400');
check((await order(ann, { claim_id: 1, months: 1, reference: 'TXN-1', receipt: 'javascript:alert(1)' })).status === 400, 'unsafe receipt → 400');
const o1 = await order(ann, { claim_id: 1, months: 3, reference: 'TXN-100', note: 'Paid by bank transfer', receipt: 'data:image/jpeg;base64,/9j/AAAA' });
check(o1.status === 201 && o1.json.status === 'pending' && o1.json.amount_cents === 1200 && o1.json.currency === 'USD', 'order created (pending), price taken from the plan');
// raising the price later must not change an order already placed
await adm('PUT', '/settings', SA, { currency: 'USD', payment_instructions: 'x', plans: [{ months: 1, price: '9.99', enabled: true }, { months: 3, price: '30', enabled: true }, { months: 12, price: '39.99', enabled: true }] });
check(get('SELECT amount_cents FROM green_orders WHERE id = ?', o1.json.id).amount_cents === 1200, 'the price is frozen on the order when it is placed');
check((await order(ann, { claim_id: 1, months: 1, reference: 'TXN-101' })).status === 409, 'only one pending order per profile → 409');
const o2 = await order(ann, { claim_id: 2, months: 1, reference: 'TXN-200' });
check(o2.status === 201, 'a different profile can have its own order');
check((await acct('GET', '/green', ann)).json.profiles.every((p) => p.has_pending === true), 'profiles report a pending order');
check((await acct('DELETE', `/green/orders/${o2.json.id}`, bob)).status === 404, "cannot cancel someone else's order");
check((await acct('DELETE', `/green/orders/${o2.json.id}`, ann)).status === 200 && (await acct('DELETE', `/green/orders/${o2.json.id}`, ann)).status === 404, 'cancel own pending order (twice → 404)');
check(get('SELECT status FROM green_orders WHERE id = ?', o2.json.id).status === 'cancelled', '…it is marked cancelled');
check((await order(ann, { claim_id: 2, months: 1, reference: 'TXN-201' })).status === 201, 'after cancelling, a new order is allowed');
const mine = (await acct('GET', '/green', ann)).json.orders;
check(mine.length === 3 && !JSON.stringify(mine).includes('base64') && !JSON.stringify(mine).includes('Paid by bank'), 'my orders list does not echo receipts or notes');

// ─── Review ──────────────────────────────────────────────────────────────────
console.log('Review (Super Admin)');
const list = await adm('GET', '/orders', SA);
check(list.status === 200 && list.json.orders[0].status === 'pending' && list.json.orders[0].buyer === 'ann_real' && list.json.orders.every((o) => !('receipt' in o)) && list.json.orders.find((o) => o.id === o1.json.id).has_receipt === true, 'orders list: pending first, buyer shown, receipt not inlined');
check((await adm('GET', '/orders?status=pending', SA)).json.total === 2 && (await adm('GET', '/orders?status=approved', SA)).json.total === 0, 'status filter');
const detail = await adm('GET', `/orders/${o1.json.id}`, SA);
check(detail.status === 200 && detail.json.receipt === 'data:image/jpeg;base64,/9j/AAAA' && detail.json.reference === 'TXN-100' && detail.json.note === 'Paid by bank transfer', 'order detail includes the receipt and note');
check((await adm('GET', '/orders/9999', SA)).status === 404, 'unknown order → 404');
check((await adm('PUT', `/orders/${o1.json.id}/reject`, SA, {})).status === 400, 'reject needs a note');
const o3 = (await acct('GET', '/green', ann)).json.orders.find((o) => o.status === 'pending' && o.name === 'Cy Composer');
const rej = await adm('PUT', `/orders/${o3.id}/reject`, SA, { note: 'We could not find this payment.' });
check(rej.status === 200 && rej.json.status === 'rejected', 'reject with a note');
check((await acct('GET', '/green', ann)).json.orders.find((o) => o.id === o3.id).review_note === 'We could not find this payment.', 'the buyer sees why');
check(get('SELECT COUNT(*) AS n FROM green_marks').n === 0, 'rejecting gives no mark');
check((await adm('PUT', `/orders/${o3.id}/approve`, SA)).status === 409 && (await adm('PUT', `/orders/${o3.id}/reject`, SA, { note: 'again' })).status === 409, 'a reviewed order cannot be reviewed again');

console.log('Approve → mark');
check((await call('GET', '/api/v1/artists/ann-artist')).json.green === false, 'before approval: no mark on the public profile');
const ap = await adm('PUT', `/orders/${o1.json.id}/approve`, SA, { note: 'Payment received. Thank you!' });
check(ap.status === 200 && ap.json.status === 'approved' && dateOf(ap.json.mark_expires_at) === day('+3 months'), 'approve switches the mark on for the paid months (3)');
check((await adm('PUT', `/orders/${o1.json.id}/approve`, SA)).status === 409 && get('SELECT COUNT(*) AS n FROM green_marks').n === 1, 'approving twice is refused and adds nothing');
check((await call('GET', '/api/v1/artists/ann-artist')).json.green === true && (await call('GET', '/api/v1/composers/cy-composer')).json.green === false, 'the public profile now shows the mark (only that profile)');
const pubList = await call('GET', '/api/v1/artists');
check(pubList.json.artists.find((a) => a.slug === 'ann-artist').green === true && pubList.json.artists.find((a) => a.slug === 'ben-singer').green === false, 'the public directory flags it too');
const pubText = JSON.stringify([(await call('GET', '/api/v1/artists/ann-artist')).json, pubList.json]);
check(!/expires|amount|price|TXN-|ann_real|receipt|buyer/i.test(pubText.replace(/"green":(true|false)/g, '')), 'the public API reveals no expiry, price, reference or buyer');
const prof = (await acct('GET', '/green', ann)).json.profiles.find((p) => p.slug === 'ann-artist');
check(prof.active === true && dateOf(prof.expires_at) === day('+3 months'), 'the owner sees when their mark expires');

console.log('Extending and expiry');
// extend while active: new time is added AFTER the current expiry
const expiryBefore = get('SELECT expires_at FROM green_marks WHERE artist_id = 1').expires_at;
const o4 = await order(ann, { claim_id: 1, months: 12, reference: 'TXN-300' });
await adm('PUT', `/orders/${o4.json.id}/approve`, SA);
const expiryAfter = get('SELECT expires_at FROM green_marks WHERE artist_id = 1').expires_at;
check(dateOf(expiryAfter) === get(`SELECT date(?, '+12 months') AS d`, expiryBefore).d && dateOf(expiryAfter) === day('+15 months'), 'buying while active extends from the current expiry (3 + 12 = 15 months)');
check(get('SELECT COUNT(*) AS n FROM green_marks WHERE artist_id = 1').n === 1, 'still one mark row per profile');
// expired mark: starts again from today, not from the old date
run(`UPDATE green_marks SET expires_at = datetime('now', '-40 days') WHERE artist_id = 1`);
check((await call('GET', '/api/v1/artists/ann-artist')).json.green === false && (await acct('GET', '/green', ann)).json.profiles.find((p) => p.slug === 'ann-artist').active === false, 'an expired mark disappears from the public profile');
check((await call('GET', '/api/v1/artists')).json.artists.find((a) => a.slug === 'ann-artist').green === false, '…and from the directory');
const o5 = await order(ann, { claim_id: 1, months: 1, reference: 'TXN-400' });
await adm('PUT', `/orders/${o5.json.id}/approve`, SA);
check(dateOf(get('SELECT expires_at FROM green_marks WHERE artist_id = 1').expires_at) === day('+1 months') && (await call('GET', '/api/v1/artists/ann-artist')).json.green === true, 'buying after expiry starts a fresh period from today and turns the mark back on');

console.log('Safety');
// claim revoked between ordering and approval
run(`UPDATE green_orders SET created_at = datetime('now', '-2 days')`); // earlier orders no longer count towards today's limit
const o6 = await order(ann, { claim_id: 2, months: 1, reference: 'TXN-500' });
run(`UPDATE person_claims SET status = 'revoked' WHERE id = 2`);
const stale = await adm('PUT', `/orders/${o6.json.id}/approve`, SA);
check(stale.status === 409 && get('SELECT status FROM green_orders WHERE id = ?', o6.json.id).status === 'pending' && get('SELECT COUNT(*) AS n FROM green_marks WHERE composer_id = 1').n === 0, 'if the buyer lost ownership, approval is refused (409) and no mark is created');
check((await order(ann, { claim_id: 2, months: 1, reference: 'TXN-501' })).status === 404, '…and they can no longer order for that profile');
check((await adm('PUT', `/orders/${o6.json.id}/reject`, SA, { note: 'Claim revoked — refunded.' })).status === 200, 'the order can still be rejected');
run(`UPDATE person_claims SET status = 'approved' WHERE id = 2`);
run(`INSERT INTO artists (id, name, slug) VALUES (20,'A20','a20'),(21,'A21','a21'),(22,'A22','a22'),(23,'A23','a23'),(24,'A24','a24'),(25,'A25','a25')`);
run(`INSERT INTO person_accounts (id, username, password_hash) VALUES (50, 'busy', 'x')`);
{
  // Ordering needs an email AND a phone number on the account (so a payment can be followed up).
  run(`INSERT INTO person_claims (id, account_id, artist_id, status, evidence) VALUES (99, 50, 20, 'approved', 'proof here')`);
  const { signJWT: sign } = await load('worker/lib/auth.js');
  const noContact = await sign({ sub: 50, username: 'busy', typ: 'person' }, `${SECRET}:person-account`);
  const refused = await order(noContact, { claim_id: 99, months: 1, reference: 'NOCONTACT-1' });
  check(refused.status === 400 && /phone/i.test(refused.json.error), 'an account without email + phone cannot order → 400');
  run(`UPDATE person_accounts SET contact_email = 'busy@example.com', contact_phone = '+919876543210' WHERE id = 50`);
  run(`DELETE FROM person_claims WHERE id = 99`);
}
const busyToken = await (async () => { const { signJWT: s } = await load('worker/lib/auth.js'); return s({ sub: 50, username: 'busy', typ: 'person' }, `${SECRET}:person-account`); })();
let lastStatus = 0;
for (let i = 0; i < 6; i++) {
  run(`INSERT INTO person_claims (id, account_id, artist_id, status, evidence) VALUES (${100 + i}, 50, ${20 + i}, 'approved', 'proof here')`);
  lastStatus = (await order(busyToken, { claim_id: 100 + i, months: 1, reference: `BUSY-${i}` })).status;
}
check(lastStatus === 429, 'at most 5 orders per day per account → 429');

console.log('Granting and removing by hand');
check((await adm('POST', '/marks', SA, { type: 'artist', id: 2, months: 6 })).status === 201 && (await call('GET', '/api/v1/artists/ben-singer')).json.green === true, 'Super Admin can grant a mark by hand (free / comp)');
check((await adm('POST', '/marks', SA, { type: 'artist', id: 2, months: 5 })).status === 400 && (await adm('POST', '/marks', SA, { type: 'band', id: 2, months: 1 })).status === 400 && (await adm('POST', '/marks', SA, { type: 'artist', id: 999, months: 1 })).status === 404, 'grant: bad months / type / profile rejected');
const marks = (await adm('GET', '/marks', SA)).json;
check(marks.total === 2 && marks.marks.every((m) => m.active === true && m.name && m.expires_at), 'marks list shows who has one and until when');
const benMark = marks.marks.find((m) => m.slug === 'ben-singer');
check((await adm('DELETE', `/marks/${benMark.id}`, SA)).status === 200 && (await adm('DELETE', `/marks/${benMark.id}`, SA)).status === 404 && (await call('GET', '/api/v1/artists/ben-singer')).json.green === false, 'removing a mark switches it off (twice → 404)');
for (const action of ['green.order_approve', 'green.order_reject', 'green.mark_grant', 'green.mark_remove']) check(get(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`, action).n >= 1, `audit log has ${action}`);
check(get(`SELECT detail FROM audit_log WHERE action = 'green.order_approve'`).detail.includes('TXN-100'), 'the approval audit entry names the payment reference');
run('DELETE FROM artists WHERE id = 2');
check(get('SELECT COUNT(*) AS n FROM green_marks WHERE artist_id = 2').n === 0, 'deleting a profile removes its mark (cascade)');

// ─── Deploy order ────────────────────────────────────────────────────────────
console.log('Before migration 0016');
{
  const old = makeDb((s) => s.replace(/-- ─── Green mark[\s\S]*?(?=-- ── Performance indexes)/, ''));
  old.sqlite.exec(`INSERT INTO artists (id, name, slug) VALUES (1, 'Old Artist', 'old-artist')`);
  const env = { DB: old.DB, JWT_SECRET: SECRET };
  check(old.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'green_marks'").get() === undefined, '(setup: this database has no green_marks table)');
  const one = await call('GET', '/api/v1/artists/old-artist', { env });
  const many = await call('GET', '/api/v1/artists', { env });
  check(one.status === 200 && one.json.green === false && many.status === 200 && many.json.artists[0].green === false, 'public profiles and the directory still load (green: false) until the migration is run');
}

console.log(`\n${failures ? '✗' : '✓'} ${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
