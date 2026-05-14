// /arrangers/:slug → composer profile shell (slug in URL). Avoids *composer* / *composers* zone matches.
export async function onRequest(context) {
  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = '/composerview.html';
  try {
    return await context.env.ASSETS.fetch(assetUrl);
  } catch {
    return new Response('Composer page unavailable', { status: 503 });
  }
}
