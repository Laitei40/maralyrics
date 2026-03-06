function formatDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

export async function onRequest(context) {
  const db = context.env.DB;

  const songs = await db.prepare(
    'SELECT slug, COALESCE(updated_at, created_at) AS lastmod FROM songs WHERE slug IS NOT NULL ORDER BY id DESC'
  ).all();

  let urls = '';

  for (const song of songs.results || []) {
    urls += `
      <url>
        <loc>https://maralyrics.com/song/${song.slug}</loc>
        <lastmod>${formatDate(song.lastmod)}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.7</priority>
      </url>`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">

    <url>
      <loc>https://maralyrics.com/</loc>
      <lastmod>${formatDate(new Date())}</lastmod>
      <priority>1.0</priority>
    </url>

    ${urls}

  </urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=UTF-8',
      'Cache-Control': 'public, max-age=300',
    }
  });
}
