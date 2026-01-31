/**
 * Gamma schema unit tests
 * Tests Zod schema parsing, validation, and JSON string field handling
 */

import { describe, it, expect } from 'vitest';
import { GammaMarketSchema, GammaEventSchema } from '../index';

describe('GammaMarketSchema', () => {
  const validMarket = {
    id: '0x1234',
    conditionId: '0xabcd',
    question: 'Will Bitcoin reach $100k?',
    outcomes: '["Yes", "No"]',
    outcomePrices: '["0.65", "0.35"]',
    slug: 'bitcoin-100k',
    endDateIso: '2025-12-31T00:00:00Z',
    closed: false,
    active: true,
    archived: false,
    volumeNum: 5000000,
    volume24hr: 250000,
    liquidityNum: 1000000,
    clobTokenIds: '["token-a", "token-b"]',
  };

  it('parses a valid market', () => {
    const result = GammaMarketSchema.safeParse(validMarket);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('0x1234');
      expect(result.data.question).toBe('Will Bitcoin reach $100k?');
      expect(result.data.outcomes).toBe('["Yes", "No"]');
    }
  });

  it('requires id field', () => {
    const { id, ...noId } = validMarket;
    const result = GammaMarketSchema.safeParse(noId);

    expect(result.success).toBe(false);
  });

  it('requires conditionId field', () => {
    const { conditionId, ...noCondition } = validMarket;
    const result = GammaMarketSchema.safeParse(noCondition);

    expect(result.success).toBe(false);
  });

  it('requires question field', () => {
    const { question, ...noQuestion } = validMarket;
    const result = GammaMarketSchema.safeParse(noQuestion);

    expect(result.success).toBe(false);
  });

  it('requires outcomes field', () => {
    const { outcomes, ...noOutcomes } = validMarket;
    const result = GammaMarketSchema.safeParse(noOutcomes);

    expect(result.success).toBe(false);
  });

  it('accepts outcomes as JSON string', () => {
    const result = GammaMarketSchema.safeParse(validMarket);

    expect(result.success).toBe(true);
    if (result.success) {
      // outcomes stays as string (schema doesn't transform it)
      expect(typeof result.data.outcomes).toBe('string');
      expect(JSON.parse(result.data.outcomes)).toEqual(['Yes', 'No']);
    }
  });

  it('accepts outcomePrices as JSON string', () => {
    const result = GammaMarketSchema.safeParse(validMarket);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.outcomePrices).toBe('string');
      const prices = JSON.parse(result.data.outcomePrices!);
      expect(prices).toEqual(['0.65', '0.35']);
    }
  });

  it('accepts clobTokenIds as JSON string', () => {
    const result = GammaMarketSchema.safeParse(validMarket);

    expect(result.success).toBe(true);
    if (result.success) {
      const tokens = JSON.parse(result.data.clobTokenIds!);
      expect(tokens).toEqual(['token-a', 'token-b']);
    }
  });

  it('allows nullable optional fields', () => {
    const minimal = {
      id: '0x1234',
      conditionId: '0xabcd',
      question: 'Test?',
      outcomes: '["Yes", "No"]',
      description: null,
      outcomePrices: null,
      slug: null,
      image: null,
      icon: null,
      category: null,
      clobTokenIds: null,
    };

    const result = GammaMarketSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('allows passthrough of extra fields', () => {
    const withExtra = {
      ...validMarket,
      someNewField: 'new-value',
      anotherField: 42,
    };

    const result = GammaMarketSchema.safeParse(withExtra);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).someNewField).toBe('new-value');
    }
  });
});

describe('GammaEventSchema', () => {
  const validEvent = {
    id: 'evt-1',
    title: 'Will Bitcoin reach $100k?',
    description: 'Event about Bitcoin price',
    slug: 'bitcoin-100k',
    active: true,
    closed: false,
    archived: false,
    volume: 5000000,
    volume24hr: 250000,
    liquidity: 1000000,
  };

  it('parses a valid event', () => {
    const result = GammaEventSchema.safeParse(validEvent);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('evt-1');
      expect(result.data.title).toBe('Will Bitcoin reach $100k?');
    }
  });

  it('requires id and title', () => {
    const result1 = GammaEventSchema.safeParse({ ...validEvent, id: undefined });
    expect(result1.success).toBe(false);

    const result2 = GammaEventSchema.safeParse({ ...validEvent, title: undefined });
    expect(result2.success).toBe(false);
  });

  it('accepts nested markets array', () => {
    const withMarkets = {
      ...validEvent,
      markets: [
        {
          id: 'mkt-1',
          conditionId: 'cond-1',
          question: 'Test?',
          outcomes: '["Yes","No"]',
        },
      ],
    };

    const result = GammaEventSchema.safeParse(withMarkets);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.markets).toHaveLength(1);
    }
  });

  it('accepts tags as object array', () => {
    const withTags = {
      ...validEvent,
      tags: [
        { id: 'tag-1', label: 'Crypto', slug: 'crypto' },
      ],
    };

    const result = GammaEventSchema.safeParse(withTags);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toHaveLength(1);
    }
  });

  it('allows passthrough of extra fields', () => {
    const withExtra = { ...validEvent, newField: 'test' };
    const result = GammaEventSchema.safeParse(withExtra);

    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).newField).toBe('test');
    }
  });
});
