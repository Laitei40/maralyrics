export async function onRequest(context) {
  const url = new URL(context.request.url);
  url.pathname = '/copyright.html';
  return context.env.ASSETS.fetch(new Request(url.toString(), context.request));
}
