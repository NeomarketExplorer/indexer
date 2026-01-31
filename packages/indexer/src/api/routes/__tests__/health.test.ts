/**
 * Health route integration tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../index';
import { setupTestDb, cleanDb, closeTestDb } from '../../../test/db-helpers';

describe('Health routes', () => {
  beforeAll(async () => {
    await setupTestDb();
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
});
