// Shared by every functions/*/[[catchall]].js SSR meta-tag injector (song, artist,
// composer, copyright-owner, article). Each of those still owns its own entity-specific
// fetch/build-SEO logic; only the "inject into the static shell" and "not found" mechanics
// live here, since those were previously copy-pasted five times and had drifted (see
// injectSeoMeta's comment for the bug that drift produced).

// Same allowlist as worker/lib/sanitizeHtml.js's SAFE_HREF / public/app.js's
// Utils.isSafeUrl — used here to keep a pre-existing bad row (saved before the
// server-side write-time check existed) out of the SSR'd sameAs/JSON-LD, even
// though it's inert JSON text rather than a clickable link.
export function isSafeUrl(url) {
  return /^(https?:|mailto:)/i.test(String(url || '').trim());
}

export const SITE_ORIGIN = 'https://maralyrics.com';
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-image.png`;

export function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Replaces each placeholder meta tag in `html` with the real title/description/url/schema.
// Every .replace() uses a replacer FUNCTION rather than a plain template-string replacement
// argument: String.replace treats $&, $`, $', and $1-$9 specially in a replacement STRING,
// so a title/description containing one of those sequences (e.g. a literal "$&") would
// corrupt the injected tag — and potentially the tags chained after it — if passed as a
// plain string instead of through a function, which the runtime never re-parses for `$`.
export function injectSeoMeta(html, { title, description, url, schema, image }) {
  const t = escapeHtml(title);
  // Only https images are used for social cards (a stored http/relative/data: URL would
  // be ignored or mixed-content); everything else falls back to the site's brand image.
  const img = escapeHtml(image && /^https:\/\//i.test(image) ? image : DEFAULT_OG_IMAGE);
  const d = escapeHtml(description);
  const u = escapeHtml(url);
  const jsonLd = JSON.stringify(schema, null, 2).replace(/</g, '\\u003c');

  return html
    // The bare shell is noindex; a rendered, real page must not inherit that.
    .replace(/<meta name="robots" content="noindex, follow" \/>\s*/, () => '')
    .replace(/<title id="pageTitle">[\s\S]*?<\/title>/, () => `<title id="pageTitle">${t}</title>`)
    .replace(/<meta name="description" id="metaDesc" content="[^"]*"\s*\/>/, () => `<meta name="description" id="metaDesc" content="${d}" />`)
    .replace(/<meta property="og:title" id="ogTitle" content="[^"]*"\s*\/>/, () => `<meta property="og:title" id="ogTitle" content="${t}" />`)
    .replace(/<meta property="og:description" id="ogDesc" content="[^"]*"\s*\/>/, () => `<meta property="og:description" id="ogDesc" content="${d}" />`)
    .replace(/<meta property="og:url" id="ogUrl" content="[^"]*"\s*\/>/, () => `<meta property="og:url" id="ogUrl" content="${u}" />`)
    .replace(/<meta name="twitter:title" id="twTitle" content="[^"]*"\s*\/>/, () => `<meta name="twitter:title" id="twTitle" content="${t}" />`)
    .replace(/<meta name="twitter:description" id="twDesc" content="[^"]*"\s*\/>/, () => `<meta name="twitter:description" id="twDesc" content="${d}" />`)
    .replace(/<meta property="og:image" id="ogImage" content="[^"]*"\s*\/>/, () => `<meta property="og:image" id="ogImage" content="${img}" />`)
    .replace(/<meta name="twitter:image" id="twImage" content="[^"]*"\s*\/>/, () => `<meta name="twitter:image" id="twImage" content="${img}" />`)
    .replace(/<link rel="canonical" id="canonicalUrl" href="[^"]*"\s*\/>/, () => `<link rel="canonical" id="canonicalUrl" href="${u}" />`)
    .replace(/<script type="application\/ld\+json" id="jsonLd">[\s\S]*?<\/script>/, () => `<script type="application/ld+json" id="jsonLd">\n${jsonLd}\n</script>`);
}


// ─── Server-rendered page content ────────────────────────────────────────────
// The view shells (songview.html etc.) are empty containers that app.js fills after an API
// call. Crawlers that don't run JavaScript (and social/link-preview bots) would otherwise see
// an empty page, so each function fills the same containers with the real content. app.js
// re-renders them as soon as it loads, so nothing changes for visitors beyond skipping the
// skeleton. Elements are matched by id; if a shell ever drops an id the helper is a no-op.

/** Slug from a request path like "/song/foo/" → "foo"; null for empty/malformed input. */
export function slugFromPath(pathname, prefix) {
  const raw = pathname.replace(new RegExp(`^/${prefix}/`), '').replace(/\/$/, '');
  if (!raw) return null;
  try { return decodeURIComponent(raw); } catch { return null; }
}

/** Replace the inner HTML of the simple (non-nested) element with the given id. */
export function setInner(html, id, inner) {
  const re = new RegExp(`(<([a-zA-Z0-9]+)\\b[^>]*\\bid="${id}"[^>]*>)[\\s\\S]*?(</\\2>)`);
  return html.replace(re, (_m, open, _tag, close) => `${open}${inner}${close}`);
}

/** Hide the loading skeleton and show the (otherwise `display:none`) detail container. */
export function revealDetail(html, { skeletonId, detailId }) {
  return html
    .replace(new RegExp(`<div id="${skeletonId}">`), () => `<div id="${skeletonId}" style="display:none;">`)
    .replace(new RegExp(`(<div id="${detailId}") style="display:none;"`), (_m, open) => open);
}

/** Show an element that the shell hides inline (e.g. an optional bio paragraph). */
export function unhide(html, id) {
  return html.replace(new RegExp(`(<[a-zA-Z0-9]+\\b[^>]*\\bid="${id}"[^>]*?) style="display:none;"`), (_m, open) => open);
}

/** `<a>` links to credited people, joined with commas. */
export function personLinks(people, type) {
  return (people || [])
    .filter((p) => p && p.slug && p.name)
    .map((p) => `<a href="/${type}/${encodeURIComponent(p.slug)}" class="meta-link">${escapeHtml(p.name)}</a>`)
    .join(', ');
}

/** Plain list of links to songs, inside the profile pages' song container. */
export function songLinkList(songs, limit = 200) {
  const items = (songs || []).slice(0, limit)
    .map((s) => `<li><a href="/song/${encodeURIComponent(s.slug)}">${escapeHtml(s.title)}</a></li>`)
    .join('');
  return items ? `<ul class="seo-song-list">${items}</ul>` : '';
}

/** Lyrics as stored may contain literal "\\n" sequences — same normalisation as app.js. */
export function cleanLyrics(text = '') {
  return String(text).replace(/\\n/g, '\n');
}

/** D1 DATETIME ('YYYY-MM-DD HH:MM:SS', UTC) → ISO 8601 for schema.org; undefined if unusable. */
export function toIso(value) {
  if (!value) return undefined;
  let iso = String(value).trim();
  if (iso.includes(' ') && !iso.includes('T')) iso = iso.replace(' ', 'T');
  if (!/[Zz]|[+-]\d{2}:\d{2}$/.test(iso)) iso += 'Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** schema.org BreadcrumbList from [{ name, url }] — last item may omit `url`. */
export function breadcrumbSchema(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      ...(item.url ? { item: item.url } : {}),
    })),
  };
}

/** Combine several schema.org nodes into one JSON-LD document. */
export function schemaGraph(...nodes) {
  return { '@context': 'https://schema.org', '@graph': nodes.filter(Boolean) };
}

export function seoResponse(html) {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

// A slug was given but the DB lookup for it came back empty — returned as a real 404
// (not the 200 a bare asset fetch would give) so crawlers correctly treat a dead or
// mistyped slug as not indexed instead of a soft-404. `assetResponse` is the already-
// fetched static view shell; reused as-is for its generic placeholder meta tags.
export async function notFoundResponse(assetResponse) {
  // The shell carries a generic canonical (e.g. /song/) and indexable robots default. A
  // 404 must not advertise either: drop the canonical and add noindex, in addition to the
  // 404 status itself, so a stale or mistyped slug can never be indexed as a page.
  const html = (await assetResponse.text())
    .replace(/<link rel="canonical"[^>]*>\s*/, '')
    .replace(/<meta name="robots"[^>]*>\s*/, '')
    .replace('</head>', '  <meta name="robots" content="noindex, nofollow" />\n</head>');
  return new Response(html, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=300',
      'X-Robots-Tag': 'noindex',
    },
  });
}
