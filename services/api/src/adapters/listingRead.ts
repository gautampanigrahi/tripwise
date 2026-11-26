import { lookup } from 'node:dns/promises';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

/** Facts copied from a public listing page. Absent fields were not on the page. */
export interface ListingFacts {
  name?: string;
  address?: string;
  sleeps?: number;
  /** Nightly rate in US dollars, two decimal places. */
  nightlyPrice?: string;
  /** https pages Nova cited while searching. Shown with the filled fields. */
  sources?: string[];
}

export type ListingFailure = 'INVALID_URL' | 'BLOCKED' | 'UNREADABLE';

export class ListingError extends Error {
  constructor(readonly code: ListingFailure) {
    super(code);
    this.name = 'ListingError';
  }
}

export interface ListingReaderDeps {
  fetch?: typeof fetch;
  /** Host to IP addresses. Tests pass a stub so they never touch DNS. */
  resolve?: (host: string) => Promise<string[]>;
  converse?: (system: string, user: string) => Promise<string | null>;
}

const FETCH_TIMEOUT_MS = 5_000;
/** Web grounding searches before it answers, so this sits inside the 29 s items-fn timeout. */
const MODEL_TIMEOUT_MS = 22_000;
const MAX_REDIRECTS = 3;
const MAX_BYTES = 500_000;
const MAX_TEXT = 12_000;
const MAX_SOURCES = 5;

const SYSTEM = [
  'You extract lodging facts from the listing page.',
  'When sleeps or the nightly rate are missing from that text, search the web for those two facts.',
  'Reply with JSON only: {"name":string|null,"address":string|null,"sleeps":number|null,"nightlyPrice":string|null}.',
  'Use null when a fact is neither on the page nor in the search results.',
  'nightlyPrice is the nightly rate in US dollars, such as "180.00", not a stay total.',
  'Do not invent a confirmation number, a door code, or dates.',
].join(' ');

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length === 0 || text.length > max) return undefined;
  return text;
}

/** Reads the model's JSON. Returns null when it names no usable fact. */
export function parseListingFacts(text: string): ListingFacts | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let value: { name?: unknown; address?: unknown; sleeps?: unknown; nightlyPrice?: unknown };
  try {
    value = JSON.parse(text.slice(start, end + 1)) as typeof value;
  } catch {
    return null;
  }
  const facts: ListingFacts = {};
  const name = clean(value.name, 120);
  const address = clean(value.address, 240);
  if (name) facts.name = name;
  if (address) facts.address = address;
  const sleeps = sleepsCount(value.sleeps);
  if (Number.isInteger(sleeps) && sleeps >= 1 && sleeps <= 100) facts.sleeps = sleeps;
  const price = nightlyAmount(value.nightlyPrice);
  if (Number.isFinite(price) && price > 0 && price < 100_000) facts.nightlyPrice = price.toFixed(2);
  return facts.name || facts.address || facts.sleeps !== undefined || facts.nightlyPrice ? facts : null;
}

function sleepsCount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  const match = value.trim().match(/^(\d{1,3})\b/);
  return match ? Number(match[1]) : Number.NaN;
}

/** Accepts 180, "180.00", "$180", and "180 per night". */
function nightlyAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  const cleaned = value
    .trim()
    .replace(/[$,]/g, '')
    .replace(/^usd\s*/i, '')
    .replace(/\s*(usd|per night|\/\s*night|a night).*$/i, '')
    .trim();
  return /^\d+(\.\d{1,2})?$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

interface CitedBlock {
  text?: string;
  citationsContent?: { citations?: Array<{ location?: { web?: { url?: string } } }> };
}

/** Guest count and displayed prices often sit in page JSON that the tag strip removes. */
export function pageHints(html: string): string {
  const hints: string[] = [];
  const guests = html.match(/maximum of \d{1,2} guests/i);
  const guestCount = html.match(/guestMaxCount\\?":\s*\\?"?(\d{1,2})/);
  if (guests) hints.push(guests[0]);
  else if (guestCount?.[1]) hints.push(`maximum guests ${guestCount[1]}`);
  const prices = new Set<string>();
  for (const match of html.matchAll(/priceString\\?":\s*\\?"(\$[\d,.]+)/g)) {
    if (match[1]) prices.add(match[1]);
    if (prices.size === 3) break;
  }
  if (prices.size > 0) hints.push(`displayed price ${[...prices].join(', ')} (this may be a stay total, not the nightly rate)`);
  return hints.join('. ');
}
export function webCitationUrls(blocks: readonly CitedBlock[]): string[] {
  const urls: string[] = [];
  for (const block of blocks) {
    for (const citation of block.citationsContent?.citations ?? []) {
      const raw = citation.location?.web?.url;
      if (!raw || urls.includes(raw)) continue;
      try {
        const url = new URL(raw);
        if (url.protocol !== 'https:') continue;
        urls.push(url.toString());
      } catch {
        // A citation without an https URL is not shown.
      }
      if (urls.length === MAX_SOURCES) return urls;
    }
  }
  return urls;
}

