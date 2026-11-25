import { describe, expect, it } from 'vitest';
import { getCaller, type CallerEvent } from './caller.js';

type Claims = Record<string, string | number | boolean | string[]>;

function event(claims: Claims, extra: Record<string, unknown> = {}): CallerEvent {
  return {
    ...extra,
    requestContext: { authorizer: { jwt: { claims, scopes: [] } } },
  } as unknown as CallerEvent;
}

describe('getCaller', () => {
  it('maps sub, normalized email, and email_verified from the JWT claims', () => {
    const c = getCaller(event({ sub: 'u-1', email: '  Ana@Example.COM ', email_verified: true }));
    expect(c).toEqual({ userId: 'u-1', email: 'ana@example.com', emailVerified: true });
  });

  it('accepts email_verified as the string "true" and treats anything else as unverified', () => {
    expect(getCaller(event({ sub: 'u', email: 'a@b.c', email_verified: 'true' })).emailVerified).toBe(true);
    expect(getCaller(event({ sub: 'u', email: 'a@b.c', email_verified: 'false' })).emailVerified).toBe(false);
    expect(getCaller(event({ sub: 'u', email: 'a@b.c' })).emailVerified).toBe(false);
  });

  it('ignores user IDs in the body, query string, path, and headers (Req 4.4)', () => {
    const e = event(
      { sub: 'token-user', email: 'a@b.c', email_verified: true },
      {
        body: JSON.stringify({ userId: 'evil', sub: 'evil' }),
        queryStringParameters: { userId: 'evil' },
        pathParameters: { userId: 'evil' },
        headers: { 'x-user-id': 'evil' },
      },
    );
    expect(getCaller(e).userId).toBe('token-user');
  });

  it('returns an unverified empty email when the email claim is missing', () => {
    expect(getCaller(event({ sub: 'u', email_verified: true }))).toEqual({
      userId: 'u',
      email: '',
      emailVerified: false,
    });
  });

  it('throws when there is no sub claim', () => {
    expect(() => getCaller(event({ email: 'a@b.c' }))).toThrow(/sub/);
    expect(() => getCaller({ requestContext: {} } as unknown as CallerEvent)).toThrow(/sub/);
  });
});
