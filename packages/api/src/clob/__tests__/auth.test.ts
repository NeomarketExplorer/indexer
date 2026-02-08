import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { buildPolyHmacSignature } from '../auth';

function urlSafeBase64(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_');
}

describe('buildPolyHmacSignature', () => {
  it('matches a WebCrypto HMAC-SHA256 signature (base64url, keeps padding)', async () => {
    const secret = 'c2VjcmV0'; // base64("secret")
    const timestampSec = 1_700_000_000;
    const method = 'GET';
    const requestPath = '/trades?token_id=1&limit=2';

    const message = `${timestampSec}${method}${requestPath}`;

    const key = Buffer.from(secret, 'base64');
    const cryptoKey = await webcrypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const sigBuf = await webcrypto.subtle.sign(
      'HMAC',
      cryptoKey,
      new TextEncoder().encode(message)
    );

    const expectedB64 = Buffer.from(new Uint8Array(sigBuf)).toString('base64');
    const expected = urlSafeBase64(expectedB64);

    const actual = buildPolyHmacSignature({
      secret,
      timestampSec,
      method,
      requestPath,
    });

    expect(actual).toBe(expected);
    expect(actual.endsWith('=')).toBe(true);
  });

  it('accepts base64url secrets ("/" and "+" swapped) and produces the same signature', () => {
    // 0xfb 0xff 0xff -> "+///"
    const base64 = '+///';
    const base64url = '-___';

    const args = {
      timestampSec: 1_700_000_000,
      method: 'GET',
      requestPath: '/trades?token_id=1&limit=2',
    } as const;

    const sig1 = buildPolyHmacSignature({ secret: base64, ...args });
    const sig2 = buildPolyHmacSignature({ secret: base64url, ...args });

    expect(sig1).toBe(sig2);
  });
});

