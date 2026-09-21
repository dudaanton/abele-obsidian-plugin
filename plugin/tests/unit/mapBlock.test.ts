/**
 * What a map is before anything draws it.
 *
 * The same reader serves an `abele-map` block someone typed and the route a tool handed the
 * chat, so the forgiving parts are deliberate: coordinates written any of the ways a person
 * writes them, a block still being typed showing an empty map rather than a stack trace.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MAP_HEIGHT,
  decodePolyline,
  mapBounds,
  parseMapBlock,
  parsePoint,
} from '@/helpers/mapConfig'

const config = (source: string) => {
  const parsed = parseMapBlock(source)
  if ('error' in parsed) throw new Error(parsed.error)
  return parsed
}

describe('reading a point', () => {
  it('takes the forms a note and a person write', () => {
    expect(parsePoint('56.9496, 24.1052')).toMatchObject({ lat: 56.9496, lon: 24.1052 })
    expect(parsePoint('56.9496 24.1052')).toMatchObject({ lat: 56.9496, lon: 24.1052 })
    expect(parsePoint([56.9496, 24.1052])).toMatchObject({ lat: 56.9496, lon: 24.1052 })
    expect(parsePoint({ lat: 56.9496, lon: 24.1052 })).toMatchObject({ lat: 56.9496 })
  })

  /** A vault that writes `coordinates:` should not have to be rewritten to be shown. */
  it('takes a row that names the property its vault uses', () => {
    expect(parsePoint({ coordinates: '56.9496, 24.1052', label: 'Home' })).toMatchObject({
      lat: 56.9496,
      lon: 24.1052,
      label: 'Home',
    })
    expect(parsePoint({ location: [56.9496, 24.1052], name: 'Home' })).toMatchObject({
      label: 'Home',
    })
  })

  it('refuses what is not a position', () => {
    expect(parsePoint('Riga')).toBeNull()
    expect(parsePoint('91, 24')).toBeNull()
    expect(parsePoint(null)).toBeNull()
  })
})

describe('reading a line', () => {
  /** Valhalla encodes at six decimals and OSRM at five: read wrong, it is another continent. */
  it('decodes a polyline at the precision it was encoded with', () => {
    const encoded = '_p~iF~ps|U_ulLnnqC'

    const five = decodePolyline(encoded, 5)
    const six = decodePolyline(encoded, 6)

    expect(five[0].lat).toBeCloseTo(38.5, 1)
    expect(six[0].lat).toBeCloseTo(3.85, 2)
  })
})

describe('reading a block', () => {
  it('reads points, a centre and a height', () => {
    const map = config(`
height: 200
zoom: 12
center: 56.9496, 24.1052
points:
  - 56.9496, 24.1052
  - location: 56.951, 24.194
    label: Station
`)

    expect(map.points).toHaveLength(2)
    expect(map.points[1].label).toBe('Station')
    expect(map.center).toMatchObject({ lat: 56.9496 })
    expect(map.height).toBe(200)
    expect(map.zoom).toBe(12)
  })

  it('stands a block up with nothing but its defaults', () => {
    const map = config('points:\n  - 56.9496, 24.1052\n')

    expect(map.height).toBe(DEFAULT_MAP_HEIGHT)
    expect(map.interactive).toBe(true)
    expect(map.lines).toEqual([])
  })

  it('draws a route as a line, one per leg of the journey', () => {
    const map = config('route: "_p~iF~ps|U_ulLnnqC;_p~iF~ps|U_ulLnnqC"\nroutePrecision: 5\n')

    expect(map.lines).toHaveLength(2)
    expect(map.lines[0].points.length).toBeGreaterThan(1)
  })

  it('says what is wrong instead of throwing at a half-typed block', () => {
    expect(parseMapBlock('points: [')).toMatchObject({ error: expect.stringContaining('YAML') })
    expect(parseMapBlock('zoom: 12')).toMatchObject({ error: expect.stringContaining('Nothing') })
  })
})

describe('what has to fit in view', () => {
  it('covers the pins and every point of the line', () => {
    const map = config('points:\n  - 56.9, 24.1\n  - 57.1, 24.4\n')

    expect(mapBounds(map)).toEqual({
      min: { lat: 56.9, lon: 24.1 },
      max: { lat: 57.1, lon: 24.4 },
    })
  })

  it('has nothing to fit when there is only a centre', () => {
    expect(mapBounds(config('center: 56.9, 24.1'))).toBeNull()
  })
})
