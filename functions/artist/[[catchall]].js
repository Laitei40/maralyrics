function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseSocialLinks(raw) {
  if (!raw) return undefined;
  try {
    const links = JSON.parse(raw);
    return Array.isArray(links) && links.length ? links : undefined;
  } catch {
    return undefined;
  }
}

function buildArtistSeo(artist, songCount) {
  const title = `${artist.name} — Mara Artist Lyrics & Songs | MaraLyrics`;
  const countText = songCount === 1 ? '1 song' : `${songCount} songs`;
  const bio = artist.bio ? ` ${artist.bio}` : '';
  const description = `Explore ${countText} by ${artist.name} on MaraLyrics.${bio}`.trim().slice(0, 300);
  const url = `https://maralyrics.com/artist/${artist.slug}`;
  const sameAs = parseSocialLinks(artist.social_links);

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'MusicGroup',
    name: artist.name,
    url,
    ...(artist.image_url ? { image: artist.image_url } : {}),
    ...(sameAs ? { sameAs } : {}),
  };

  return { title, description, url, schema };
}

async function fetchArtist(db, slug) {
  const artist = await db.prepare('SELECT * FROM artists WHERE slug = ?').bind(slug).first();
  if (!artist) return null;

  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM song_artists sa
       JOIN songs s ON s.id = sa.song_id
       WHERE sa.artist_id = ? AND s.status = 'published'`
    )
    .bind(artist.id)
    .first();

  return { artist, songCount: countRow.count };
}

// Catch-all Pages Function for /artist/* routes.
export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const slug = requestUrl.pathname.replace(/^\/artist\//, '').replace(/\/$/, '');

  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = '/artistview.html';
  const assetResponse = await context.env.ASSETS.fetch(assetUrl);

  if (!slug) return assetResponse;

  const result = await fetchArtist(context.env.DB, slug);
  if (!result) return assetResponse;

  const html = await assetResponse.text();
  const { title, description, url, schema } = buildArtistSeo(result.artist, result.songCount);

  const injected = html
    .replace(/<title id="pageTitle">[\s\S]*?<\/title>/, `<title id="pageTitle">${escapeHtml(title)}</title>`)
    .replace(/<meta name="description" id="metaDesc" content="[^"]*"\s*\/>/, `<meta name="description" id="metaDesc" content="${escapeHtml(description)}" />`)
    .replace(/<meta property="og:title" id="ogTitle" content="[^"]*"\s*\/>/, `<meta property="og:title" id="ogTitle" content="${escapeHtml(title)}" />`)
    .replace(/<meta property="og:description" id="ogDesc" content="[^"]*"\s*\/>/, `<meta property="og:description" id="ogDesc" content="${escapeHtml(description)}" />`)
    .replace(/<meta property="og:url" id="ogUrl" content="[^"]*"\s*\/>/, `<meta property="og:url" id="ogUrl" content="${escapeHtml(url)}" />`)
    .replace(/<meta name="twitter:title" id="twTitle" content="[^"]*"\s*\/>/, `<meta name="twitter:title" id="twTitle" content="${escapeHtml(title)}" />`)
    .replace(/<meta name="twitter:description" id="twDesc" content="[^"]*"\s*\/>/, `<meta name="twitter:description" id="twDesc" content="${escapeHtml(description)}" />`)
    .replace(/<link rel="canonical" id="canonicalUrl" href="[^"]*"\s*\/>/, `<link rel="canonical" id="canonicalUrl" href="${escapeHtml(url)}" />`)
    .replace(/<script type="application\/ld\+json" id="jsonLd">[\s\S]*?<\/script>/, `<script type="application/ld+json" id="jsonLd">\n${JSON.stringify(schema, null, 2).replace(/</g, '\\u003c')}\n</script>`);

  return new Response(injected, {
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
