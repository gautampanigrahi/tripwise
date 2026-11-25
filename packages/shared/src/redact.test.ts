import { describe, expect, it } from 'vitest';
import { REDACTED, redact } from './redact.js';

describe('redact', () => {
  it('redacts secret keys at any depth, in any case, and inside arrays', () => {
    const input = {
      Authorization: 'Bearer abc.def',
      trip: {
        name: 'Tahoe',
        items: [
          { title: 'Cabin', confirmationNumber: 'CONF-123', checkInDetails: { doorCode: '4321', notes: 'x' } },
          { DOORCODE: '9999', nightlyPriceCents: 25000 },
        ],
      },
      auth: { IdToken: 'sec-id-1', accessToken: 'sec-acc-2', TOKEN: 'sec-tok-3' },
    };
    const out = redact(input);
    const json = JSON.stringify(out);
    for (const secret of ['abc.def', 'CONF-123', '4321', '9999', 'sec-id-1', 'sec-acc-2', 'sec-tok-3']) {
      expect(json).not.toContain(secret);
    }
    expect(out.Authorization).toBe(REDACTED);
    expect(out.trip.items[0]!.checkInDetails).toBe(REDACTED);
    expect(out.trip.items[1]).toEqual({ DOORCODE: REDACTED, nightlyPriceCents: 25000 });
    expect(out.trip.name).toBe('Tahoe');
  });

  it('redacts Draft_Notes and Bedrock prompt and response payloads (Req 22.27)', () => {
    const input = {
      body: { notes: 'buy eggs', draftNotes: 'call Sam', itemIds: ['a'] },
      request: { Prompt: 'p-secret', system: [{ text: 's-secret' }], messages: [{ text: 'm-secret' }] },
      response: { OUTPUT: { message: 'o-secret' } },
      reason: 'TIMEOUT',
    };
    const out = redact(input);
    const json = JSON.stringify(out);
    for (const secret of ['buy eggs', 'call Sam', 'p-secret', 's-secret', 'm-secret', 'o-secret']) {
      expect(json).not.toContain(secret);
    }
    expect(out.body).toEqual({ notes: REDACTED, draftNotes: REDACTED, itemIds: ['a'] });
    expect(out.response.OUTPUT).toBe(REDACTED);
    expect(out.reason).toBe('TIMEOUT');
  });

  it('does not mutate the input', () => {
    const input = { nested: { doorCode: '1234' }, list: [1, 2] };
    const out = redact(input);
    expect(input.nested.doorCode).toBe('1234');
    expect(out).not.toBe(input);
    expect(out.list).not.toBe(input.list);
  });

  it('leaves non-secret keys that merely contain a secret word', () => {
    expect(redact({ tokenCount: 3, doorCodeHint: 'blue', notesCount: 2, outputFormat: 'json' })).toEqual({
      tokenCount: 3,
      doorCodeHint: 'blue',
      notesCount: 2,
      outputFormat: 'json',
    });
  });

  it('passes primitives through and handles cycles', () => {
    expect(redact(5)).toBe(5);
    expect(redact(null)).toBe(null);
    const a: Record<string, unknown> = { token: 't' };
    a.self = a;
    expect(redact(a)).toEqual({ token: REDACTED, self: '[Circular]' });
  });

  it('keeps error name, message, and stack', () => {
    const out = redact({ err: new Error('boom') }) as { err: { message: string; stack?: string } };
    expect(out.err.message).toBe('boom');
    expect(out.err.stack).toContain('boom');
  });
});
