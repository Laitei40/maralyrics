function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSongSeo(song) {
  const title = `${song.title} Lyrics – Mara Song | MaraLyrics`;
  const artist = song.artist_name || 'Unknown Artist';
  const description = `Read the full lyrics of ${song.title}, a Mara song by ${artist}. Discover Mara music on MaraLyrics.`;
  const url = `https://maralyrics.com/song/${song.slug}`;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'MusicRecording',
    name: song.title,
    byArtist: {
      '@type': 'MusicGroup',
      name: artist,
    },
    inLanguage: 'mrh',
    url,
    publisher: {
      '@type': 'Organization',
      name: 'MaraLyrics',
    },
  };

  return { title, description, url, schema };
}

async function fetchSong(db, slug) {
  return db
    .prepare(
      `SELECT s.title, s.slug,
         (SELECT GROUP_CONCAT(name, ', ') FROM (
            SELECT a.name AS name FROM song_artists sa JOIN artists a ON a.id = sa.artist_id
            WHERE sa.song_id = s.id ORDER BY sa.position
          )) AS artist_name
       FROM songs s
       WHERE s.slug = ? AND s.status = 'published'`
    )
    .bind(slug)
    .first();
}

// Catch-all Pages Function for /song/* routes.
export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const slug = requestUrl.pathname.replace(/^\/song\//, '').replace(/\/$/, '');

  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = '/songview.html';
  const assetResponse = await context.env.ASSETS.fetch(assetUrl);

  if (!slug) return assetResponse;

  const song = await fetchSong(context.env.DB, slug);
  if (!song) return assetResponse;

  const html = await assetResponse.text();
  const { title, description, url, schema } = buildSongSeo(song);

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
