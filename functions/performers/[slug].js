// /performers/:slug → /vocalists/:slug (short-lived canonical; "performers" contains "form" and may hit zone rules).
export async function onRequest(context) {
  const u = new URL(context.request.url);
  const slug = (context.params.slug || '').replace(/\/+$/, '');
  u.pathname = slug ? `/vocalists/${slug}` : '/vocalists';
  return Response.redirect(u.toString(), 301);
}
