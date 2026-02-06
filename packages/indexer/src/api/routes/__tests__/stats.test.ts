/**
 * Stats route integration tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../index';
import { setupTestDb, seedTestData, cleanDb, closeTestDb } from '../../../test/db-helpers';

describe('Stats routes', () => {
  beforeAll(async () => {
    await setupTestDb();
    await cleanDb();
    await seedTestData();
  });

  afterAll(async () => {
    await cleanDb();
    await closeTestDb();
  });

  describe('GET /stats', () => {
    it('returns platform statistics with correct shape', async () => {
      const res = await app.request('/stats');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('data');

      const { data } = body;
      expect(data).toHaveProperty('markets');
      expect(data).toHaveProperty('events');
      expect(data).toHaveProperty('trades');
      expect(data).toHaveProperty('volume');
      expect(data).toHaveProperty('liquidity');
      expect(data).toHaveProperty('categories');
      expect(data).toHaveProperty('updatedAt');

      // Markets shape
      expect(data.markets).toHaveProperty('total');
      expect(data.markets).toHaveProperty('active');
      expect(data.markets).toHaveProperty('closed');
      expect(typeof data.markets.total).toBe('number');

      // Events shape
      expect(data.events).toHaveProperty('total');
      expect(data.events).toHaveProperty('active');
      expect(data.events).toHaveProperty('closed');

      // Trades shape
      expect(data.trades).toHaveProperty('total');
      expect(data.trades).toHaveProperty('last24hr');

      // Volume shape
      expect(data.volume).toHaveProperty('total');
      expect(data.volume).toHaveProperty('last24hr');

      // Categories
      expect(Array.isArray(data.categories)).toBe(true);
    });

    it('returns aggregate values matching seeded data', async () => {
      const res = await app.request('/stats');
      const body = await res.json();
      const { data } = body;

      // We seeded 4 markets: 3 active (including resolved), 2 closed
      expect(data.markets.total).toBe(4);
      expect(data.markets.active).toBe(3);
      expect(data.markets.closed).toBe(2);

      // We seeded 3 events: 2 active (including resolved), 2 closed
      expect(data.events.total).toBe(3);
      expect(data.events.active).toBe(2);
      expect(data.events.closed).toBe(2);

      // We seeded 3 trades
      expect(data.trades.total).toBe(3);

      // Liquidity should be positive
      expect(data.liquidity).toBeGreaterThan(0);
    });

    it('returns categories with name, count, and volume', async () => {
      const res = await app.request('/stats');
      const body = await res.json();

      body.data.categories.forEach((cat: { name: string; count: number; volume: number }) => {
        expect(typeof cat.name).toBe('string');
        expect(typeof cat.count).toBe('number');
        expect(typeof cat.volume).toBe('number');
      });
    });
  });

  describe('GET /stats/sync', () => {
    it('returns sync state data', async () => {
      const res = await app.request('/stats/sync');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('updatedAt');

      // We seeded sync state for markets and events
      expect(body.data).toHaveProperty('markets');
      expect(body.data).toHaveProperty('events');

      expect(body.data.markets).toHaveProperty('status');
      expect(body.data.markets).toHaveProperty('lastSyncAt');
    });
  });
});
