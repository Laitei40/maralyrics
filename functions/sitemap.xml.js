export async function onRequest(context) {

  const db = context.env.DB;

  const songs = await db.prepare(
    "SELECT slug FROM songs"
  ).all();

  let urls = "";

  for (const song of songs.results) {
    urls += `
      <url>
        <loc>https://maralyrics.com/song/${song.slug}</loc>
        <changefreq>monthly</changefreq>
        <priority>0.7</priority>
      </url>`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">

    <url>
      <loc>https://maralyrics.com/</loc>
      <priority>1.0</priority>
    </url>

    ${urls}

  </urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml"
    }
  });
}
