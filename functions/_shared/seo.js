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
export function injectSeoMeta(html, { title, description, url, schema }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const u = escapeHtml(url);
  const jsonLd = JSON.stringify(schema, null, 2).replace(/</g, '\\u003c');

  return html
    .replace(/<title id="pageTitle">[\s\S]*?<\/title>/, () => `<title id="pageTitle">${t}</title>`)
    .replace(/<meta name="description" id="metaDesc" content="[^"]*"\s*\/>/, () => `<meta name="description" id="metaDesc" content="${d}" />`)
    .replace(/<meta property="og:title" id="ogTitle" content="[^"]*"\s*\/>/, () => `<meta property="og:title" id="ogTitle" content="${t}" />`)
    .replace(/<meta property="og:description" id="ogDesc" content="[^"]*"\s*\/>/, () => `<meta property="og:description" id="ogDesc" content="${d}" />`)
    .replace(/<meta property="og:url" id="ogUrl" content="[^"]*"\s*\/>/, () => `<meta property="og:url" id="ogUrl" content="${u}" />`)
    .replace(/<meta name="twitter:title" id="twTitle" content="[^"]*"\s*\/>/, () => `<meta name="twitter:title" id="twTitle" content="${t}" />`)
    .replace(/<meta name="twitter:description" id="twDesc" content="[^"]*"\s*\/>/, () => `<meta name="twitter:description" id="twDesc" content="${d}" />`)
    .replace(/<link rel="canonical" id="canonicalUrl" href="[^"]*"\s*\/>/, () => `<link rel="canonical" id="canonicalUrl" href="${u}" />`)
    .replace(/<script type="application\/ld\+json" id="jsonLd">[\s\S]*?<\/script>/, () => `<script type="application/ld+json" id="jsonLd">\n${jsonLd}\n</script>`);
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
  const html = await assetResponse.text();
  return new Response(html, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
