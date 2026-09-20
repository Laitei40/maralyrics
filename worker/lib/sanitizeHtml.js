// Sanitizes rich-text HTML from the admin dashboard's article editor (a
// contenteditable div driven by document.execCommand) before it's stored.
// Uses the Workers runtime's built-in HTMLRewriter as a real HTML parser
// instead of hand-rolled regex, which is not a safe way to sanitize HTML.

const ALLOWED_TAGS = new Set([
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's',
  'ul', 'ol', 'li', 'a', 'blockquote', 'h2', 'h3',
]);

const ALLOWED_ATTRS = {
  a: ['href'],
};

// Tags whose text content must never surface in the output at all — unlike
// an ordinary disallowed tag (e.g. a pasted <div>), whose text is still
// legitimate article content once the wrapper is stripped.
const DROP_ENTIRELY = new Set(['script', 'style', 'noscript', 'template', 'head', 'title']);

const SAFE_HREF = /^(https?:|mailto:)/i;

export async function sanitizeArticleHtml(html) {
  if (!html) return '';

  const wrapped = `<html><body>${html}</body></html>`;
  const response = new Response(wrapped, { headers: { 'Content-Type': 'text/html' } });

  const rewritten = new HTMLRewriter()
    .on('*', {
      element(el) {
        const tag = el.tagName.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) {
          if (DROP_ENTIRELY.has(tag)) {
            // script/style content is raw text as far as the parser is
            // concerned — removeAndKeepContent() would surface it as
            // visible article text (e.g. "alert(1)"), so it must go
            // entirely rather than just losing its wrapper tag.
            el.remove();
          } else {
            // Drop the tag but keep its text/children, so e.g. a pasted
            // <span> or <div> from another site collapses into plain
            // inline content instead of disappearing along with what the
            // admin actually typed.
            el.removeAndKeepContent();
          }
          return;
        }

        const allowed = ALLOWED_ATTRS[tag] || [];
        for (const [name] of [...el.attributes]) {
          if (!allowed.includes(name)) el.removeAttribute(name);
        }

        if (tag === 'a') {
          const href = el.getAttribute('href') || '';
          if (!SAFE_HREF.test(href)) {
            el.removeAttribute('href');
          } else {
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
          }
        }
      },
    })
    .transform(response);

  // The wrapping <html>/<body> tags aren't in ALLOWED_TAGS either, so the
  // same element handler strips them via removeAndKeepContent() above —
  // the result is just the sanitized inner content, no extra unwrapping needed.
  return (await rewritten.text()).trim();
}

// True once the sanitized HTML has no visible text left (an editor that only
// contains e.g. <p><br></p> should be treated as empty).
export function isHtmlEmpty(html) {
  return !html.replace(/<[^>]*>/g, '').trim();
}
