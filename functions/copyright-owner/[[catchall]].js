// Catch-all Pages Function for /copyright-owner/* — serve SPA shell from ASSETS.
import { html404Response } from '../html404.js';

export async function onRequest(context) {
  try {
    const url = new URL(context.request.url);
    url.pathname = '/copyrightownerview.html';
    const res = await context.env.ASSETS.fetch(new Request(url.toString(), context.request));
    if (res.status >= 400 && res.status < 500) {
      return html404Response(context);
    }
    return res;
  } catch {
    return html404Response(context);
  }
}
