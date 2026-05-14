/**
 * Turn platform 404/500 on unknown multi-segment paths into the static 404 page.
 * Does not alter responses for reserved first segments (song, artist, composer, …).
 */
import { html404Response } from './html404.js';

const RESERVED_TOP = new Set([
  'song',
  'artist',
  'composer',
  'copyright-owner',
  'about',
  'contact',
  'faq',
  'privacy',
  'terms',
  'copyright',
  'report',
  'admin',
  'locales',
]);

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    const res = await context.next();
    if (res.status !== 500 && res.status !== 404) {
      return res;
    }
    if (parts.length < 2) {
      return res;
    }
    const last = parts[parts.length - 1];
    if (last.includes('.')) {
      return res;
    }
    if (RESERVED_TOP.has(parts[0])) {
      return res;
    }
    return html404Response(context);
  } catch (e) {
    if (
      parts.length >= 2 &&
      !(parts[parts.length - 1] || '').includes('.') &&
      !RESERVED_TOP.has(parts[0])
    ) {
      return html404Response(context);
    }
    throw e;
  }
}
