/**
 * The map tools: `geocode`, `places`, `route`.
 *
 * All three talk to services that are free and keyless — Photon for search, Valhalla for
 * routing, OSRM when Valhalla is down — which is the whole reason they can be on by default.
 * What is guarded here is the part a user would feel: the coordinates come back in the format
 * a note stores them in, a place search is sorted by distance from where it was asked about,
 * and a routing host that falls over is answered by the other one rather than by an error.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createGeocodeTool, createPlacesTool, createRouteTool } from '@/ai/tools/GeoTools'
import { parseLatLon, formatLatLon, resetGeoCache, setGeoPacing } from '@/services/GeoService'

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }))

vi.mock('obsidian', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../mocks/obsidian')),
  requestUrl,
}))

const feature = (name: string, lat: number, lon: number, extra: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: {
    name,
    osm_key: 'amenity',
    osm_value: 'cafe',
    osm_type: 'N',
    osm_id: 1,
    street: 'Brīvības iela',
    housenumber: '1',
    city: 'Rīga',
    country: 'Latvija',
    ...extra,
  },
})

const photonAnswer = (features: unknown[]) => ({
  status: 200,
  json: { type: 'FeatureCollection', features },
})

const execute = (
  tool: { execute: (id: string, p: Record<string, unknown>) => Promise<any> },
  params: Record<string, unknown>
) => tool.execute('call-1', params)

const run = async (
  tool: { execute: (id: string, p: Record<string, unknown>) => Promise<any> },
  params: Record<string, unknown>
) => {
  const result = await execute(tool, params)
  return result.content[0].text as string
}

const urlOf = (call: number) => requestUrl.mock.calls[call][0].url as string

beforeEach(() => {
  requestUrl.mockReset()
  resetGeoCache()
  // The services ask for about a request a second, and the tools hold to it. A test that
  // waited for real would spend its time asleep.
  setGeoPacing(0)
})

describe('reading coordinates', () => {
  it('takes the shapes a note writes them in', () => {
    expect(parseLatLon('56.9496, 24.1052')).toEqual({ lat: 56.9496, lon: 24.1052 })
    expect(parseLatLon('  -33.86 151.21 ')).toEqual({ lat: -33.86, lon: 151.21 })
    expect(parseLatLon('56.9496;24.1052')).toEqual({ lat: 56.9496, lon: 24.1052 })
  })

  it('refuses what is not a pair of coordinates', () => {
    expect(parseLatLon('Riga')).toBeNull()
    expect(parseLatLon('91, 24')).toBeNull()
    expect(parseLatLon('56.9, 200')).toBeNull()
  })

  it('writes them back the way a note stores them', () => {
    expect(formatLatLon(56.94961234, 24.10521234)).toBe('56.94961, 24.10521')
  })
})

describe('geocode', () => {
  it('asks Photon for the place and answers with coordinates a note can hold', async () => {
    requestUrl.mockResolvedValue(photonAnswer([feature('Rīgas Doms', 56.9496, 24.1052)]))

    const text = await run(createGeocodeTool(), { query: 'Rīgas Doms' })

    expect(urlOf(0)).toContain('photon.komoot.io/api')
    expect(urlOf(0)).toContain(`q=${new URLSearchParams({ q: 'Rīgas Doms' }).toString().slice(2)}`)
    expect(text).toContain('Rīgas Doms')
    expect(text).toContain('56.9496, 24.1052')
    expect(text).toContain('Brīvības iela 1')
    expect(text).toContain('coordinates: "56.9496, 24.1052"')
  })

  it('turns coordinates back into an address when given them instead', async () => {
    requestUrl.mockResolvedValue(photonAnswer([feature('Rātslaukums', 56.9475, 24.1062)]))

    const text = await run(createGeocodeTool(), { lat: 56.9475, lon: 24.1062 })

    expect(urlOf(0)).toContain('photon.komoot.io/reverse')
    expect(urlOf(0)).toContain('lat=56.9475')
    expect(urlOf(0)).toContain('lon=24.1062')
    expect(text).toContain('Rātslaukums')
  })

  /** `lang: ru` used to come back as «Photon answered 400» and nothing else. */
  it('drops a language the host does not speak instead of failing the call', async () => {
    requestUrl.mockResolvedValue(photonAnswer([feature('Rīgas Doms', 56.9496, 24.1052)]))

    const text = await run(createGeocodeTool(), { query: 'Rīgas Doms', lang: 'ru' })

    expect(urlOf(0)).not.toContain('lang=')
    expect(text).toContain('Rīgas Doms')
  })

  it('passes on a language it does speak', async () => {
    requestUrl.mockResolvedValue(photonAnswer([feature('Riga Cathedral', 56.9496, 24.1052)]))

    await run(createGeocodeTool(), { query: 'Rīgas Doms', lang: 'en' })

    expect(urlOf(0)).toContain('lang=en')
  })

  it('says plainly when nothing was found rather than returning an empty list', async () => {
    requestUrl.mockResolvedValue(photonAnswer([]))

    expect(await run(createGeocodeTool(), { query: 'qwertyuiop' })).toContain('Nothing found')
  })

  it('asks once for the same query and answers the repeat from what it already has', async () => {
    requestUrl.mockResolvedValue(photonAnswer([feature('Rīgas Doms', 56.9496, 24.1052)]))

    await run(createGeocodeTool(), { query: 'Rīgas Doms' })
    await run(createGeocodeTool(), { query: 'Rīgas Doms' })

    expect(requestUrl).toHaveBeenCalledTimes(1)
  })
})

