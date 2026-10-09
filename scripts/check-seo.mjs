#!/usr/bin/env node
// SEO validation for the public site. No dependencies.   npm run seo:check
//
//  1. Static HTML   — titles, descriptions, canonicals, social tags, headings, JSON-LD, images,
//                     robots/noindex expectations and internal links for every page in public/.
//  2. robots.txt    — sitemap line, admin protection, nothing important blocked.
//  3. Server pages  — runs the real Pages Functions (song/artist/composer/owner/article and the
//                     sitemap) against an in-memory SQLite database built from schema.sql, so the
//                     real SQL is exercised. Checks status codes, canonicals, JSON-LD, rendered
//                     content, 404/noindex handling and sitemap validity.
//
// Exit code 1 if any check fails. Things that need an external tool (Search Console, Rich Results
// Test, PageSpeed) are NOT claimed here — see SEO.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const ORIGIN = 'https://maralyrics.com';

let failures = 0;
let passes = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = () => { passes++; };
const check = (cond, msg) => (cond ? ok() : fail(msg));
const section = (name) => console.log(`\n${name}`);

// ─── 1. Static HTML ──────────────────────────────────────────────────────────
const pages = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, ''));
const SHELLS = new Set(['songview', 'artistview', 'composerview', 'copyrightownerview', 'articleview']);
const NOINDEX = new Set(['404', 'downloads', 'report', ...SHELLS]);

const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1];
const metaContent = (html, sel) => {
  const tag = (html.match(new RegExp(`<meta[^>]*${sel}[^>]*>`)) || [])[0];
  return tag ? attr(tag, 'content') : undefined;
};

section('Static HTML');
const titles = new Map();
const descs = new Map();
const knownPaths = new Set(['/', ...pages.map((p) => `/${p}`), ...fs.readdirSync(PUBLIC).map((f) => `/${f}`)]);
const dynamicPrefixes = ['/song/', '/artist/', '/composer/', '/copyright-owner/', '/article/'];

for (const page of pages) {
  const html = fs.readFileSync(path.join(PUBLIC, `${page}.html`), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  const label = `${page}.html`;
  const indexable = !NOINDEX.has(page);

  const title = (head.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]?.trim();
  const desc = metaContent(head, 'name="description"');
  check(!!title, `${label}: missing <title>`);
  check(!!desc, `${label}: missing meta description`);
  check(/<html lang="[a-z-]+"/.test(html), `${label}: missing <html lang>`);
  check(/<meta charset="UTF-8"/i.test(head), `${label}: missing charset`);
  check(/<meta name="viewport"/.test(head), `${label}: missing viewport`);
  check(!/name="keywords"/.test(head), `${label}: has a keywords meta tag (ignored by Google; remove)`);

  if (indexable) {
    check(title && title.length <= 70, `${label}: title is ${title && title.length} chars (keep ≤ 70)`);
    check(desc && desc.length >= 50 && desc.length <= 170, `${label}: description is ${desc && desc.length} chars (want 50–170)`);
    if (title) { check(!titles.has(title), `${label}: duplicate title with ${titles.get(title)}`); titles.set(title, label); }
    if (desc) { check(!descs.has(desc), `${label}: duplicate description with ${descs.get(desc)}`); descs.set(desc, label); }

    const canonical = (head.match(/<link rel="canonical"[^>]*>/) || [])[0];
    const href = canonical && attr(canonical, 'href');
    check(href && href.startsWith(`${ORIGIN}/`) || href === ORIGIN, `${label}: canonical missing or not on ${ORIGIN} (https)`);
    check(!/\/$/.test(href || '') || href === `${ORIGIN}/`, `${label}: canonical has a trailing slash`);
    check(metaContent(head, 'property="og:url"') === href, `${label}: og:url differs from canonical`);
    check(metaContent(head, 'property="og:title"') === title, `${label}: og:title differs from <title>`);
    check(!!metaContent(head, 'property="og:description"'), `${label}: missing og:description`);
    check(/^https:\/\/maralyrics\.com\/og-image\.png$/.test(metaContent(head, 'property="og:image"') || ''), `${label}: og:image missing/wrong`);
    check(metaContent(head, 'name="twitter:card"') === 'summary_large_image', `${label}: twitter:card should be summary_large_image`);
    check(!/name="robots" content="[^"]*noindex/.test(head), `${label}: unexpectedly noindex`);
  } else {
    check(/name="robots" content="[^"]*noindex/.test(head), `${label}: should be noindex`);
  }

  // Headings: exactly one h1, and no skipped levels.
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  check(levels.filter((l) => l === 1).length === 1, `${label}: needs exactly one <h1> (has ${levels.filter((l) => l === 1).length})`);
  let prev = 0;
  for (const l of levels) { if (prev && l > prev + 1) { fail(`${label}: heading jumps h${prev} → h${l}`); break; } prev = l; }

  // JSON-LD must parse.
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try { check(JSON.parse(m[1])['@context'] === 'https://schema.org', `${label}: JSON-LD missing @context`); } catch (e) { fail(`${label}: invalid JSON-LD (${e.message})`); }
  }

  // Images: alt attribute everywhere; fixed-size logos carry width/height.
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    check(/\balt=/.test(m[0]), `${label}: <img> without alt: ${m[0].slice(0, 60)}`);
    if (/header__logo-icon|footer__brand-icon/.test(m[0])) check(/\bwidth=/.test(m[0]) && /\bheight=/.test(m[0]), `${label}: logo <img> without width/height`);
  }

  // Internal links resolve.
  for (const m of html.matchAll(/<a\b[^>]*\bhref="(\/[^"#?]*)/g)) {
    const p = m[1].replace(/\/$/, '') || '/';
    const known = knownPaths.has(p) || knownPaths.has(`${p}.html`) || dynamicPrefixes.some((d) => m[1].startsWith(d)) || p.startsWith('/admin');
    check(known, `${label}: broken internal link ${m[1]}`);
  }
}

