function formatDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return parsed.toISOString().slice(0, 10);
}

export async function onRequest(context) {

  try {

    const db = context.env.DB;

    // Query all songs from D1
    const query = await db.prepare(
      `SELECT slug, created_at AS lastmod
       FROM songs
       WHERE slug IS NOT NULL
       ORDER BY id DESC`
    ).all();

    const songs = query.results || [];

    let urls = "";

    for (const song of songs) {

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

  <!-- Homepage -->
  <url>
    <loc>https://maralyrics.com/</loc>
    <lastmod>${formatDate(new Date())}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>

  ${urls}

</urlset>`;

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=UTF-8",
        "Cache-Control": "public, max-age=300"
      }
    });

  } catch (error) {

    return new Response(
      `Sitemap generation failed: ${error.message}`,
      { status: 500 }
    );

  }
}