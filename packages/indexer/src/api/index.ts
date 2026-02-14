/**
 * Hono API router
 *
 * Fix applied:
 * - #12 Rate limiting middleware on heavy endpoints
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { timing } from 'hono/timing';
import { prettyJSON } from 'hono/pretty-json';

import { marketsRouter } from './routes/markets';
import { eventsRouter } from './routes/events';
import { statsRouter } from './routes/stats';
import { healthRouter } from './routes/health';
import { categoriesRouter } from './routes/categories';
import { internalRouter } from './routes/internal';
import { getLogger } from '../lib/logger';
import { getConfig } from '../lib/config';
import { rateLimit } from './middleware/rateLimit';

export type AppEnv = Record<string, never>;

const app = new Hono<AppEnv>();
const config = getConfig();

// Middleware
app.use('*', cors({
  origin: config.corsOrigins,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.use('*', timing());
app.use('*', prettyJSON());
app.use('*', honoLogger());

// Rate limit on heavy endpoints (#12)
const rl = rateLimit({
  max: config.rateLimitMax,
  burst: config.rateLimitBurst,
  windowMs: config.rateLimitWindowMs,
});
app.use('/markets/*', rl);
app.use('/markets', rl);
app.use('/events/*', rl);
app.use('/events', rl);

// Routes
app.route('/health', healthRouter);
app.route('/markets', marketsRouter);
app.route('/events', eventsRouter);
app.route('/stats', statsRouter);
app.route('/categories', categoriesRouter);
app.route('/internal', internalRouter);

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'Polymarket Indexer API',
    version: '0.1.0',
    endpoints: {
      health: '/health',
      markets: '/markets',
      events: '/events',
      stats: '/stats',
      categories: '/categories',
    },
  });
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not Found', path: c.req.path }, 404);
});

// Error handler
app.onError((err, c) => {
  const logger = getLogger();
  logger.error({ err, path: c.req.path }, 'API Error');
  return c.json(
    {
      error: 'Internal Server Error',
      message: err.message,
    },
    500
  );
});

export { app };
