/**
 * Global vitest setup
 * Sets test environment variables before any tests run
 */

import { resetConfig } from '../lib/config';

// Ensure test environment
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

// Use test database if not already set
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/polymarket_test';
}

// Reset config cache before each test file
beforeEach(() => {
  resetConfig();
});
