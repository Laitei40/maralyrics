// Catch-all Pages Function for /copyright-owner/* routes
// Serves copyrightownerview.html while preserving the original URL (so JS can extract the slug)
export async function onRequest(context) {
  const url = new URL(context.request.url);
  url.pathname = '/copyrightownerview.html';
  return context.env.ASSETS.fetch(url);
}
