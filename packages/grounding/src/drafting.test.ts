import { describe, expect, it } from 'vitest';
import { validatePlanItem } from '@tripwise/shared';
import {
  DRAFT_FIELDS,
  DRAFTING_SECTIONS,
  DraftRequestSchema,
  MAX_DRAFT_ITEMS,
  buildDraftPrompt,
  draftIsAboutNotes,
  filterDraftSections,
  groundDraftCosts,
  parseDraftResponse,
  resolveMemberName,
} from './index.js';
import type { DraftPromptInput } from './index.js';

const input: DraftPromptInput = {
  notes: 'Buy 12 eggs (Sam). Zoo on Saturday at 10:00, tickets $65.',
  trip: { startDate: '2025-06-12', endDate: '2025-06-16', destination: 'San Diego' },
  travelerCount: 4,
  memberNames: ['Sam', 'Alex'],
};

describe('draftIsAboutNotes', () => {
  it('keeps the beach and drops the invented arrival plan', () => {
    const notes = 'I want to go to the beach';
    expect(draftIsAboutNotes({ stopName: 'Beach' }, notes)).toBe(true);
    expect(draftIsAboutNotes({ stopName: 'Mission Beach' }, notes)).toBe(true);
    expect(draftIsAboutNotes({ stopName: 'Land at the airport' }, notes)).toBe(false);
    expect(draftIsAboutNotes({ name: 'Sunscreen' }, notes)).toBe(false);
    expect(draftIsAboutNotes({ task: 'Check into the hotel' }, notes)).toBe(false);
  });
});

describe('buildDraftPrompt', () => {
  it('includes the JSON instruction, fields, example, trip facts, names, and delimited notes', () => {
    const { system, user } = buildDraftPrompt(input);
    expect(system).toMatch(/Return only JSON/);
    expect(system).toContain('"section":"Groceries"');
    expect(system).toMatch(/Do not invent prices/);
    expect(system).toMatch(/Do not fill sections the notes do not mention/);
    expect(user).toContain('San Diego');
    expect(user).toContain('2025-06-12');
    expect(user).toContain('2025-06-16');
    expect(user).toContain('Traveler count: 4');
    expect(user).toContain('Sam, Alex');
    expect(user).toContain(`<notes>\n${input.notes}\n</notes>`);
    for (const s of DRAFTING_SECTIONS) expect(user).toContain(`${s}: ${DRAFT_FIELDS[s].join(', ')}`);
    expect(`${system}\n${user}`).not.toMatch(/Lodging|Expenses|ScratchPad/);
  });

  it('passes through only whitelisted input values', () => {
    const extra = {
      ...input,
      travelerCount: undefined,
      doorCode: 'SECRET-7777',
      email: 'sam@example.com',
      userId: 'user-123',
    } as DraftPromptInput;
    const text = Object.values(buildDraftPrompt(extra)).join('\n');
    expect(text).not.toContain('SECRET-7777');
    expect(text).not.toContain('sam@example.com');
    expect(text).not.toContain('user-123');
    expect(text).not.toContain('Traveler count');
  });
});

describe('parseDraftResponse', () => {
  const arr = '[{"section":"Checklist","fields":{"task":"Pack sunscreen"}}]';

  it('parses fenced JSON', () => {
    expect(parseDraftResponse('```json\n' + arr + '\n```')).toEqual({
      ok: true,
      items: [{ section: 'Checklist', fields: { task: 'Pack sunscreen' } }],
    });
  });

  it('parses JSON wrapped in prose and accepts items/drafts objects', () => {
    expect(parseDraftResponse(`Here you go: ${arr} Enjoy!`)).toMatchObject({ ok: true, items: [{ section: 'Checklist' }] });
    expect(parseDraftResponse(`{"items":${arr}}`)).toMatchObject({ ok: true, items: [{ section: 'Checklist' }] });
    expect(parseDraftResponse(`{"drafts":${arr}}`)).toMatchObject({ ok: true, items: [{ section: 'Checklist' }] });
  });

  it('handles brackets inside strings', () => {
    const r = parseDraftResponse('[{"section":"Checklist","fields":{"task":"Pack [hats] and {snacks}"}}]');
    expect(r).toEqual({ ok: true, items: [{ section: 'Checklist', fields: { task: 'Pack [hats] and {snacks}' } }] });
  });

  it('skips malformed entries', () => {
    const r = parseDraftResponse('[1, null, {"section":5,"fields":{}}, {"section":"Groceries"}, {"section":"Groceries","fields":[]}, ' +
      '{"section":"Groceries","fields":{"name":"Milk"}}]');
    expect(r).toEqual({ ok: true, items: [{ section: 'Groceries', fields: { name: 'Milk' } }] });
  });

  it('returns ok: false for non-JSON output', () => {
    expect(parseDraftResponse('Sorry, I cannot help with that.')).toEqual({ ok: false });
    expect(parseDraftResponse('[not json')).toEqual({ ok: false });
    expect(parseDraftResponse('')).toEqual({ ok: false });
  });
});

