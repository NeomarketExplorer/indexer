/**
 * Markets route integration tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../index';
import { setupTestDb, seedTestData, cleanDb, closeTestDb } from '../../../test/db-helpers';

describe('Markets routes', () => {
  beforeAll(async () => {
    await setupTestDb();
    await cleanDb();
    await seedTestData();
  });

  afterAll(async () => {
    await cleanDb();
    await closeTestDb();
  });

  describe('GET /markets', () => {
    it('returns paginated markets with default params', async () => {
      const res = await app.request('/markets');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toMatchObject({
        limit: 20,
        offset: 0,
      });
      expect(typeof body.pagination.total).toBe('number');
      expect(typeof body.pagination.hasMore).toBe('boolean');
    });

    it('respects limit and offset', async () => {
      const res = await app.request('/markets?limit=2&offset=0');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBeLessThanOrEqual(2);
      expect(body.pagination.limit).toBe(2);
      expect(body.pagination.offset).toBe(0);
    });

    it('filters by active status', async () => {
      const res = await app.request('/markets?active=true');

      expect(res.status).toBe(200);
      const body = await res.json();
      body.data.forEach((m: { active: boolean }) => {
        expect(m.active).toBe(true);
      });
    });

    it('filters by closed status', async () => {
      const res = await app.request('/markets?closed=true');

      expect(res.status).toBe(200);
      const body = await res.json();
      body.data.forEach((m: { closed: boolean }) => {
        expect(m.closed).toBe(true);
      });
    });

    it('filters by category', async () => {
      const res = await app.request('/markets?category=Crypto');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBeGreaterThan(0);
      body.data.forEach((m: { category: string }) => {
        expect(m.category).toBe('Crypto');
      });
    });

    it('searches by question text', async () => {
      const res = await app.request('/markets?search=Bitcoin');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBeGreaterThan(0);
    });

    it('sorts by volume_24hr descending by default', async () => {
      const res = await app.request('/markets');

      expect(res.status).toBe(200);
      const body = await res.json();
      if (body.data.length >= 2) {
        for (let i = 1; i < body.data.length; i++) {
          expect(body.data[i - 1].volume24hr).toBeGreaterThanOrEqual(body.data[i].volume24hr);
        }
      }
    });

    it('sorts ascending when order=asc', async () => {
      const res = await app.request('/markets?sort=volume&order=asc');

      expect(res.status).toBe(200);
      const body = await res.json();
      if (body.data.length >= 2) {
        for (let i = 1; i < body.data.length; i++) {
          expect(body.data[i].volume).toBeGreaterThanOrEqual(body.data[i - 1].volume);
        }
      }
    });

    it('returns 400 for invalid query params', async () => {
      const res = await app.request('/markets?limit=-1');

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    });
  });

  describe('GET /markets/search', () => {
    it('searches markets by query', async () => {
      const res = await app.request('/markets/search?q=Bitcoin');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('query', 'Bitcoin');
      expect(body.data.length).toBeGreaterThan(0);
    });

    it('returns 400 for short query', async () => {
      const res = await app.request('/markets/search?q=a');

      expect(res.status).toBe(400);
    });

    it('returns 400 for missing query', async () => {
      const res = await app.request('/markets/search');

      expect(res.status).toBe(400);
    });

    it('respects limit parameter', async () => {
      const res = await app.request('/markets/search?q=Bitcoin&limit=1');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBeLessThanOrEqual(1);
    });
  });

  describe('GET /markets/:id', () => {
    it('returns a single market with event', async () => {
      const res = await app.request('/markets/market-1');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveProperty('id', 'market-1');
      expect(body.data).toHaveProperty('question');
      expect(body.data).toHaveProperty('event');
    });

    it('returns 404 for non-existent market', async () => {
      const res = await app.request('/markets/non-existent');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    });
  });

  describe('GET /markets/:id/history', () => {
    it('returns price history for a market', async () => {
      const res = await app.request('/markets/market-1/history');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('interval', '1w');
      expect(body).toHaveProperty('startDate');
      expect(body).toHaveProperty('endDate');
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('supports different intervals', async () => {
      const res = await app.request('/markets/market-1/history?interval=1h');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.interval).toBe('1h');
    });

    it('returns 404 for non-existent market', async () => {
      const res = await app.request('/markets/non-existent/history');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /markets/:id/trades', () => {
    it('returns trades for a market', async () => {
      const res = await app.request('/markets/market-1/trades');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns 404 for non-existent market', async () => {
      const res = await app.request('/markets/non-existent/trades');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /markets/prices', () => {
    it('returns prices for given market ids', async () => {
      const res = await app.request('/markets/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['market-1', 'market-2'] }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('market-1');
    });

    it('returns 400 for missing ids', async () => {
      const res = await app.request('/markets/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for too many ids', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
      const res = await app.request('/markets/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });

      expect(res.status).toBe(400);
    });
  });
});
