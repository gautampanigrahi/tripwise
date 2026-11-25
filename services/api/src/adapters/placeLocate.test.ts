import { describe, expect, it } from 'vitest';
import { locatePlace, parseGeocode, parsePlaceQuery } from './placeLocate.js';

describe('parsePlaceQuery', () => {
  it('reads a JSON search string and ignores coordinates in the prose', () => {
    expect(parsePlaceQuery('{"query":"Balboa Park, San Diego"}')).toBe('Balboa Park, San Diego');
    expect(parsePlaceQuery('Sure: {"query":"La Jolla Cove, San Diego"}')).toBe('La Jolla Cove, San Diego');
    expect(parsePlaceQuery('I think it is at 32.7, -117.1')).toBeNull();
  });
});

describe('parseGeocode', () => {
  it('reads the first map hit', () => {
    expect(parseGeocode([{ lat: '32.73', lon: '-117.14' }])).toEqual({ lat: 32.73, lng: -117.14 });
    expect(parseGeocode([])).toBeNull();
    expect(parseGeocode([{ lat: '95', lon: '0' }])).toBeNull();
  });
});

describe('locatePlace', () => {
  it('searches the model query and stores the map coordinates', async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const q = new URL(String(url)).searchParams.get('q');
      const body = q === 'Balboa Park, San Diego' ? [{ lat: '32.731', lon: '-117.145' }] : [];
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const hit = await locatePlace(
      { stopName: 'the big park', destination: 'San Diego', notes: 'Balboa' },
      {
        converse: async () => '{"query":"Balboa Park, San Diego"}',
        fetch: fetchImpl as typeof fetch,
      },
    );
    expect(hit).toEqual({ lat: 32.731, lng: -117.145 });
  });

  it('searches the stop name when the model has nothing', async () => {
    const fetchImpl = async () => new Response(JSON.stringify([{ lat: '32.85', lon: '-117.27' }]), { status: 200 });
    const hit = await locatePlace(
      { stopName: 'La Jolla Cove', destination: 'San Diego' },
      { converse: async () => null, fetch: fetchImpl as typeof fetch },
    );
    expect(hit).toEqual({ lat: 32.85, lng: -117.27 });
  });
});
