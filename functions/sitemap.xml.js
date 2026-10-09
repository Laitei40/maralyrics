import { SITE_ORIGIN, escapeHtml, toIso } from './_shared/seo.js';

// Only canonical, indexable URLs belong here. Left out on purpose: /downloads (per-device
// content, noindex), /report (a form, noindex), /admin/* (private), and any person/owner page
// with no published song (a thin page with nothing to rank for). Mara Idol seasons are listed
// only once published, together with their contestants.
//
// <lastmod> is only emitted when we know a real date; a "today" stamp on every request teaches
// Google to ignore the field. <changefreq>/<priority> are omitted: Google ignores both.

const STATIC_PAGES = [
  '/about', '/project', '/faq', '/privacy', '/terms', '/copyright', '/contact',
  '/articles', '/artists-composers',
];

// Sitemap protocol limit per file; past it a sitemap index is needed (see SEO.md).
const MAX_URLS = 50000;

function urlEntry(path, lastmod) {
  const loc = escapeHtml(`${SITE_ORIGIN}${path}`);
  const mod = toIso(lastmod);
  return `  <url>\n    <loc>${loc}</loc>${mod ? `\n    <lastmod>${mod.slice(0, 10)}</lastmod>` : ''}\n  </url>`;
}

const slugPath = (prefix, slug) => `/${prefix}/${encodeURIComponent(slug)}`;

export async function buildSitemap(db) {
  const [songs, artists, composers, owners, articles, idolSeasons, idols] = await Promise.all([
    db.prepare(`SELECT slug, COALESCE(updated_at, created_at) AS lastmod FROM songs WHERE slug IS NOT NULL AND slug != '' AND status = 'published' ORDER BY id DESC`).all(),
    db.prepare(
      `SELECT a.slug AS slug, COALESCE(a.updated_at, a.created_at) AS lastmod FROM artists a
       WHERE a.slug IS NOT NULL AND a.slug != ''
         AND EXISTS (SELECT 1 FROM song_artists sa JOIN songs s ON s.id = sa.song_id WHERE sa.artist_id = a.id AND s.status = 'published')
       ORDER BY a.id DESC`
    ).all(),
    db.prepare(
      `SELECT c.slug AS slug, COALESCE(c.updated_at, c.created_at) AS lastmod FROM composers c
       WHERE c.slug IS NOT NULL AND c.slug != ''
         AND EXISTS (SELECT 1 FROM song_composers sc JOIN songs s ON s.id = sc.song_id WHERE sc.composer_id = c.id AND s.status = 'published')
       ORDER BY c.id DESC`
    ).all(),
    db.prepare(
      `SELECT o.slug AS slug, COALESCE(o.updated_at, o.created_at) AS lastmod FROM copyright_owners o
       WHERE o.slug IS NOT NULL AND o.slug != ''
         AND EXISTS (SELECT 1 FROM songs s WHERE s.copyright_owner_id = o.id AND s.status = 'published')
       ORDER BY o.id DESC`
    ).all(),
    db.prepare(`SELECT slug, COALESCE(updated_at, published_at, created_at) AS lastmod FROM articles WHERE slug IS NOT NULL AND slug != '' AND status = 'published' ORDER BY id DESC`).all(),
    // Mara Idol: published seasons and their contestants only (drafts never reach the sitemap)
    db.prepare(`SELECT slug, COALESCE(updated_at, created_at) AS lastmod FROM idol_seasons WHERE slug != '' AND status = 'published' ORDER BY year DESC, id DESC`).all(),
    db.prepare(
      `SELECT s.slug AS season_slug, c.slug AS slug, COALESCE(c.updated_at, c.created_at) AS lastmod
       FROM idol_contestants c JOIN idol_seasons s ON s.id = c.season_id AND s.status = 'published'
       WHERE c.slug != '' ORDER BY s.year DESC, s.id DESC, c.sort_order, c.id`
    ).all(),
  ]);

  const rows = (r) => r.results || [];
  const newest = (list) => list.map((r) => toIso(r.lastmod)).filter(Boolean).sort().pop();

  // The home page and listing pages change whenever their content does, so use the newest
  // matching record rather than the request time.
  const entries = [
    urlEntry('/', newest([...rows(songs), ...rows(articles)])),
    urlEntry('/mara-idol', newest([...rows(idolSeasons), ...rows(idols)])),
    ...STATIC_PAGES.map((p) => urlEntry(p, p === '/articles' ? newest(rows(articles)) : p === '/artists-composers' ? newest([...rows(artists), ...rows(composers)]) : null)),
    ...rows(songs).map((r) => urlEntry(slugPath('song', r.slug), r.lastmod)),
    ...rows(artists).map((r) => urlEntry(slugPath('artist', r.slug), r.lastmod)),
    ...rows(composers).map((r) => urlEntry(slugPath('composer', r.slug), r.lastmod)),
    ...rows(owners).map((r) => urlEntry(slugPath('copyright-owner', r.slug), r.lastmod)),
    ...rows(articles).map((r) => urlEntry(slugPath('article', r.slug), r.lastmod)),
    ...rows(idolSeasons).map((r) => urlEntry(slugPath('mara-idol', r.slug), r.lastmod)),
    ...rows(idols).map((r) => urlEntry(`/mara-idol/${encodeURIComponent(r.season_slug)}/${encodeURIComponent(r.slug)}`, r.lastmod)),
  ];

  if (entries.length > MAX_URLS) console.warn(`sitemap has ${entries.length} URLs — over the ${MAX_URLS} limit; split into a sitemap index`);

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.slice(0, MAX_URLS).join('\n')}\n</urlset>\n`;
}

export async function onRequest(context) {
  try {
    const xml = await buildSitemap(context.env.DB);
    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=UTF-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    // Don't leak internals (DB errors) to the public; details go to the function log.
    console.error('Sitemap generation failed:', error);
    return new Response('Sitemap temporarily unavailable', { status: 503, headers: { 'Retry-After': '300' } });
  }
}
