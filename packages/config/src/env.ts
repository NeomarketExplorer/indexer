/**
 * Environment configuration with Zod validation
 */

import { z } from 'zod';

// Client-side environment schema (NEXT_PUBLIC_* only)
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_POLYMARKET_API_URL: z
    .string()
    .url()
    .default('https://gamma-api.polymarket.com'),
  NEXT_PUBLIC_CLOB_API_URL: z
    .string()
    .url()
    .default('https://clob.polymarket.com'),
  NEXT_PUBLIC_DATA_API_URL: z
    .string()
    .url()
    .default('https://data-api.polymarket.com'),
  NEXT_PUBLIC_WS_URL: z
    .string()
    .url()
    .default('wss://ws-subscriptions-clob.polymarket.com/ws'),
  NEXT_PUBLIC_CHAIN_ID: z.coerce.number().default(137),
  NEXT_PUBLIC_PRIVY_APP_ID: z.string().optional(),
});

// Server-side environment schema (includes secrets)
export const serverEnvSchema = clientEnvSchema.extend({
  POLYMARKET_API_KEY: z.string().optional(),
  POLYMARKET_API_SECRET: z.string().optional(),
  POLYMARKET_PASSPHRASE: z.string().optional(),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Validate and get client environment
 */
export function getClientEnv(): ClientEnv {
  const env = {
    NEXT_PUBLIC_POLYMARKET_API_URL: process.env.NEXT_PUBLIC_POLYMARKET_API_URL,
    NEXT_PUBLIC_CLOB_API_URL: process.env.NEXT_PUBLIC_CLOB_API_URL,
    NEXT_PUBLIC_DATA_API_URL: process.env.NEXT_PUBLIC_DATA_API_URL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
    NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
    NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  };

  return clientEnvSchema.parse(env);
}

/**
 * Validate and get server environment (includes secrets)
 */
export function getServerEnv(): ServerEnv {
  const env = {
    ...getClientEnv(),
    POLYMARKET_API_KEY: process.env.POLYMARKET_API_KEY,
    POLYMARKET_API_SECRET: process.env.POLYMARKET_API_SECRET,
    POLYMARKET_PASSPHRASE: process.env.POLYMARKET_PASSPHRASE,
  };

  return serverEnvSchema.parse(env);
}
