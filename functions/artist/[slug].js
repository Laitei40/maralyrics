// Legacy /artist/:slug → canonical /artists/:slug (avoids broken zone redirects on some hosts).
export async function onRequest(context) {
  const u = new URL(context.request.url);
  const slug = (context.params.slug || '').replace(/\/+$/, '');
  u.pathname = slug ? `/artists/${slug}` : '/artists';
  return Response.redirect(u.toString(), 301);
}
