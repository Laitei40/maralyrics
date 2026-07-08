/**
 * Requires `Authorization: Bearer <token>` matching env.ADMIN_TOKEN.
 * Constant-time comparison to avoid leaking the token via timing.
 */
export async function requireAdmin(c, next) {
  const configured = c.env.ADMIN_TOKEN;
  if (!configured) {
    return c.json({ error: 'Admin API is not configured (ADMIN_TOKEN missing).' }, 500);
  }

  const header = c.req.header('Authorization') || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token || !timingSafeEqual(token, configured)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
}

function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.length !== bufB.length) return false;
  let result = 0;
  for (let i = 0; i < bufA.length; i++) result |= bufA[i] ^ bufB[i];
  return result === 0;
}