/** Drops tags and scripts so the model sees the words on the page. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

function isIp(host: string): boolean {
  if (host.includes(':')) return true;
  const parts = host.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part));
}

function isPrivateIp(ip: string): boolean {
  const value = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (value.includes(':')) {
    return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80');
  }
  const parts = value.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true;
  return false;
}

async function assertPublic(url: URL, resolve: (host: string) => Promise<string[]>): Promise<void> {
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw new ListingError('INVALID_URL');
  if (url.port !== '' && url.port !== '443') throw new ListingError('BLOCKED');
  const host = url.hostname.replace(/\.$/, '').toLowerCase();
  if (host === '' || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new ListingError('BLOCKED');
  }
  const addresses = isIp(host) ? [host] : await resolve(host);
  if (addresses.length === 0 || addresses.some((ip) => isPrivateIp(ip))) throw new ListingError('BLOCKED');
}

async function defaultResolve(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true });
  return records.map((record) => record.address);
}

async function readLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, MAX_BYTES);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const step = await reader.read();
    if (step.done) break;
    chunks.push(step.value);
    total += step.value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(Buffer.concat(chunks)).slice(0, MAX_BYTES);
}

async function fetchPage(start: URL, deps: Required<Pick<ListingReaderDeps, 'fetch' | 'resolve'>>): Promise<{ text: string; hints: string }> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(current, deps.resolve);
    const res = await deps.fetch(current, {
      redirect: 'manual',
      headers: { Accept: 'text/html, text/plain', 'User-Agent': 'TripWise/1.0 (CS 218 course project)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location || hop === MAX_REDIRECTS) throw new ListingError('UNREADABLE');
      current = new URL(location, current);
      continue;
    }
    if (!res.ok) throw new ListingError('UNREADABLE');
    const type = res.headers.get('content-type') ?? '';
    if (type !== '' && !type.includes('text/html') && !type.includes('text/plain') && !type.includes('application/xhtml')) {
      throw new ListingError('UNREADABLE');
    }
    const raw = await readLimited(res);
    const text = htmlToText(raw);
    if (text.length < 40) throw new ListingError('UNREADABLE');
    return { text, hints: pageHints(raw) };
  }
  throw new ListingError('UNREADABLE');
}

async function askModel(
  pageText: string,
  pageUrl: string,
  hints: string,
  converse: ListingReaderDeps['converse'],
): Promise<ListingFacts | null> {
  const modelId = process.env.MODEL_ID;
  const hintLine = hints === '' ? '' : `\n\nFacts found in the page source: ${hints}`;
  const user = `Listing URL: ${pageUrl}\n\n<page>\n${pageText}\n</page>${hintLine}`;
  if (converse) {
    const reply = await converse(SYSTEM, user);
    return reply ? parseListingFacts(reply) : null;
  }
  if (!modelId) return null;
  const client = new BedrockRuntimeClient({});
  const res = await client.send(
    new ConverseCommand({
      modelId,
      system: [{ text: SYSTEM }],
      messages: [{ role: 'user', content: [{ text: user }] }],
      inferenceConfig: { maxTokens: 400, temperature: 0 },
      toolConfig: { tools: [{ systemTool: { name: 'nova_grounding' } }] },
    }),
    { abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS) },
  );
  const blocks = (res.output?.message?.content ?? []) as CitedBlock[];
  const facts = parseListingFacts(blocks.map((part) => part.text ?? '').join(''));
  if (!facts) return null;
  const sources = webCitationUrls(blocks);
  if (sources.length > 0) facts.sources = sources;
  return facts;
}

/**
 * Opens an https listing and returns the name, address, sleeps count, and nightly price
 * written on the page. The caller saves the stay only after a person reviews the form.
 */
export async function readListing(listingUrl: string, deps: ListingReaderDeps = {}): Promise<ListingFacts> {
  let url: URL;
  try {
    url = new URL(listingUrl.trim());
  } catch {
    throw new ListingError('INVALID_URL');
  }
  const fetchImpl = deps.fetch ?? fetch;
  const resolve = deps.resolve ?? defaultResolve;
  let page: { text: string; hints: string };
  try {
    page = await fetchPage(url, { fetch: fetchImpl, resolve });
  } catch (err) {
    if (err instanceof ListingError) throw err;
    throw new ListingError('UNREADABLE');
  }
  try {
    const facts = await askModel(page.text, url.toString(), page.hints, deps.converse);
    if (!facts) throw new ListingError('UNREADABLE');
    return facts;
  } catch (err) {
    if (err instanceof ListingError) throw err;
    throw new ListingError('UNREADABLE');
  }
}
