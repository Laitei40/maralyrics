/**
 * Single-path-segment routes not handled by a literal `*.js` file.
 * - Paths with a dot (e.g. /style.css) are passed through to static assets.
 * - Reserved first segments (song, artist, …) serve the SPA shell when there is no slug.
 * - Anything else (e.g. /abdbdbdb) returns the static 404 page with status 404.
 */
import { html404Response } from './html404.js';

function shellForSegment(seg) {
  if (seg === 'song') return '/songview.html';
  if (seg === 'artist') return '/artistview.html';
  if (seg === 'composer') return '/composerview.html';
  if (seg === 'copyright-owner') return '/copyrightownerview.html';
  return null;
}

export async function onRequest(context) {
  const seg = context.params.segment;
  if (!seg || seg.includes('.')) {
    return context.next();
  }

  const shell = shellForSegment(seg);
  if (shell) {
    const url = new URL(context.request.url);
    url.pathname = shell;
    return context.env.ASSETS.fetch(new Request(url.toString(), context.request));
  }

  return html404Response(context);
}
