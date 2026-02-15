// Catch-all Pages Function for /composer/* routes
// Serves composerview.html while preserving the original URL (so JS can extract the slug)
export async function onRequest(context) {
  const url = new URL(context.request.url);
  url.pathname = '/composerview.html';
  return context.env.ASSETS.fetch(url);
}
