/**
 * Health route integration tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../index';
import { setupTestDb, seedTestData, cleanDb, closeTestDb, getTestDb } from '../../../test/db-helpers';
import * as schema from '../../../db/schema';
import { eq } from 'drizzle-orm';

describe('Health routes', () => {
  beforeAll(async () => {
    await setupTestDb();
    await cleanDb();
  });

  afterAll(async () => {
    await cleanDb();
    await closeTestDb();
  });

  describe('GET /health/live', () => {
    it('returns 200 with status ok', async () => {
      const res = await app.request('/health/live');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
    });
  });

  describe('GET /health', () => {
    it('returns health status with database check', async () => {
      const res = await app.request('/health');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('checks');
      expect(body.checks).toHaveProperty('database');
    });
  });

  describe('GET /health/ready', () => {
    it('returns readiness status', async () => {
      const res = await app.request('/health/ready');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ready');
    });
  });

  describe('GET /health/sync', () => {
    it('returns 200 when markets/events sync is recent and not error', async () => {
      await seedTestData();

      const res = await app.request('/health/sync');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('healthy');
      expect(body.checks).toHaveProperty('markets');
      expect(body.checks).toHaveProperty('events');
    });

    it('returns 503 when markets sync is in error state', async () => {
      await cleanDb();
      await seedTestData();

      const db = getTestDb();
      await db.update(schema.syncState)
        .set({ status: 'error', errorMessage: 'boom' })
        .where(eq(schema.syncState.entity, 'markets'));

      const res = await app.request('/health/sync');
      expect(res.status).toBe(503);

      const body = await res.json();
      expect(body.status).toBe('degraded');
      expect(body.checks.markets.status).toBe('error');
    });
  });
});
