#!/usr/bin/env node
// Integration checks for artist/composer badges.   npm run test:badges
//
// Runs the real Hono worker (worker/worker.js) against an in-memory SQLite database built from
// schema.sql, with real signed JWTs for each admin role — so permissions, validation, SQL
// constraints, cascades and the public output are all exercised for real. Exit code 1 on failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const { default: app } = await load('worker/worker.js');
const { signJWT } = await load('worker/lib/auth.js');
const { validateBadgeInput, sortBadges } = await load('worker/lib/badges.js');

let passes = 0;
let failures = 0;
const check = (cond, msg) => { if (cond) passes++; else { failures++; console.error(`  ✗ ${msg}`); } };

// ─── Database (D1-style adapter over node:sqlite) ────────────────────────────
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys = ON'); // D1 enforces foreign keys; node:sqlite defaults to off
sqlite.exec(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));
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
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);

const ROLES = ['viewer', 'translator', 'reviewer', 'editor', 'manager', 'super_admin'];
ROLES.forEach((role, i) => run(`INSERT INTO admin_users (id, username, password_hash, role) VALUES (?, ?, 'x', ?)`, i + 1, role, role));
const SECRET = 'test-secret';
const token = {};
for (const [i, role] of ROLES.entries()) token[role] = await signJWT({ sub: i + 1, username: role }, SECRET);

run(`INSERT INTO artists (id, name, slug) VALUES (1, 'Ann Artist', 'ann-artist'), (2, 'Bob Artist', 'bob-artist')`);
run(`INSERT INTO composers (id, name, slug) VALUES (1, 'Cy Composer', 'cy-composer')`);