const overpassAnswer = (elements: unknown[]) => ({ status: 200, json: { elements } })

const node = (name: string, lat: number, lon: number) => ({
  type: 'node',
  lat,
  lon,
  tags: { name, amenity: 'cafe', 'addr:street': 'Brīvības iela', 'addr:housenumber': '1' },
})

describe('places', () => {
  it('asks the map itself for a category, around the point, and sorts by distance', async () => {
    requestUrl.mockImplementation(async (options: { url: string }) => {
      if (options.url.includes('photon')) {
        return photonAnswer([feature('Rīga', 56.9496, 24.1052, { osm_value: 'city' })])
      }
      return overpassAnswer([
        node('Far Coffee', 56.965, 24.1052),
        node('Near Coffee', 56.9505, 24.1052),
      ])
    })

    const text = await run(createPlacesTool(), { query: 'cafe', near: 'Riga' })

    const query = decodeURIComponent(urlOf(1))
    expect(urlOf(1)).toContain('overpass-api.de')
    expect(query).toContain('around:2000,56.9496,24.1052')
    expect(query).toContain('["amenity"="cafe"]')
    expect(text.indexOf('Near Coffee')).toBeLessThan(text.indexOf('Far Coffee'))
    expect(text).toContain('km')
  })

  it('takes coordinates for the centre without going to look them up', async () => {
    requestUrl.mockResolvedValue(overpassAnswer([node('Near Coffee', 56.9505, 24.1052)]))

    await run(createPlacesTool(), { query: 'cafe', near: '56.9496, 24.1052' })

    expect(requestUrl).toHaveBeenCalledTimes(1)
  })

  it('names an unnamed place by what it is rather than dropping it', async () => {
    requestUrl.mockResolvedValue(
      overpassAnswer([{ type: 'node', lat: 56.9505, lon: 24.1052, tags: { amenity: 'pharmacy' } }])
    )

    const text = await run(createPlacesTool(), { query: 'pharmacy', near: '56.9496, 24.1052' })

    expect(text).toContain('pharmacy')
  })

  it('widens the circle once when the first one came back empty', async () => {
    requestUrl.mockResolvedValue(overpassAnswer([]))

    await run(createPlacesTool(), { query: 'cafe', near: '56.9496, 24.1052' })

    expect(decodeURIComponent(urlOf(0))).toContain('around:2000')
    expect(decodeURIComponent(urlOf(1))).toContain('around:15000')
  })

  it('keeps to the radius it was given rather than widening past it', async () => {
    requestUrl.mockResolvedValue(overpassAnswer([]))

    await run(createPlacesTool(), { query: 'cafe', near: '56.9496, 24.1052', radius_km: 1 })

    expect(decodeURIComponent(urlOf(0))).toContain('around:1000')
    expect(requestUrl.mock.calls.filter((c) => c[0].url.includes('overpass'))).toHaveLength(1)
  })

  it('searches by name for free text the map has no tag for', async () => {
    requestUrl.mockResolvedValue(photonAnswer([feature('Trattoria Rossa', 56.9505, 24.1052)]))

    const text = await run(createPlacesTool(), {
      query: 'Trattoria Rossa',
      near: '56.9496, 24.1052',
    })

    expect(urlOf(0)).toContain('photon.komoot.io')
    expect(text).toContain('Trattoria Rossa')
  })

  /** «Italian restaurant» used to be read as a name and answered with one in Tehran. */
  it('reads the category out of a longer question and ranks the rest of it first', async () => {
    requestUrl.mockResolvedValue(
      overpassAnswer([
        { ...node('Plain Bistro', 56.9498, 24.1052), tags: { name: 'Plain Bistro' } },
        {
          ...node('Osteria', 56.96, 24.1052),
          tags: { name: 'Osteria', cuisine: 'italian' },
        },
      ])
    )

    const text = await run(createPlacesTool(), {
      query: 'Italian restaurant',
      near: '56.9496, 24.1052',
    })

    expect(decodeURIComponent(urlOf(0))).toContain('["amenity"="restaurant"]')
    // The italian one is further away and still comes first.
    expect(text.indexOf('Osteria')).toBeLessThan(text.indexOf('Plain Bistro'))
  })

  it('drops a name match that is in another country', async () => {
    requestUrl.mockResolvedValue(
      photonAnswer([
        feature('Italian Restaurant', 35.76, 51.41),
        feature('Trattoria Rossa', 56.9505, 24.1052),
      ])
    )

    const text = await run(createPlacesTool(), {
      query: 'Trattoria Rossa',
      near: '56.9496, 24.1052',
    })

    expect(text).toContain('Trattoria Rossa')
    expect(text).not.toContain('Italian Restaurant')
  })

  it('searches names when the map query fails outright', async () => {
    requestUrl.mockImplementation(async (options: { url: string }) => {
      if (options.url.includes('overpass')) return { status: 504, text: 'busy', json: null }
      return photonAnswer([feature('Cafe Barev', 56.9505, 24.1052)])
    })

    const text = await run(createPlacesTool(), { query: 'cafe', near: '56.9496, 24.1052' })

    expect(text).toContain('Cafe Barev')
  })

  it('falls back to searching names when the map has nothing tagged there', async () => {
    requestUrl.mockImplementation(async (options: { url: string }) => {
      if (options.url.includes('overpass')) return overpassAnswer([])
      return photonAnswer([feature('Cafe Barev', 56.9505, 24.1052)])
    })

    const text = await run(createPlacesTool(), { query: 'cafe', near: '56.9496, 24.1052' })

    expect(text).toContain('Cafe Barev')
  })
})

