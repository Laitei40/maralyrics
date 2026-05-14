// Catch-all Pages Function for /artist/* routes
// Serves artistview.html while preserving the original URL (so JS can extract the slug)
export async function onRequest(context) {
  const url = new URL(context.request.url);
  url.pathname = '/artistview.html';
  return context.env.ASSETS.fetch(url);
}