const call = async (method, url, { as, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = `Bearer ${token[as]}`;
  const res = await app.fetch(new Request(`https://api.test${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { DB, JWT_SECRET: SECRET });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const award = (kind, id, body, as = 'super_admin') => call('POST', `/api/v1/admin/${kind}/${id}/badges`, { as, body });

// ─── Pure validation ─────────────────────────────────────────────────────────
console.log('Validation');
check(validateBadgeInput({ period: 'lifetime' }).ok, 'lifetime needs no value');
check(validateBadgeInput({ period: 'lifetime', period_value: '2026' }).value.period_value === '', 'lifetime ignores a stray value');
check(validateBadgeInput({ period: 'month', period_value: '2026-10' }).ok, 'month 2026-10 is valid');
for (const bad of ['2026-13', '2026-00', '2026-1', '26-10', '2026/10', '', undefined, '1899-12', '2101-01']) {
  check(!validateBadgeInput({ period: 'month', period_value: bad }).ok, `month ${JSON.stringify(bad)} must be rejected`);
}
check(validateBadgeInput({ period: 'year', period_value: '2026' }).ok, 'year 2026 is valid');
for (const bad of ['26', '20266', 'abcd', '', undefined, '1899', '2101']) {
  check(!validateBadgeInput({ period: 'year', period_value: bad }).ok, `year ${JSON.stringify(bad)} must be rejected`);
}
check(!validateBadgeInput({ period: 'week', period_value: '1' }).ok, 'unknown period rejected');
check(!validateBadgeInput({}).ok, 'missing period rejected');
check(!validateBadgeInput({ period: 'lifetime', title: 'x'.repeat(61) }).ok, 'title over 60 chars rejected');
check(validateBadgeInput({ period: 'lifetime', title: '  Star\n\tsinger  ' }).value.title === 'Star singer', 'title whitespace/control chars normalised');
check(validateBadgeInput({ period: 'lifetime', title: '   ' }).value.title === null, 'blank title becomes null');
const order = sortBadges([
  { period: 'month', period_value: '2026-01' }, { period: 'year', period_value: '2024' }, { period: 'lifetime', period_value: '' },
  { period: 'month', period_value: '2026-10' }, { period: 'year', period_value: '2026' },
]).map((b) => `${b.period}:${b.period_value}`);
check(order.join() === 'lifetime:,year:2026,year:2024,month:2026-10,month:2026-01', `sort order wrong: ${order}`);

// ─── Permissions ─────────────────────────────────────────────────────────────
console.log('Permissions (only Super Admin may award or remove)');
check((await call('POST', '/api/v1/admin/artists/1/badges', { body: { period: 'lifetime' } })).status === 401, 'anonymous → 401');
check((await call('DELETE', '/api/v1/admin/artists/1/badges/1')).status === 401, 'anonymous delete → 401');
for (const role of ROLES.filter((r) => r !== 'super_admin')) {
  const r = await award('artists', 1, { period: 'lifetime' }, role);
  check(r.status === 403, `${role} must not award a badge (got ${r.status})`);
}
check(Number(sqlite.prepare('SELECT COUNT(*) AS n FROM person_badges').get().n) === 0, 'no badge was written by a forbidden request');

const lifetime = await award('artists', 1, { period: 'lifetime', title: 'Voice of Mara' });
check(lifetime.status === 201 && lifetime.json.period === 'lifetime' && lifetime.json.title === 'Voice of Mara', 'super_admin can award a lifetime badge');
const year = await award('artists', 1, { period: 'year', period_value: '2026' });
const month = await award('artists', 1, { period: 'month', period_value: '2026-10' });
const month2 = await award('artists', 1, { period: 'month', period_value: '2026-09' });
check([year, month, month2].every((r) => r.status === 201), 'super_admin can award year and several month badges');
check((await award('composers', 1, { period: 'year', period_value: '2025' })).status === 201, 'badges work for composers too');

for (const role of ROLES.filter((r) => r !== 'super_admin')) {
  const r = await call('DELETE', `/api/v1/admin/artists/1/badges/${lifetime.json.id}`, { as: role });
  check(r.status === 403, `${role} must not remove a badge (got ${r.status})`);
}
check(Number(sqlite.prepare('SELECT COUNT(*) AS n FROM person_badges WHERE id = ?').get(lifetime.json.id).n) === 1, 'badge still exists after forbidden deletes');

// ─── Validation through the API ──────────────────────────────────────────────
console.log('API validation');
check((await award('artists', 1, { period: 'month', period_value: '2026-13' })).status === 400, 'bad month → 400');
check((await award('artists', 1, { period: 'nope' })).status === 400, 'bad period → 400');
check((await award('artists', 1, { period: 'lifetime', title: 'x'.repeat(61) })).status === 400, 'long title → 400');
check((await award('artists', 999, { period: 'lifetime' })).status === 404, 'unknown artist → 404');
check((await award('artists', 'abc', { period: 'lifetime' })).status === 404, 'non-numeric id → 404');
check((await call('POST', '/api/v1/admin/artists/1/badges', { as: 'super_admin' })).status === 400, 'missing body → 400');

console.log('Duplicates');
const dupe = await award('artists', 1, { period: 'month', period_value: '2026-10' });
check(dupe.status === 409 && /already/.test(dupe.json.error), 'same month twice → 409');
check((await award('artists', 1, { period: 'lifetime' })).status === 409, 'lifetime twice → 409');
check((await award('artists', 2, { period: 'month', period_value: '2026-10' })).status === 201, 'same month on another artist is fine');
check((await award('composers', 1, { period: 'lifetime' })).status === 201, 'composer #1 is independent of artist #1');

// ─── Reading ─────────────────────────────────────────────────────────────────
console.log('Reading');
const adminList = await call('GET', '/api/v1/admin/artists', { as: 'viewer' });
const annAdmin = adminList.json.artists.find((a) => a.id === 1);
check(adminList.status === 200 && annAdmin.badges.every((b) => typeof b.id === 'number'), 'any admin can read badges (with ids) in the admin list');
check(annAdmin.badges.map((b) => `${b.period}:${b.period_value}`).join() === 'lifetime:,year:2026,month:2026-10,month:2026-09', 'admin list is sorted most-prestigious first');

const pub = await call('GET', '/api/v1/artists');
const annPub = pub.json.artists.find((a) => a.slug === 'ann-artist');
check(pub.status === 200 && annPub.badges.length === 4, 'public list includes badges, no login needed');
check(annPub.badges.every((b) => !('id' in b) && !('awarded_by' in b) && !('artist_id' in b)), 'public badges expose neither ids nor who awarded them');
check(pub.json.artists.find((a) => a.slug === 'bob-artist').badges.length === 1, 'each artist only gets their own badges');
const one = await call('GET', '/api/v1/artists/ann-artist');
check(one.json.badges.length === 4 && Array.isArray(one.json.songs), 'public profile includes badges and songs');
const comp = await call('GET', '/api/v1/composers/cy-composer');
check(comp.json.badges.map((b) => b.period).join() === 'lifetime,year', 'composer profile has its own badges');
check((await call('GET', '/api/v1/artists/nobody')).status === 404, 'unknown artist still 404');

console.log('Removal');
const rm = await call('DELETE', `/api/v1/admin/artists/1/badges/${month2.json.id}`, { as: 'super_admin' });
check(rm.status === 200, 'super_admin can remove a badge');
check((await call('DELETE', `/api/v1/admin/artists/1/badges/${month2.json.id}`, { as: 'super_admin' })).status === 404, 'removing twice → 404');
check((await call('DELETE', `/api/v1/admin/artists/2/badges/${month.json.id}`, { as: 'super_admin' })).status === 404, "a badge can't be removed through someone else's URL");
check(Number(sqlite.prepare('SELECT COUNT(*) AS n FROM person_badges WHERE id = ?').get(month.json.id).n) === 1, 'that badge is untouched');

console.log('Audit log');
const audit = sqlite.prepare("SELECT action, target_type, admin_username FROM audit_log WHERE action LIKE 'badge.%' ORDER BY id").all();
check(audit.some((a) => a.action === 'badge.award' && a.admin_username === 'super_admin' && a.target_type === 'artist'), 'awarding is audit-logged');
check(audit.some((a) => a.action === 'badge.remove'), 'removal is audit-logged');
check(audit.length === 8, `expected 7 awards + 1 removal in the audit log, got ${audit.length}`);

// ─── Integrity & revocation ──────────────────────────────────────────────────
console.log('Integrity');
let threw = false;
try { run(`INSERT INTO person_badges (artist_id, composer_id, period) VALUES (1, 1, 'lifetime')`); } catch { threw = true; }
check(threw, 'DB rejects a badge for both an artist and a composer');
threw = false;
try { run(`INSERT INTO person_badges (artist_id, period, period_value) VALUES (1, 'month', '2026-1x')`); } catch { threw = true; }
check(threw, 'DB rejects a malformed month value');
threw = false;
try { run(`INSERT INTO person_badges (period) VALUES ('lifetime')`); } catch { threw = true; }
check(threw, 'DB rejects a badge that belongs to nobody');

const before = Number(sqlite.prepare('SELECT COUNT(*) AS n FROM person_badges WHERE artist_id = 2').get().n);
const del = await call('DELETE', '/api/v1/admin/artists/2', { as: 'manager' });
check(before === 1 && del.status === 200 && Number(sqlite.prepare('SELECT COUNT(*) AS n FROM person_badges WHERE artist_id = 2').get().n) === 0, "deleting an artist removes that artist's badges (cascade)");

// requireAuth re-reads the role from the DB, so a demoted Super Admin loses badge access at once.
run(`UPDATE admin_users SET role = 'manager' WHERE id = 6`);
check((await award('artists', 1, { period: 'year', period_value: '2020' })).status === 403, 'a demoted Super Admin is refused immediately (old token, new role)');
run(`UPDATE admin_users SET role = 'super_admin' WHERE id = 6`);
check((await award('artists', 1, { period: 'year', period_value: '2020' })).status === 201, '…and works again once re-promoted');

console.log(`\n${failures ? '✗' : '✓'} ${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
