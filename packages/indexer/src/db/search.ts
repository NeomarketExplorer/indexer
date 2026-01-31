/**
 * Full-text search helpers for PostgreSQL tsvector queries
 */

import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * Sanitize and convert a search term to a tsquery string
 * - Strips non-alphanumeric characters (except spaces)
 * - Joins words with & (AND)
 * - Adds :* for prefix matching
 */
export function toTsQuery(term: string): string {
  const sanitized = term
    .replace(/[^\w\s]/g, ' ')  // Strip special chars
    .trim()
    .split(/\s+/)              // Split on whitespace
    .filter(w => w.length > 0) // Remove empty strings
    .map(w => `${w}:*`)        // Add prefix matching
    .join(' & ');               // AND together

  return sanitized || '';
}

/**
 * Build a WHERE clause for full-text search using @@ operator
 */
export function ftsWhere(searchVectorColumn: PgColumn, term: string): SQL {
  const query = toTsQuery(term);
  if (!query) {
    return sql`false`;
  }
  return sql`${searchVectorColumn} @@ to_tsquery('english', ${query})`;
}

/**
 * Build a ts_rank() expression for ordering by relevance
 */
export function ftsRank(searchVectorColumn: PgColumn, term: string): SQL<number> {
  const query = toTsQuery(term);
  if (!query) {
    return sql<number>`0`;
  }
  return sql<number>`ts_rank(${searchVectorColumn}, to_tsquery('english', ${query}))`;
}
