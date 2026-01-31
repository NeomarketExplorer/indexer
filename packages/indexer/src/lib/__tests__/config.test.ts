/**
 * Config module unit tests
 * Tests pure logic: validation, defaults, env overrides, caching, reset
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig, resetConfig } from '../config';

describe('getConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
    resetConfig();
  });

  it('returns default values when no env vars are set', () => {
    // Clear relevant env vars
    delete process.env.DATABASE_URL;
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.LOG_LEVEL;
    delete process.env.NODE_ENV;

    const config = getConfig();

    expect(config.databaseUrl).toBe('postgresql://postgres:postgres@localhost:5432/polymarket');
    expect(config.port).toBe(3001);
    expect(config.host).toBe('0.0.0.0');
    expect(config.logLevel).toBe('info');
    expect(config.nodeEnv).toBe('development');
    expect(config.marketsSyncInterval).toBe(5 * 60 * 1000);
    expect(config.tradesSyncInterval).toBe(60 * 1000);
    expect(config.priceFlushInterval).toBe(1000);
    expect(config.marketsBatchSize).toBe(500);
    expect(config.tradesBatchSize).toBe(500);
  });

  it('reads values from environment variables', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@host:5433/testdb';
    process.env.PORT = '4000';
    process.env.HOST = '127.0.0.1';
    process.env.LOG_LEVEL = 'debug';
    process.env.NODE_ENV = 'production';
    process.env.MARKETS_SYNC_INTERVAL = '60000';
    process.env.MARKETS_BATCH_SIZE = '100';

    const config = getConfig();

    expect(config.databaseUrl).toBe('postgresql://user:pass@host:5433/testdb');
    expect(config.port).toBe(4000);
    expect(config.host).toBe('127.0.0.1');
    expect(config.logLevel).toBe('debug');
    expect(config.nodeEnv).toBe('production');
    expect(config.marketsSyncInterval).toBe(60000);
    expect(config.marketsBatchSize).toBe(100);
  });

  it('coerces string numbers to numbers', () => {
    process.env.PORT = '9999';
    process.env.MARKETS_BATCH_SIZE = '250';

    const config = getConfig();

    expect(config.port).toBe(9999);
    expect(typeof config.port).toBe('number');
    expect(config.marketsBatchSize).toBe(250);
    expect(typeof config.marketsBatchSize).toBe('number');
  });

  it('throws on invalid configuration', () => {
    process.env.DATABASE_URL = 'not-a-valid-url';

    expect(() => getConfig()).toThrow('Invalid configuration');
  });

  it('throws on invalid log level', () => {
    process.env.LOG_LEVEL = 'banana';

    expect(() => getConfig()).toThrow('Invalid configuration');
  });

  it('throws on invalid NODE_ENV', () => {
    process.env.NODE_ENV = 'staging';

    expect(() => getConfig()).toThrow('Invalid configuration');
  });

  it('throws on non-positive port', () => {
    process.env.PORT = '0';

    expect(() => getConfig()).toThrow('Invalid configuration');
  });

  it('caches the result on subsequent calls', () => {
    process.env.PORT = '5000';
    const first = getConfig();

    // Change env — should still get cached result
    process.env.PORT = '6000';
    const second = getConfig();

    expect(first).toBe(second);
    expect(second.port).toBe(5000);
  });

  it('resetConfig() clears the cache', () => {
    process.env.PORT = '5000';
    const first = getConfig();
    expect(first.port).toBe(5000);

    resetConfig();
    process.env.PORT = '6000';
    const second = getConfig();
    expect(second.port).toBe(6000);
  });

  it('uses default API URLs', () => {
    const config = getConfig();

    expect(config.gammaApiUrl).toBe('https://gamma-api.polymarket.com');
    expect(config.clobApiUrl).toBe('https://clob.polymarket.com');
    expect(config.dataApiUrl).toBe('https://data-api.polymarket.com');
    expect(config.wsUrl).toBe('wss://ws-subscriptions-clob.polymarket.com/ws');
  });
});