describe('filterDraftSections', () => {
  it('drops non-drafting sections before the 20-item cap', () => {
    const items = [
      { section: 'Lodging', fields: {} },
      { section: 'Expenses', fields: {} },
      ...Array.from({ length: 25 }, (_, i) => ({ section: 'Checklist', fields: { task: `t${i}` } })),
    ];
    const kept = filterDraftSections(items).slice(0, MAX_DRAFT_ITEMS);
    expect(kept).toHaveLength(20);
    expect(kept.every((k) => k.section === 'Checklist')).toBe(true);
    expect(kept[0]?.fields).toEqual({ task: 't0' });
    expect(kept[19]?.fields).toEqual({ task: 't19' });
  });
});

describe('resolveMemberName', () => {
  const members = [
    { userId: 'u1', displayName: 'Sam' },
    { userId: 'u2', displayName: 'Alex' },
    { userId: 'u3', displayName: 'alex ' },
  ];
  it('matches one Member after trimming, case-insensitively', () => {
    expect(resolveMemberName('  sAM ', members)).toBe('u1');
  });
  it('returns undefined for ambiguous, unknown, empty, or non-string names', () => {
    expect(resolveMemberName('Alex', members)).toBeUndefined();
    expect(resolveMemberName('Jordan', members)).toBeUndefined();
    expect(resolveMemberName('  ', members)).toBeUndefined();
    expect(resolveMemberName(42, members)).toBeUndefined();
  });
});

describe('groundDraftCosts', () => {
  const notes = 'Zoo tickets $65, parking 1,250 cents, split 40.5';
  it('keeps grounded costCents (as dollars or cents) and amount', () => {
    expect(groundDraftCosts({ fields: { title: 'Zoo', costCents: 6500 } }, notes).fields).toEqual({ title: 'Zoo', costCents: 6500 });
    expect(groundDraftCosts({ fields: { title: 'Park', costCents: 1250 } }, notes).fields).toEqual({ title: 'Park', costCents: 1250 });
    expect(groundDraftCosts({ fields: { amount: '40.50' } }, notes).fields).toEqual({ amount: '40.50' });
  });
  it('removes ungrounded costs and leaves other fields and the input untouched', () => {
    const draft = { fields: { title: 'Zoo', costCents: 9900, amount: '12', notes: 'x' } };
    expect(groundDraftCosts(draft, notes).fields).toEqual({ title: 'Zoo', notes: 'x' });
    expect(draft.fields.costCents).toBe(9900);
    expect(groundDraftCosts({ fields: { costCents: null } }, '0 people').fields).toEqual({});
  });
});

describe('DraftRequestSchema', () => {
  it('accepts itemIds and notes and rejects unknown keys', () => {
    expect(DraftRequestSchema.safeParse({ itemIds: ['a'], notes: 'hi' }).success).toBe(true);
    expect(DraftRequestSchema.safeParse({}).success).toBe(true);
    expect(DraftRequestSchema.safeParse({ notes: 'hi', userId: 'u1' }).success).toBe(false);
    expect(DraftRequestSchema.safeParse({ itemIds: [''] }).success).toBe(false);
  });
});

describe('draft fields match the Section schemas', () => {
  const ctx = { trip: input.trip, memberIds: new Set(['u1']) };
  it('drafts built from DRAFT_FIELDS pass validatePlanItem once names are mapped', () => {
    expect(validatePlanItem('Itinerary', { day: '2025-06-13', startTime: '10:00', endTime: '11:00', stopName: 'Zoo', notes: 'n' }, ctx).ok).toBe(true);
    expect(validatePlanItem('Groceries', { name: 'Eggs', quantity: 12, responsibleMemberId: 'u1', purchased: false }, ctx).ok).toBe(true);
    expect(validatePlanItem('Checklist', { task: 'Pack', done: false }, ctx).ok).toBe(true);
    for (const s of ['Reservations', 'Transportation'] as const) {
      expect(validatePlanItem(s, { title: 'T', notes: 'n', date: '2025-06-13', link: 'https://x.test', costCents: 6500 }, ctx).ok).toBe(true);
    }
  });
});
