/**
 * Fetch extensionless HTML shell from ASSETS and force text/html.
 * Avoids *.html / index.html redirect rules on the custom domain.
 */
export async function serveInfoPage(context, assetPath) {
  const url = new URL(context.request.url);
  url.pathname = assetPath;
  const res = await context.env.ASSETS.fetch(new Request(url.toString(), context.request));
  if (!res.ok) return res;
  const headers = new Headers(res.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
