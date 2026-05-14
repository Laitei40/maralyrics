// /composers/:slug → SPA shell (slug read by client JS from the URL)
export async function onRequest(context) {
  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = '/composerview.html';
  return context.env.ASSETS.fetch(assetUrl);
}
