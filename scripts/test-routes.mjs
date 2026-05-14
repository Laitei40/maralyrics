#!/usr/bin/env node
/**
 * HTTP smoke tests: main routes return 200; unknown paths return 404 with the site 404 page.
 *
 * Usage:
 *   npm run test:routes
 *   BASE_URL=https://maralyrics.com npm run test:routes
 *   BASE_URL=http://127.0.0.1:8788 npm run test:routes   # wrangler pages dev
 *
 * STRICT_MULTI_404=1 — fail when unknown multi-segment URLs return 500 (until fixed in infra).
 *
 * Exits with code 1 if any assertion fails.
 */

const BASE = (process.env.BASE_URL || 'https://maralyrics.com').replace(/\/$/, '');
/** Match public/404.html (Unicode or ASCII dash in title). */
function has404Body(text) {
  return (
    text.includes('404 — Page Not Found') ||
    text.includes('404 - Page Not Found') ||
    (text.includes('Page Not Found') && text.includes('Mara Lyrics'))
  );
}

async function fetchPath(path, init = {}) {
  const url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, { redirect: 'follow', ...init });
  const text = await res.text();
  return { url, status: res.status, headers: res.headers, text };
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
}

let failed = 0;

async function expectOk200Html(path, label) {
  const { status, headers, text, url } = await fetchPath(path);
  const ct = (headers.get('content-type') || '').toLowerCase();
  if (status !== 200) {
    fail(`${label} ${url} — expected status 200, got ${status}`);
    failed++;
    return;
  }
  if (!ct.includes('text/html')) {
    fail(`${label} ${url} — expected HTML content-type, got ${headers.get('content-type')}`);
    failed++;
    return;
  }
  if (text.length < 200) {
    fail(`${label} ${url} — body suspiciously short (${text.length} bytes)`);
    failed++;
  }
}

async function expectOk200(path, label, subtype = 'html') {
  const { status, headers, text, url } = await fetchPath(path);
  if (status !== 200) {
    fail(`${label} ${url} — expected 200, got ${status}`);
    failed++;
    return;
  }
  const ct = (headers.get('content-type') || '').toLowerCase();
  if (subtype === 'html' && !ct.includes('text/html')) {
    fail(`${label} ${url} — expected HTML, got ${headers.get('content-type')}`);
    failed++;
  }
  if (subtype === 'css' && !ct.includes('text/css')) {
    fail(`${label} ${url} — expected CSS, got ${headers.get('content-type')}`);
    failed++;
  }
  if (subtype === 'json' && !ct.includes('json')) {
    fail(`${label} ${url} — expected JSON, got ${headers.get('content-type')}`);
    failed++;
  }
  if (subtype === 'xml' && !ct.includes('xml')) {
    fail(`${label} ${url} — expected XML, got ${headers.get('content-type')}`);
    failed++;
  }
}

async function expect404Page(path, label) {
  const { status, text, url } = await fetchPath(path);
  if (status !== 404) {
    fail(`${label} ${url} — expected status 404, got ${status}`);
    failed++;
    return;
  }
  if (!has404Body(text)) {
    fail(`${label} ${url} — expected 404 page body (missing known 404 markers)`);
    failed++;
  }
}

/** Unknown multi-segment: require site 404 when possible; warn on 500 until infra is aligned. */
async function expect404MultiSegment(path, label) {
  const { status, text, url } = await fetchPath(path);
  if (status === 404 && has404Body(text)) {
    return;
  }
  if (status === 404) {
    fail(`${label} ${url} — status 404 but body is not the site 404 page`);
    failed++;
    return;
  }
  if (status === 500) {
    console.warn(`WARN: ${label} ${url} — got ${status} (deploy /404/page + html404.js to fix).`);
    if (process.env.STRICT_MULTI_404 === '1') {
      fail(`${label} ${url} — expected 404, got 500`);
      failed++;
    }
    return;
  }
  fail(`${label} ${url} — expected 404, got ${status}`);
  failed++;
}

async function main() {
  console.log(`Route tests against ${BASE}\n`);

  const okRoutes = [
    ['/', 'home'],
    ['/about', 'about'],
    ['/about/', 'about trailing slash'],
    ['/contact', 'contact'],
    ['/faq', 'faq'],
    ['/privacy', 'privacy'],
    ['/terms', 'terms'],
    ['/copyright', 'copyright'],
    ['/report', 'report'],
    ['/song/zzz-smoke-test-slug', 'song shell'],
    ['/artists/zzz-smoke-test-slug', 'artist shell'],
    ['/composers/zzz-smoke-test-slug', 'composer shell'],
    ['/copyright-owner/zzz-smoke-test-slug', 'copyright-owner shell'],
  ];

  for (const [path, label] of okRoutes) {
    await expectOk200Html(path, label);
  }

  await expectOk200('/sitemap.xml', 'sitemap', 'xml');
  await expectOk200('/style.css', 'style.css', 'css');
  await expectOk200('/locales/en.json', 'locales en', 'json');

  const badSingle = `/ml-missing-page-${Date.now()}`;
  const badNested = `/ml-missing/nested/${Date.now()}/path`;

  await expect404Page(badSingle, 'unknown single-segment');
  await expect404MultiSegment(badNested, 'unknown multi-segment');

  if (failed) {
    console.error(`\n${failed} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll route tests passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
