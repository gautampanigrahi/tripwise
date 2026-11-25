export interface Share {
  memberId: string;
  amountCents: number;
}

/** Splits cents as evenly as possible. The first people in the list receive any leftover cents. */
export function equalShares(totalCents: number, memberIds: readonly string[]): Share[] {
  if (memberIds.length === 0 || !Number.isInteger(totalCents) || totalCents <= 0) return [];
  const base = Math.floor(totalCents / memberIds.length);
  let extra = totalCents - base * memberIds.length;
  return memberIds.map((memberId) => {
    const amountCents = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    return { memberId, amountCents };
  });
}

export interface Balance {
  fromMemberId: string;
  toMemberId: string;
  cents: number;
}

/**
 * Nets what each person owes the people who paid. A payer's own share is not a debt.
 * Expenses with no split list do not create a balance.
 */
export function balances(
  expenses: readonly { payerMemberId: string; splits?: readonly Share[] }[],
): Balance[] {
  const directed = new Map<string, Map<string, number>>();
  const add = (from: string, to: string, cents: number) => {
    const row = directed.get(from) ?? new Map<string, number>();
    row.set(to, (row.get(to) ?? 0) + cents);
    directed.set(from, row);
  };
  for (const expense of expenses) {
    for (const share of expense.splits ?? []) {
      if (share.memberId === expense.payerMemberId || share.amountCents <= 0) continue;
      add(share.memberId, expense.payerMemberId, share.amountCents);
    }
  }
  const done = new Set<string>();
  const out: Balance[] = [];
  for (const [from, row] of directed) {
    for (const [to, cents] of row) {
      const pair = [from, to].sort().join("\0");
      if (done.has(pair)) continue;
      done.add(pair);
      const back = directed.get(to)?.get(from) ?? 0;
      const net = cents - back;
      if (net > 0) out.push({ fromMemberId: from, toMemberId: to, cents: net });
      else if (net < 0) out.push({ fromMemberId: to, toMemberId: from, cents: -net });
    }
  }
  return out.sort((a, b) => b.cents - a.cents || a.fromMemberId.localeCompare(b.fromMemberId));
}
