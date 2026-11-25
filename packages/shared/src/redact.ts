/** Replacement written in place of every secret value. */
export const REDACTED = '[REDACTED]';

/**
 * Keys whose values never reach CloudWatch (Req 25.6, 22.27). Matched case-insensitively. Covers
 * secrets plus Draft_Notes and Bedrock prompt/response payloads (`system`, `messages`, `output`).
 */
export const REDACTED_KEY_RE =
  /^(doorcode|confirmationnumber|authorization|idtoken|accesstoken|token|checkindetails|notes|draftnotes|prompt|system|messages|output)$/i;

/**
 * Pure deep copy of `value` with the value of every secret key, at any depth and inside arrays,
 * replaced by `"[REDACTED]"`. The input is never mutated. Circular references become `"[Circular]"`.
 */
export function redact<T>(value: T): T {
  return copy(value, new WeakSet()) as T;
}

function copy(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof Error) {
    // Error fields are non-enumerable, so copy them explicitly for logging.
    return { ...(copy({ ...value }, seen) as object), name: value.name, message: value.message, stack: value.stack };
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  let out: unknown;
  if (Array.isArray(value)) {
    out = value.map((v) => copy(v, seen));
  } else {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      obj[k] = REDACTED_KEY_RE.test(k) ? REDACTED : copy(v, seen);
    }
    out = obj;
  }
  seen.delete(value);
  return out;
}
