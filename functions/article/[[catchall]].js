import { injectSeoMeta, seoResponse, notFoundResponse } from '../_shared/seo.js';

// Content is sanitized rich-text HTML (see worker/lib/sanitizeHtml.js) —
// strip tags before using it as a plain-text meta description fallback.
function stripHtml(html = '') {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildArticleSeo(article) {
  const title = `${article.title} | MaraLyrics`;
  const description = (article.summary || stripHtml(article.content)).slice(0, 200);
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
  if (!article) return notFoundResponse(assetResponse);

  const html = await assetResponse.text();
  const seo = buildArticleSeo(article);
  return seoResponse(injectSeoMeta(html, seo));
}
