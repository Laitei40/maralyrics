/** Shared static 404 response for Pages Functions. */
export async function html404Response(context) {
  const u = new URL(context.request.url);
  u.pathname = '/404.html';
  const r = await context.env.ASSETS.fetch(new Request(u.toString(), context.request));
  return new Response(r.body, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
