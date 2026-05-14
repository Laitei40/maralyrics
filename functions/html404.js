/** Shared static 404 response for Pages Functions (extensionless asset avoids *.html → /404 redirects). */
export async function html404Response(context) {
  const u = new URL(context.request.url);
  u.pathname = '/404/page';
  const r = await context.env.ASSETS.fetch(new Request(u.toString(), context.request));
  if (!r.ok) {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return new Response(r.body, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
