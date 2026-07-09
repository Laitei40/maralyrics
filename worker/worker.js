import { Hono } from 'hono';
import { cors } from 'hono/cors';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';
import { requireAuth } from './lib/auth.js';

const BLOCKED_COUNTRIES = new Set(['CN', 'RU', 'KP', 'IR']);

const app = new Hono();

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use('*', async (c, next) => {
  const country = c.req.raw.cf?.country;
  if (country && BLOCKED_COUNTRIES.has(country)) {
    return c.json({ success: false, error: 'Access denied' }, 403);
  }
  await next();
});

app.use('/api/v1/admin/*', async (c, next) => {
  if (c.req.path === '/api/v1/admin/auth/login') return next(); // public: no session yet
  return requireAuth(c, next);
});

app.route('/api/v1', publicRoutes);
app.route('/api/v1/admin', adminRoutes);

app.notFound((c) => c.json({ error: 'Not Found' }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ success: false, error: err.message || 'Internal error' }, 500);
});

export default app;
