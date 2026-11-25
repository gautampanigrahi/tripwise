import type { Repos } from '../interfaces.js';

/** One repository call recorded by a fake, with its arguments cloned at call time. */
export interface RepoCall {
  repo: keyof Repos;
  method: string;
  args: unknown[];
}

/** Thrown by fakes where DynamoDB would cancel a transaction or fail an unhandled condition. */
export class FakeConditionError extends Error {
  constructor(name: 'TransactionCanceledException' | 'ConditionalCheckFailedException', message: string) {
    super(message);
    this.name = name;
  }
}

/**
 * In-memory stand-in for the single table: PK -> SK -> record. Records are cloned on the way in
 * and out, so callers cannot mutate stored state. Queries return records in SK order, matching
 * DynamoDB's sort-key order because the fakes use the same key builders (`../keys.ts`).
 */
export class MemoryTable {
  private readonly partitions = new Map<string, Map<string, unknown>>();
  readonly calls: RepoCall[] = [];

  record(repo: keyof Repos, method: string, args: unknown[]): void {
    this.calls.push({ repo, method, args: structuredClone(args) });
  }

  /** Recorded calls, optionally only those of one repository. */
  callsTo(repo: keyof Repos): RepoCall[] {
    return this.calls.filter((c) => c.repo === repo);
  }

  get<T>(pk: string, sk: string): T | undefined {
    const value = this.partitions.get(pk)?.get(sk);
    return value === undefined ? undefined : (structuredClone(value) as T);
  }

  has(pk: string, sk: string): boolean {
    return this.partitions.get(pk)?.has(sk) ?? false;
  }

  put(pk: string, sk: string, value: unknown): void {
    let partition = this.partitions.get(pk);
    if (!partition) this.partitions.set(pk, (partition = new Map()));
    partition.set(sk, structuredClone(value));
  }

  delete(pk: string, sk: string): boolean {
    return this.partitions.get(pk)?.delete(sk) ?? false;
  }

  /** Records under `pk` whose SK starts with `prefix`, ascending by SK unless `descending`. */
  query<T>(pk: string, prefix: string, descending = false): T[] {
    const partition = this.partitions.get(pk);
    if (!partition) return [];
    const sks = [...partition.keys()].filter((sk) => sk.startsWith(prefix)).sort();
    if (descending) sks.reverse();
    return sks.map((sk) => structuredClone(partition.get(sk)) as T);
  }

  /** Every record whose SK matches, across all partitions, ordered by PK. */
  scanBySk<T>(match: (sk: string) => boolean): T[] {
    const out: T[] = [];
    for (const pk of [...this.partitions.keys()].sort()) {
      for (const [sk, value] of this.partitions.get(pk)!) {
        if (match(sk)) out.push(structuredClone(value) as T);
      }
    }
    return out;
  }
}