// ─── 2. robots.txt ───────────────────────────────────────────────────────────
section('robots.txt');
const robots = fs.readFileSync(path.join(PUBLIC, 'robots.txt'), 'utf8');
const lines = robots.split('\n').map((l) => l.trim());
check(lines.includes(`Sitemap: ${ORIGIN}/sitemap.xml`), 'Sitemap line missing or not absolute https');
check(lines.includes('Allow: /'), 'robots.txt should allow crawling');
check(lines.includes('Disallow: /admin/'), 'robots.txt should disallow /admin/');
check(!lines.some((l) => /^Disallow:\s*\/\s*$/.test(l)), 'robots.txt blocks the whole site');
check(!lines.some((l) => /Disallow:.*\.(css|js)\b/i.test(l) || /Disallow:\s*\/(locales|style)/.test(l)), 'robots.txt blocks CSS/JS/locale files crawlers need to render pages');
const headers = fs.readFileSync(path.join(PUBLIC, '_headers'), 'utf8');
check(/\/admin\/\*[\s\S]*?X-Robots-Tag: noindex/.test(headers), '_headers: /admin/* should send X-Robots-Tag: noindex');

// ─── 3. Server-rendered pages + sitemap, against real SQL ────────────────────
section('Server-rendered pages (Pages Functions + real SQLite schema)');
const db = new DatabaseSync(':memory:');
db.exec(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));
const d1 = {
  prepare(sql) {
    const stmt = db.prepare(sql);
    const bound = (args) => ({
      first: async () => stmt.get(...args) ?? null,
      all: async () => ({ results: stmt.all(...args) }),
    });
    return { ...bound([]), bind: (...args) => bound(args) };
  },
};
const run = (sql, ...a) => db.prepare(sql).run(...a);
run(`INSERT INTO artists (id, name, slug, bio, image_url) VALUES (1, 'Ann Artist', 'ann-artist', 'Singer & songwriter <b>bio</b>.', 'https://example.com/ann.jpg'), (2, 'No Songs', 'no-songs', NULL, NULL)`);
run(`INSERT INTO composers (id, name, slug) VALUES (1, 'Cy Composer', 'cy-composer'), (2, 'Idle Composer', 'idle-composer')`);
run(`INSERT INTO copyright_owners (id, name, slug, organization, email) VALUES (1, 'Owner One', 'owner-one', 'Owner Org', 'private@example.com'), (2, 'Empty Owner', 'empty-owner', NULL, NULL)`);
run(`INSERT INTO songs (id, title, slug, category, lyrics, status, copyright_owner_id, updated_at) VALUES
  (1, 'Song <One> & Co', 'song-one', 'Gospel', 'Line one\\nLine two $& <script>x</script>', 'published', 1, '2026-09-01 10:00:00'),
  (2, 'Draft Song', 'draft-song', 'Love', 'secret', 'pending', 1, '2026-09-02 10:00:00')`);
