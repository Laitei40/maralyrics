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

function buildComposerSeo(composer, songCount) {
  const title = `${composer.name} — Mara Composer | MaraLyrics`;
  const countText = songCount === 1 ? '1 song' : `${songCount} songs`;
  const bio = composer.bio ? ` ${composer.bio}` : '';
  const description = `Explore ${countText} composed by ${composer.name} on MaraLyrics.${bio}`.trim().slice(0, 300);
  const url = `https://maralyrics.com/composer/${composer.slug}`;
  const sameAs = parseSocialLinks(composer.social_links);

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: composer.name,
    url,
    ...(composer.image_url ? { image: composer.image_url } : {}),
    ...(sameAs ? { sameAs } : {}),
  };

  return { title, description, url, schema };
}

async function fetchComposer(db, slug) {
  const composer = await db.prepare('SELECT * FROM composers WHERE slug = ?').bind(slug).first();
  if (!composer) return null;

  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM song_composers sc
       JOIN songs s ON s.id = sc.song_id
       WHERE sc.composer_id = ? AND s.status = 'published'`
    )
    .bind(composer.id)
    .first();

  return { composer, songCount: countRow.count };
}

// Catch-all Pages Function for /composer/* routes.
export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const slug = requestUrl.pathname.replace(/^\/composer\//, '').replace(/\/$/, '');

  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = '/composerview.html';
  const assetResponse = await context.env.ASSETS.fetch(assetUrl);

  if (!slug) return assetResponse;

  const result = await fetchComposer(context.env.DB, slug);
  if (!result) return assetResponse;

  const html = await assetResponse.text();
  const { title, description, url, schema } = buildComposerSeo(result.composer, result.songCount);

  const injected = html
    .replace(/<title id="pageTitle">[\s\S]*?<\/title>/, `<title id="pageTitle">${escapeHtml(title)}</title>`)
    .replace(/<meta name="description" id="metaDesc" content="[^"]*"\s*\/>/, `<meta name="description" id="metaDesc" content="${escapeHtml(description)}" />`)
    .replace(/<meta property="og:title" id="ogTitle" content="[^"]*"\s*\/>/, `<meta property="og:title" id="ogTitle" content="${escapeHtml(title)}" />`)
    .replace(/<meta property="og:description" id="ogDesc" content="[^"]*"\s*\/>/, `<meta property="og:description" id="ogDesc" content="${escapeHtml(description)}" />`)
    .replace(/<meta property="og:url" id="ogUrl" content="[^"]*"\s*\/>/, `<meta property="og:url" id="ogUrl" content="${escapeHtml(url)}" />`)
    .replace(/<meta name="twitter:title" id="twTitle" content="[^"]*"\s*\/>/, `<meta name="twitter:title" id="twTitle" content="${escapeHtml(title)}" />`)
    .replace(/<meta name="twitter:description" id="twDesc" content="[^"]*"\s*\/>/, `<meta name="twitter:description" id="twDesc" content="${escapeHtml(description)}" />`)
    .replace(/<link rel="canonical" id="canonicalUrl" href="[^"]*"\s*\/>/, `<link rel="canonical" id="canonicalUrl" href="${escapeHtml(url)}" />`)
    .replace(/<script type="application\/ld\+json" id="jsonLd">[\s\S]*?<\/script>/, `<script type="application/ld+json" id="jsonLd">\n${JSON.stringify(schema, null, 2)}\n</script>`);

  return new Response(injected, {
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
