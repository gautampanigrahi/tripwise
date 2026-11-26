import { describe, expect, it } from 'vitest';
import { ListingError, htmlToText, pageHints, parseListingFacts, readListing, webCitationUrls } from './listingRead.js';

const PAGE = `<html><head><style>body{color:red}</style><script>secret()</script></head>
<body><h1>The Cottage</h1><p>123 Coast Blvd, San Diego. Sleeps 4. $210 per night.</p></body></html>`;

function pageResponse(body: string, init: { status?: number; location?: string; type?: string } = {}): Response {
  const headers = new Headers();
  if (init.location) headers.set('location', init.location);
  if (init.type) headers.set('content-type', init.type);
  return new Response(body, { status: init.status ?? 200, headers });
}

describe('parseListingFacts', () => {
  it('keeps stated facts and drops a missing price', () => {
    expect(
      parseListingFacts('{"name":"The Cottage","address":"123 Coast Blvd","sleeps":4,"nightlyPrice":null}'),
    ).toEqual({ name: 'The Cottage', address: '123 Coast Blvd', sleeps: 4 });
  });

  it('returns null when the model names nothing', () => {
    expect(parseListingFacts('{"name":null,"address":null,"sleeps":null,"nightlyPrice":null}')).toBeNull();
  });

  it('reads a guest count and a dollar nightly rate', () => {
    expect(parseListingFacts('{"name":"The Cottage","address":null,"sleeps":"4 guests","nightlyPrice":"$210 per night"}')).toEqual({
      name: 'The Cottage',
      sleeps: 4,
      nightlyPrice: '210.00',
    });
  });
});

describe('pageHints', () => {
  it('reads a guest count and a displayed price out of escaped page JSON', () => {
    const html = '{\\"guestCountSummary\\":\\"This place has a maximum of 4 guests\\",\\"priceString\\":\\"$560.55\\"}';
    expect(pageHints(html)).toBe(
      'maximum of 4 guests. displayed price $560.55 (this may be a stay total, not the nightly rate)',
    );
  });
});

describe('webCitationUrls', () => {
  it('keeps https citations and drops anything else', () => {
    expect(
      webCitationUrls([
        { text: '{"name":"The Cottage"}' },
        {
          citationsContent: {
            citations: [
              { location: { web: { url: 'https://example.com/cottage' } } },
              { location: { web: { url: 'http://example.com/insecure' } } },
              { location: { web: { url: 'https://example.com/cottage' } } },
            ],
          },
        },
      ]),
    ).toEqual(['https://example.com/cottage']);
  });
});

describe('htmlToText', () => {
  it('drops scripts and tags', () => {
    expect(htmlToText(PAGE)).toBe('The Cottage 123 Coast Blvd, San Diego. Sleeps 4. $210 per night.');
    expect(htmlToText(PAGE)).not.toContain('secret');
  });
});

describe('readListing', () => {
  const resolve = async () => ['93.184.216.34'];

  it('sends the page text to the model and returns the facts', async () => {
    const seen: string[] = [];
    const facts = await readListing('https://example.com/cottage', {
      resolve,
      fetch: async () => pageResponse(PAGE, { type: 'text/html' }),
      converse: async (_system, user) => {
        seen.push(user);
        return '{"name":"The Cottage","address":"123 Coast Blvd, San Diego","sleeps":4,"nightlyPrice":"210"}';
      },
    });
    expect(facts).toEqual({
      name: 'The Cottage',
      address: '123 Coast Blvd, San Diego',
      sleeps: 4,
      nightlyPrice: '210.00',
    });
    expect(seen[0]).toContain('The Cottage');
    expect(seen[0]).not.toContain('secret');
  });

  it('rejects a non-https link, a private address, and a host that resolves privately', async () => {
    await expect(readListing('http://example.com', { resolve, fetch: async () => pageResponse(PAGE) })).rejects.toMatchObject({
      code: 'INVALID_URL',
    });
    await expect(readListing('https://127.0.0.1/stay', { resolve, fetch: async () => pageResponse(PAGE) })).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    await expect(readListing('https://169.254.169.254/latest', { resolve, fetch: async () => pageResponse(PAGE) })).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    await expect(
      readListing('https://example.com/stay', { resolve: async () => ['10.0.0.5'], fetch: async () => pageResponse(PAGE) }),
    ).rejects.toBeInstanceOf(ListingError);
  });

  it('follows an https redirect and stops a redirect onto a private host', async () => {
    const urls: string[] = [];
    const facts = await readListing('https://example.com/start', {
      resolve,
      fetch: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.endsWith('/start')) return pageResponse('', { status: 302, location: 'https://example.com/stay' });
        return pageResponse(PAGE, { type: 'text/html' });
      },
      converse: async () => '{"name":"The Cottage","sleeps":4,"nightlyPrice":"210.00","address":null}',
    });
    expect(urls).toEqual(['https://example.com/start', 'https://example.com/stay']);
    expect(facts.name).toBe('The Cottage');

    await expect(
      readListing('https://example.com/start', {
        resolve: async (host) => (host === 'evil.internal' ? ['10.1.1.1'] : ['93.184.216.34']),
        fetch: async () => pageResponse('', { status: 302, location: 'https://evil.internal/stay' }),
        converse: async () => '{"name":"Nope"}',
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
  });
});