run(`INSERT INTO song_artists (song_id, artist_id, position) VALUES (1, 1, 0), (2, 2, 0)`);
run(`INSERT INTO song_composers (song_id, composer_id, position) VALUES (1, 1, 0)`);
run(`INSERT INTO articles (id, title, slug, author_name, summary, content, status, published_at, created_at, updated_at) VALUES
  (1, 'Hello Article', 'hello-article', 'Pat Writer', 'A summary.', '<p>Body <strong>text</strong></p>', 'published', '2026-08-01 09:00:00', '2026-07-30 09:00:00', '2026-08-02 09:00:00'),
  (2, 'Unpublished', 'unpublished', 'X', NULL, '<p>x</p>', 'draft', NULL, '2026-08-03 09:00:00', '2026-08-03 09:00:00')`);

const ASSETS = { fetch: async (url) => new Response(fs.readFileSync(path.join(PUBLIC, new URL(url).pathname)), { headers: { 'Content-Type': 'text/html' } }) };
const load = (rel) => import(pathToFileURL(path.join(ROOT, 'functions', rel)).href);
const get = async (mod, pathname) => {
  const res = await mod.onRequest({ request: new Request(`${ORIGIN}${pathname}`), env: { DB: d1, ASSETS } });
  return { status: res.status, headers: res.headers, html: await res.text() };
};
const jsonLd = (html) => JSON.parse((html.match(/<script type="application\/ld\+json" id="jsonLd">\s*([\s\S]*?)\s*<\/script>/) || [])[1] || 'null');
const nodes = (ld) => (ld && ld['@graph']) || [];

const cases = [
  { mod: 'song/[[catchall]].js', ok: '/song/song-one', missing: '/song/nope', bare: '/song/', canonical: `${ORIGIN}/song/song-one`,
    expect: ['Song &lt;One&gt; &amp; Co', 'Line one\nLine two $&amp; &lt;script&gt;', 'href="/artist/ann-artist"', 'href="/composer/cy-composer"', 'href="/copyright-owner/owner-one"'], types: ['MusicRecording', 'BreadcrumbList'] },
  { mod: 'artist/[[catchall]].js', ok: '/artist/ann-artist', missing: '/artist/nope', bare: '/artist/', canonical: `${ORIGIN}/artist/ann-artist`,
    expect: ['Ann Artist', 'href="/song/song-one"', 'Singer &amp; songwriter &lt;b&gt;bio&lt;/b&gt;.'], types: ['MusicGroup', 'BreadcrumbList'], image: 'https://example.com/ann.jpg' },
  { mod: 'composer/[[catchall]].js', ok: '/composer/cy-composer', missing: '/composer/nope', bare: '/composer/', canonical: `${ORIGIN}/composer/cy-composer`,
    expect: ['Cy Composer', 'href="/song/song-one"'], types: ['Person', 'BreadcrumbList'] },
  { mod: 'copyright-owner/[[catchall]].js', ok: '/copyright-owner/owner-one', missing: '/copyright-owner/nope', bare: '/copyright-owner/', canonical: `${ORIGIN}/copyright-owner/owner-one`,
    expect: ['Owner One', 'href="/song/song-one"'], types: ['Organization', 'BreadcrumbList'], absent: ['private@example.com', 'draft-song'] },
  { mod: 'article/[[catchall]].js', ok: '/article/hello-article', missing: '/article/nope', bare: '/article/', canonical: `${ORIGIN}/article/hello-article`,
    expect: ['Hello Article', 'Pat Writer', '<p>Body <strong>text</strong></p>', 'A summary.'], types: ['Article', 'BreadcrumbList'] },
];

