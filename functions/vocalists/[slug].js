// /vocalists/:slug → artist profile shell (slug in URL). Avoids *artist* / *artists* / *form* (in "perform…") zone matches.
export async function onRequest(context) {
  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = '/artistview.html';
  try {
    return await context.env.ASSETS.fetch(assetUrl);
  } catch {
    return new Response('Artist page unavailable', { status: 503 });
  }
}
