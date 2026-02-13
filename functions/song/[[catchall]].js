// Catch-all Pages Function for /song/* routes
// Serves songview.html while preserving the original URL (so JS can extract the slug)
export async function onRequest(context) {
  const url = new URL(context.request.url);
  url.pathname = '/songview.html';
  return context.env.ASSETS.fetch(url);
}
