import { createHmac } from 'node:crypto';
import type { AuthProvider } from '../client';

export interface PolymarketL2Credentials {
  address: string;
  apiKey: string;
  secret: string; // base64/base64url encoded key
  passphrase: string;
}

function decodeBase64Secret(secret: string): Buffer {
  // Convert base64url -> base64 and strip any non-base64 chars for backwards compatibility.
  const sanitized = secret
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  return Buffer.from(sanitized, 'base64');
}

function toUrlSafeBase64(base64: string): string {
  // NOTE: Keep the "=" padding suffix.
  return base64.replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Builds the canonical Polymarket CLOB HMAC signature.
 *
 * Message format: `${timestamp}${method}${requestPath}${body ?? ''}`
 * - timestamp is in seconds (integer)
 * - method is uppercase (GET/POST/...)
 * - requestPath includes query string (e.g. "/trades?token_id=...&limit=...")
 * - body is the raw JSON string for POST/PUT when present
 */
export function buildPolyHmacSignature(args: {
  secret: string;
  timestampSec: number;
  method: string;
  requestPath: string;
  body?: string;
}): string {
  const message = `${args.timestampSec}${args.method}${args.requestPath}${args.body ?? ''}`;
  const key = decodeBase64Secret(args.secret);
  const sig = createHmac('sha256', key).update(message).digest('base64');
  return toUrlSafeBase64(sig);
}

export function createPolymarketL2Auth(creds: PolymarketL2Credentials): AuthProvider {
  return async ({ method, requestPath, body }) => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = buildPolyHmacSignature({
      secret: creds.secret,
      timestampSec: ts,
      method,
      requestPath,
      body,
    });
    return {
      POLY_ADDRESS: creds.address,
      POLY_SIGNATURE: sig,
      POLY_TIMESTAMP: `${ts}`,
      POLY_API_KEY: creds.apiKey,
      POLY_PASSPHRASE: creds.passphrase,
    };
  };
}

