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
  const artist = song.artist_name || song.artist || 'Unknown Artist';
  const description = `Read the full lyrics of ${song.title}, a Mara song by ${artist}. Discover Mara music on MaraLyrics.`;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'MusicRecording',
    name: song.title,
    byArtist: {
      '@type': 'MusicGroup',
      name: artist,
    },
    inLanguage: 'mrh',
    url: `https://maralyrics.com/song/${song.slug}`,
    publisher: {
      '@type': 'Organization',
      name: 'MaraLyrics',
    },
  };

  return { title, description, schema };
}

async function fetchSong(db, slug) {
  return db
    .prepare(
      `SELECT s.title, s.slug, a.name AS artist_name
       FROM songs s
       LEFT JOIN artists a ON s.artist_id = a.id
       WHERE s.slug = ?`
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
  let assetResponse;
  try {
    assetResponse = await context.env.ASSETS.fetch(assetUrl);
  } catch {
    return new Response('Song page unavailable', { status: 503 });
  }

  if (!slug) return assetResponse;

  const db = context.env.DB;
  if (!db) {
    return assetResponse;
  }

  let song;
  try {
    song = await fetchSong(db, slug);
  } catch {
    return assetResponse;
  }
  if (!song) return assetResponse;

  let html;
  try {
    html = await assetResponse.text();
  } catch {
    return assetResponse;
  }

  let injected;
  try {
    const { title, description, schema } = buildSongSeo(song);
    injected = html
      .replace(/<title id="pageTitle">[\s\S]*?<\/title>/, `<title id="pageTitle">${escapeHtml(title)}</title>`)
      .replace(/<meta name="description" id="metaDesc" content="[^"]*"\s*\/>/, `<meta name="description" id="metaDesc" content="${escapeHtml(description)}" />`)
      .replace(/<meta property="og:title" id="ogTitle" content="[^"]*"\s*\/>/, `<meta property="og:title" id="ogTitle" content="${escapeHtml(title)}" />`)
      .replace(/<meta property="og:description" id="ogDesc" content="[^"]*"\s*\/>/, `<meta property="og:description" id="ogDesc" content="${escapeHtml(description)}" />`)
      .replace(/<script type="application\/ld\+json" id="jsonLd">[\s\S]*?<\/script>/, `<script type="application/ld+json" id="jsonLd">\n${JSON.stringify(schema, null, 2)}\n</script>`);
  } catch {
    return assetResponse;
  }

  return new Response(injected, {
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
