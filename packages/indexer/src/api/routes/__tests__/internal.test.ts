/**
 * Internal/export route integration tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../index';
import { setupTestDb, seedTestData, cleanDb, closeTestDb } from '../../../test/db-helpers';

describe('Internal routes', () => {
  beforeAll(async () => {
    await setupTestDb();
    await cleanDb();
    await seedTestData();
  });

  afterAll(async () => {
    await cleanDb();
    await closeTestDb();
  });

  describe('GET /internal/export/market-categories', () => {
    it('returns condition_id -> categories mapping', async () => {
      const res = await app.request('/internal/export/market-categories?limit=10');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body).toHaveProperty('pagination');

      const first = body.data[0];
      expect(first).toHaveProperty('condition_id');
      expect(first).toHaveProperty('market_id');
      expect(first).toHaveProperty('categories');
      expect(Array.isArray(first.categories)).toBe(true);
    });
  });
});

