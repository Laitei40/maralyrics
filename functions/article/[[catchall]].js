function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildArticleSeo(article) {
  const title = `${article.title} | MaraLyrics`;
  const description = (article.summary || article.content || '').slice(0, 200);
  const url = `https://maralyrics.com/article/${article.slug}`;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    author: {
      '@type': 'Person',
      name: article.author_name,
    },
    datePublished: article.published_at || article.created_at,
    dateModified: article.updated_at || article.published_at || article.created_at,
    url,
    publisher: {
      '@type': 'Organization',
      name: 'MaraLyrics',
    },
  };

  return { title, description, url, schema };
}

async function fetchArticle(db, slug) {
  return db
    .prepare(`SELECT title, slug, author_name, summary, content, published_at, created_at, updated_at FROM articles WHERE slug = ? AND status = 'published'`)
    .bind(slug)
    .first();
}

// Catch-all Pages Function for /article/* routes.
export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const slug = requestUrl.pathname.replace(/^\/article\//, '').replace(/\/$/, '');

  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = '/articleview.html';
  const assetResponse = await context.env.ASSETS.fetch(assetUrl);

  if (!slug) return assetResponse;

  const article = await fetchArticle(context.env.DB, slug);
  if (!article) return assetResponse;

  const html = await assetResponse.text();
  const { title, description, url, schema } = buildArticleSeo(article);

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