for (const c of cases) {
  const mod = await load(c.mod);
  const name = c.mod.split('/')[0];
  const page = await get(mod, c.ok);
  check(page.status === 200, `${name}: expected 200, got ${page.status}`);
  check(page.html.includes(`<link rel="canonical" id="canonicalUrl" href="${c.canonical}" />`), `${name}: canonical not ${c.canonical}`);
  check(!/name="robots"/.test(page.html), `${name}: a real page must not be noindex`);
  check(!/<title id="pageTitle">[^<]*(Song Lyrics – Mara Song \| MaraLyrics|Artist — MaraLyrics)<\/title>/.test(page.html), `${name}: placeholder <title> left in place`);
  for (const text of c.expect) check(page.html.includes(text), `${name}: rendered HTML missing ${JSON.stringify(text)}`);
  for (const text of c.absent || []) check(!page.html.includes(text), `${name}: HTML/JSON-LD must not contain ${JSON.stringify(text)}`);
  check(page.html.includes('style="display:none;">') ? !/id="(song|profile|article)Detail" style="display:none;"/.test(page.html) : true, `${name}: detail container still hidden`);
  let ld;
  try { ld = jsonLd(page.html); check(!!ld, `${name}: JSON-LD missing`); } catch (e) { fail(`${name}: JSON-LD invalid (${e.message})`); }
  const types = nodes(ld).map((n) => n['@type']);
  for (const t of c.types) check(types.includes(t), `${name}: JSON-LD lacks ${t}`);
  const crumbs = nodes(ld).find((n) => n['@type'] === 'BreadcrumbList');
  check(crumbs && crumbs.itemListElement.every((i, idx) => i.position === idx + 1 && i.name), `${name}: malformed BreadcrumbList`);
  if (c.image) check(page.html.includes(`property="og:image" id="ogImage" content="${c.image}"`), `${name}: og:image should use the entity image`);
  else check(page.html.includes(`id="ogImage" content="${ORIGIN}/og-image.png"`), `${name}: og:image should fall back to the brand image`);
  check(!/\$&|\$1/.test(page.html.replace('Line two $&amp;', '')), `${name}: replacement-pattern corruption`);

  for (const bad of [c.missing, c.bare]) {
    const nf = await get(mod, bad);
    check(nf.status === 404, `${name}: ${bad} should be 404, got ${nf.status}`);
    check(/name="robots" content="noindex, nofollow"/.test(nf.html) && nf.headers.get('X-Robots-Tag') === 'noindex', `${name}: ${bad} 404 must be noindex`);
    check(!/<link rel="canonical"/.test(nf.html), `${name}: ${bad} 404 must not carry a canonical`);
  }
}
// Unpublished/draft content must be invisible.
check((await get(await load('song/[[catchall]].js'), '/song/draft-song')).status === 404, 'song: pending song must 404');
check((await get(await load('article/[[catchall]].js'), '/article/unpublished')).status === 404, 'article: draft must 404');
check((await get(await load('song/[[catchall]].js'), '/song/%E0%A4%A')).status === 404, 'song: malformed % escape must 404, not crash');

section('sitemap.xml');
const sm = await load('sitemap.xml.js');
const smRes = await sm.onRequest({ env: { DB: d1 } });
const xml = await smRes.text();
check(smRes.status === 200 && /application\/xml/.test(smRes.headers.get('Content-Type')), 'sitemap: wrong status/content-type');
check(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>') && xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">') && xml.trim().endsWith('</urlset>'), 'sitemap: malformed envelope');
const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
check(new Set(locs).size === locs.length, 'sitemap: duplicate URLs');
check(locs.every((l) => l.startsWith(`${ORIGIN}/`) && !/[?#\s]/.test(l)), 'sitemap: every <loc> must be an absolute https URL without query/fragment');
check((xml.match(/<url>/g) || []).length === locs.length, 'sitemap: <url>/<loc> count mismatch');
check([...xml.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)].every((m) => /^\d{4}-\d{2}-\d{2}$/.test(m[1])), 'sitemap: bad <lastmod> format');
for (const want of ['/', '/about', '/articles', '/artists-composers', '/song/song-one', '/artist/ann-artist', '/composer/cy-composer', '/copyright-owner/owner-one', '/article/hello-article']) {
  check(locs.includes(`${ORIGIN}${want === '/' ? '/' : want}`), `sitemap: missing ${want}`);
}
for (const unwanted of ['/downloads', '/report', '/admin', '/song/draft-song', '/artist/no-songs', '/composer/idle-composer', '/copyright-owner/empty-owner', '/article/unpublished']) {
  check(!locs.some((l) => l.endsWith(unwanted) || l.includes(`${unwanted}/`)), `sitemap: must not list ${unwanted}`);
}
check(!/<changefreq>|<priority>/.test(xml), 'sitemap: changefreq/priority are ignored by Google; omitted by design');

console.log(`\n${failures ? '✗' : '✓'} ${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
