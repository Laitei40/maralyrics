function formatDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return parsed.toISOString().slice(0, 10);
}

function urlEntry(loc, lastmod, changefreq, priority) {
  return `
  <url>
    <loc>${loc}</loc>
    <lastmod>${formatDate(lastmod)}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

const STATIC_PAGES = [
  { path: '/about', priority: '0.5' },
  { path: '/project', priority: '0.5' },
  { path: '/faq', priority: '0.5' },
  { path: '/privacy', priority: '0.3' },
  { path: '/terms', priority: '0.3' },
  { path: '/copyright', priority: '0.3' },
  { path: '/contact', priority: '0.4' },
];

export async function onRequest(context) {
  try {
    const db = context.env.DB;

    const [songs, artists, composers, copyrightOwners] = await Promise.all([
      db.prepare(`SELECT slug, COALESCE(updated_at, created_at) AS lastmod FROM songs WHERE slug IS NOT NULL AND status = 'published' ORDER BY id DESC`).all(),
      db.prepare(`SELECT slug, COALESCE(updated_at, created_at) AS lastmod FROM artists WHERE slug IS NOT NULL ORDER BY id DESC`).all(),
      db.prepare(`SELECT slug, COALESCE(updated_at, created_at) AS lastmod FROM composers WHERE slug IS NOT NULL ORDER BY id DESC`).all(),
      db.prepare(`SELECT slug, COALESCE(updated_at, created_at) AS lastmod FROM copyright_owners WHERE slug IS NOT NULL ORDER BY id DESC`).all(),
    ]);

    let urls = '';

    urls += urlEntry('https://maralyrics.com/', new Date(), 'daily', '1.0');

    for (const page of STATIC_PAGES) {
      urls += urlEntry(`https://maralyrics.com${page.path}`, new Date(), 'monthly', page.priority);
    }

    for (const song of songs.results || []) {
      urls += urlEntry(`https://maralyrics.com/song/${song.slug}`, song.lastmod, 'weekly', '0.8');
    }

    for (const artist of artists.results || []) {
      urls += urlEntry(`https://maralyrics.com/artist/${artist.slug}`, artist.lastmod, 'weekly', '0.6');
    }

    for (const composer of composers.results || []) {
      urls += urlEntry(`https://maralyrics.com/composer/${composer.slug}`, composer.lastmod, 'weekly', '0.6');
    }

    for (const owner of copyrightOwners.results || []) {
      urls += urlEntry(`https://maralyrics.com/copyright-owner/${owner.slug}`, owner.lastmod, 'monthly', '0.4');
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=UTF-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    return new Response(`Sitemap generation failed: ${error.message}`, { status: 500 });
  }
}