describe('talking to hosts that are free and busy', () => {
  it('names itself, which Overpass refuses a request without', async () => {
    requestUrl.mockResolvedValue(overpassAnswer([node('Near Coffee', 56.9505, 24.1052)]))

    await run(createPlacesTool(), { query: 'cafe', near: '56.9496, 24.1052' })

    const headers = requestUrl.mock.calls[0][0].headers as Record<string, string>
    expect(headers['User-Agent']).toContain('Abele')
  })

  it('asks a busy host a second time before giving up on it', async () => {
    let calls = 0
    requestUrl.mockImplementation(async () => {
      calls += 1
      return calls === 1
        ? { status: 504, text: 'busy', json: null }
        : overpassAnswer([node('Near Coffee', 56.9505, 24.1052)])
    })

    const text = await run(createPlacesTool(), { query: 'cafe', near: '56.9496, 24.1052' })

    expect(calls).toBe(2)
    expect(text).toContain('Near Coffee')
  })

  it('does not ask twice when the host said no rather than not now', async () => {
    let calls = 0
    requestUrl.mockImplementation(async () => {
      calls += 1
      return { status: 400, text: 'bad query', json: null }
    })

    await expect(
      createPlacesTool().execute('1', { query: 'cafe', near: '56.9496, 24.1052' })
    ).rejects.toThrow(/400/)

    // One rejected map query, then the name search that also failed — not two of each.
    expect(calls).toBe(2)
  })
})

