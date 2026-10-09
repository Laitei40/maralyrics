import {
  injectSeoMeta, seoResponse, notFoundResponse, escapeHtml, setInner, revealDetail, unhide,
  breadcrumbSchema, schemaGraph, toIso, slugFromPath, SITE_ORIGIN,
} from '../_shared/seo.js';

// Content is sanitized rich-text HTML (see worker/lib/sanitizeHtml.js) —
// strip tags before using it as a plain-text meta description fallback.
function stripHtml(html = '') {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Title/description are kept byte-identical to ArticlePage.updateMeta in public/app.js.
function buildArticleSeo(article) {
  const title = `${article.title} | MaraLyrics`;
  const description = (article.summary || stripHtml(article.content)).slice(0, 200);
  const url = `${SITE_ORIGIN}/article/${encodeURIComponent(article.slug)}`;

  const node = {
    '@type': 'Article',
    '@id': `${url}#article`,
    headline: article.title,
    // Only credit an author the record actually names.
    ...(article.author_name ? { author: { '@type': 'Person', name: article.author_name } } : {}),
    ...(toIso(article.published_at || article.created_at) ? { datePublished: toIso(article.published_at || article.created_at) } : {}),
    ...(toIso(article.updated_at || article.published_at || article.created_at) ? { dateModified: toIso(article.updated_at || article.published_at || article.created_at) } : {}),
    mainEntityOfPage: url,
    url,
    publisher: { '@type': 'Organization', name: 'MaraLyrics', url: SITE_ORIGIN },
  };
  const crumbs = breadcrumbSchema([
    { name: 'Home', url: `${SITE_ORIGIN}/` },
    { name: 'Articles & News', url: `${SITE_ORIGIN}/articles` },
    { name: article.title },
  ]);

  return { title, description, url, schema: schemaGraph(node, crumbs) };
}

async function fetchArticle(db, slug) {
  return db
    .prepare(`SELECT title, slug, author_name, summary, content, published_at, created_at, updated_at FROM articles WHERE slug = ? AND status = 'published'`)
    .bind(slug)
    .first();
}

// Same "Sep 17, 2026" shape app.js shows (it re-formats in the visitor's language on load).
function displayDate(value) {
  const iso = toIso(value);
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
}

// Real content for crawlers that don't execute JS; app.js re-renders the same containers.
function renderArticlePage(html, article) {
  let out = html;
  out = revealDetail(out, { skeletonId: 'articleSkeleton', detailId: 'articleDetail' });
  out = setInner(out, 'articleTitle', escapeHtml(article.title));
  out = setInner(out, 'breadcrumbTitle', escapeHtml(article.title));
  out = setInner(out, 'articleAuthor', escapeHtml(article.author_name || ''));
  out = setInner(out, 'articleDate', escapeHtml(displayDate(article.published_at || article.created_at)));
  if (article.summary) {
    out = unhide(out, 'articleSummary');
    out = setInner(out, 'articleSummary', escapeHtml(article.summary));
  }
  // Already-sanitized rich text, inserted the same way app.js does (innerHTML).
  out = setInner(out, 'articleContent', article.content || '');
  return out;
}

// Catch-all Pages Function for /article/* routes.
export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const slug = slugFromPath(requestUrl.pathname, 'article');

  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = '/articleview.html';
  const assetResponse = await context.env.ASSETS.fetch(assetUrl);

  // "/article/" with no slug is not a page — a real 404, not a 200 empty shell.
  if (!slug) return notFoundResponse(assetResponse);

  const article = await fetchArticle(context.env.DB, slug);
  if (!article) return notFoundResponse(assetResponse);

  const html = await assetResponse.text();
  return seoResponse(injectSeoMeta(renderArticlePage(html, article), buildArticleSeo(article)));
}
