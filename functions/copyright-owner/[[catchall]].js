function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildOwnerSeo(owner, songCount) {
  const title = `${owner.name} — Copyright Owner | MaraLyrics`;
  const countText = songCount === 1 ? '1 song' : `${songCount} songs`;
  const org = owner.organization ? ` (${owner.organization})` : '';
  const description = `${countText} claimed by ${owner.name}${org} on MaraLyrics.`.trim().slice(0, 300);
  const url = `https://maralyrics.com/copyright-owner/${owner.slug}`;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: owner.organization || owner.name,
    url,
    ...(owner.website ? { sameAs: [owner.website] } : {}),
    ...(owner.email ? { email: owner.email } : {}),
  };

  return { title, description, url, schema };
}

async function fetchOwner(db, slug) {
  const owner = await db.prepare('SELECT * FROM copyright_owners WHERE slug = ?').bind(slug).first();
  if (!owner) return null;

  const countRow = await db
    .prepare('SELECT COUNT(*) AS count FROM songs WHERE copyright_owner_id = ?')
    .bind(owner.id)
    .first();

  return { owner, songCount: countRow.count };
}

// Catch-all Pages Function for /copyright-owner/* routes.
export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const slug = requestUrl.pathname.replace(/^\/copyright-owner\//, '').replace(/\/$/, '');

  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = '/copyrightownerview.html';
  const assetResponse = await context.env.ASSETS.fetch(assetUrl);

  if (!slug) return assetResponse;

  const result = await fetchOwner(context.env.DB, slug);
  if (!result) return assetResponse;

  const html = await assetResponse.text();
  const { title, description, url, schema } = buildOwnerSeo(result.owner, result.songCount);

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