describe('route', () => {
  const valhallaAnswer = {
    status: 200,
    json: {
      trip: {
        summary: { length: 8.3, time: 907 },
        legs: [
          {
            shape: 'abcdef',
            maneuvers: [
              { instruction: 'Walk west on the walkway.', length: 0.12, time: 90 },
              { instruction: 'Turn right onto Brīvības iela.', length: 8.18, time: 817 },
            ],
          },
        ],
      },
    },
  }

  it('routes between two points without geocoding them, and reports distance and time', async () => {
    requestUrl.mockResolvedValue(valhallaAnswer)

    const text = await run(createRouteTool(), {
      from: '56.9496, 24.1052',
      to: '56.9510, 24.1940',
      mode: 'walk',
    })

    expect(urlOf(0)).toContain('valhalla1.openstreetmap.de')
    expect(decodeURIComponent(urlOf(0))).toContain('"costing":"pedestrian"')
    expect(text).toContain('8.3 km')
    expect(text).toContain('15 min')
    expect(text).toContain('Turn right onto Brīvības iela.')
  })

  it('geocodes an address given instead of coordinates', async () => {
    requestUrl.mockImplementation(async (options: { url: string }) => {
      if (options.url.includes('photon')) {
        return photonAnswer([feature('Rīgas Doms', 56.9496, 24.1052)])
      }
      return valhallaAnswer
    })

    const text = await run(createRouteTool(), { from: 'Rīgas Doms', to: '56.9510, 24.1940' })

    expect(urlOf(0)).toContain('photon.komoot.io')
    expect(text).toContain('Rīgas Doms')
  })

  /**
   * A point passed through used to be announced as «your destination is on the left», with
   * the numbering carrying straight on into the next stretch.
   */
  it('hands the chat the route line and its pins to draw', async () => {
    requestUrl.mockResolvedValue({
      status: 200,
      json: {
        trip: {
          summary: { length: 10, time: 1200 },
          legs: [
            {
              shape: '_p~iF~ps|U_ulLnnqC',
              summary: { length: 10, time: 1200 },
              maneuvers: [],
            },
          ],
        },
      },
    })

    const result = await execute(createRouteTool(), {
      from: '56.9496, 24.1052',
      to: '56.9510, 24.1940',
    })

    expect(result.details.map).toMatchObject({
      route: '_p~iF~ps|U_ulLnnqC',
      routePrecision: 6,
      points: [
        { lat: 56.9496, lon: 24.1052 },
        { lat: 56.951, lon: 24.194 },
      ],
    })
  })

  it('names each point it passes through and counts the steps to it separately', async () => {
    requestUrl.mockResolvedValue({
      status: 200,
      json: {
        trip: {
          summary: { length: 10, time: 1200 },
          legs: [
            {
              shape: 'aaa',
              summary: { length: 4, time: 600 },
              maneuvers: [{ instruction: 'Drive north.', length: 4, time: 600 }],
            },
            {
              shape: 'bbb',
              summary: { length: 6, time: 600 },
              maneuvers: [{ instruction: 'Drive east.', length: 6, time: 600 }],
            },
          ],
        },
      },
    })

    const text = await run(createRouteTool(), {
      from: '56.9496, 24.1052',
      via: ['56.9600, 24.1052'],
      to: '56.9510, 24.1940',
    })

    expect(text).toContain('Via 1: 56.96, 24.1052')
    expect(text).toContain('To via 1')
    expect(text).toContain('To the destination')
    // Each stretch is counted from one, so «1.» appears in both.
    expect(text.match(/^1\. /gm)?.length).toBe(2)
  })

  it('falls back to OSRM when the Valhalla host is having a bad day', async () => {
    requestUrl.mockImplementation(async (options: { url: string }) => {
      if (options.url.includes('valhalla')) return { status: 503, text: 'unavailable', json: null }
      return {
        status: 200,
        json: {
          code: 'Ok',
          routes: [
            {
              distance: 8313.9,
              duration: 907.3,
              legs: [
                {
                  steps: [
                    {
                      name: 'Brīvības iela',
                      distance: 8313.9,
                      maneuver: { type: 'turn', modifier: 'right' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      }
    })

    const text = await run(createRouteTool(), { from: '56.9496, 24.1052', to: '56.9510, 24.1940' })

    const tried = requestUrl.mock.calls.map((call) => call[0].url as string)
    expect(tried.find((url) => url.includes('routed-'))).toContain('routed-car')
    expect(text).toContain('8.3 km')
    expect(text).toContain('Brīvības iela')
  })

  it('says both hosts refused rather than pretending there is no route', async () => {
    requestUrl.mockResolvedValue({ status: 500, text: 'boom', json: null })

    await expect(
      createRouteTool().execute('1', { from: '56.9, 24.1', to: '56.95, 24.19' })
    ).rejects.toThrow(/rout/i)
  })
})
