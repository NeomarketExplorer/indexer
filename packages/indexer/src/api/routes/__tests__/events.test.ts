/**
 * Events route integration tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../index';
import { setupTestDb, seedTestData, cleanDb, closeTestDb } from '../../../test/db-helpers';

describe('Events routes', () => {
  beforeAll(async () => {
    await setupTestDb();
    await cleanDb();
    await seedTestData();
  });

  afterAll(async () => {
    await cleanDb();
    await closeTestDb();
  });

  describe('GET /events', () => {
    it('returns paginated events with default params', async () => {
      const res = await app.request('/events');

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
    });

    it('respects limit and offset', async () => {
      const res = await app.request('/events?limit=1&offset=0');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBeLessThanOrEqual(1);
      expect(body.pagination.limit).toBe(1);
    });

    it('filters by active status', async () => {
      const res = await app.request('/events?active=true');

      expect(res.status).toBe(200);
      const body = await res.json();
      body.data.forEach((e: { active: boolean }) => {
        expect(e.active).toBe(true);
      });
    });

    it('filters by closed status', async () => {
      const res = await app.request('/events?closed=true');

      expect(res.status).toBe(200);
      const body = await res.json();
      body.data.forEach((e: { closed: boolean }) => {
        expect(e.closed).toBe(true);
      });
    });

    it('searches by title text', async () => {
      const res = await app.request('/events?search=Bitcoin');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBeGreaterThan(0);
    });

    it('sorts by volume descending by default', async () => {
      const res = await app.request('/events');

      expect(res.status).toBe(200);
      const body = await res.json();
      if (body.data.length >= 2) {
        for (let i = 1; i < body.data.length; i++) {
          expect(body.data[i - 1].volume).toBeGreaterThanOrEqual(body.data[i].volume);
        }
      }
    });

    it('filters by custom category (parent)', async () => {
      const res = await app.request('/events?category=crypto');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBeGreaterThan(0);
      body.data.forEach((e: { categories: string[] }) => {
        expect(e.categories).toContain('crypto');
      });
    });

    it('filters by custom category (child)', async () => {
      const res = await app.request('/events?category=politics/us-elections');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBeGreaterThan(0);
      body.data.forEach((e: { categories: string[] }) => {
        expect(e.categories).toContain('politics/us-elections');
      });
    });

    it('returns empty data for non-existent category', async () => {
      const res = await app.request('/events?category=nonexistent/foo');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBe(0);
    });

    it('returns 400 for invalid query params', async () => {
      const res = await app.request('/events?limit=-1');

      expect(res.status).toBe(400);
    });
  });

  describe('GET /events/:id', () => {
    it('returns a single event with nested markets', async () => {
      const res = await app.request('/events/event-1');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveProperty('id', 'event-1');
      expect(body.data).toHaveProperty('title');
      expect(body.data).toHaveProperty('markets');
      expect(Array.isArray(body.data.markets)).toBe(true);
      expect(body.data.markets.length).toBeGreaterThan(0);
    });

    it('orders nested markets by volume_24hr descending', async () => {
      const res = await app.request('/events/event-1');

      expect(res.status).toBe(200);
      const body = await res.json();
      const markets = body.data.markets;
      if (markets.length >= 2) {
        for (let i = 1; i < markets.length; i++) {
          expect(markets[i - 1].volume24hr).toBeGreaterThanOrEqual(markets[i].volume24hr);
        }
      }
    });

    it('returns 404 for non-existent event', async () => {
      const res = await app.request('/events/non-existent');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    });
  });
});
