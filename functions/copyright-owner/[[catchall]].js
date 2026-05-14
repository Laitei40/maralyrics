// /copyright-owner/* → SPA shell (slug read by client JS from the URL)
export async function onRequest(context) {
  const url = new URL(context.request.url);
  url.pathname = '/copyrightownerview.html';
  return context.env.ASSETS.fetch(new Request(url.toString(), context.request));
}
