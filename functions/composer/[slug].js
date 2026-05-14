// Legacy /composer/:slug → canonical /arrangers/:slug
export async function onRequest(context) {
  const u = new URL(context.request.url);
  const slug = (context.params.slug || '').replace(/\/+$/, '');
  u.pathname = slug ? `/arrangers/${slug}` : '/arrangers';
  return Response.redirect(u.toString(), 301);
}
