import { describe, expect, it } from 'vitest'
import {
  coordinates,
  camera,
  backgroundStyle,
  writableCoordinateKey,
  wrapLongitude,
} from '@/maps/core/model'

describe('Bases map compatibility, upstream 0.2.2', () => {
  it('stores valid coordinates when a repeated world is clicked at low zoom', () => {
    expect(wrapLongitude(240)).toBe(-120)
    expect(wrapLongitude(-540)).toBe(-180)
    expect(wrapLongitude(180)).toBe(180)
    expect(wrapLongitude(0)).toBe(0)
  })
  it.fails(
    'BUG: strict coordinate rejection differs from the upstream numeric-prefix grammar',
    () => {
      expect(coordinates('0, 12')).toEqual({ point: { lat: 0, lon: 12 } })
      expect(coordinates([12, 0])).toEqual({ point: { lat: 12, lon: 0 } })
      for (const value of [null, '', ', 2', ['', 2], '12x, 2', '91, 0', [0, Infinity], [1, 2, 3]])
        expect(coordinates(value)).toHaveProperty('reason')
    }
  )
  it('matches upstream numeric prefixes and extra list members while rejecting missing and invalid points', () => {
    expect(coordinates('12x, 2')).toEqual({ point: { lat: 12, lon: 2 } })
    expect(coordinates([1, 2, 3])).toEqual({ point: { lat: 1, lon: 2 } })
    expect(coordinates('0, 0')).toEqual({ point: { lat: 0, lon: 0 } })
    for (const v of [null, '', ', 2', ['', 2], '91, 0', [0, Infinity]])
      expect(coordinates(v)).toHaveProperty('reason')
  })
  it('respects explicit camera, useful single-point zoom, limits and history', () => {
    expect(camera([{ lat: 1, lon: 2 }], { center: '0, 0', zoom: 0 })).toMatchObject({
      center: [0, 0],
      zoom: 0,
    })
    expect(camera([{ lat: 1, lon: 2 }], {})).toMatchObject({ center: [2, 1], zoom: 15 })
    expect(camera([], { zoom: 30, maxZoom: 18 })).toMatchObject({ zoom: 18 })
    expect(camera([], {}, { center: [5, 6], zoom: 7 })).toMatchObject({ center: [5, 6], zoom: 7 })
    expect(
      camera(
        [
          { lat: 1, lon: 2 },
          { lat: 3, lon: 4 },
        ],
        {}
      )
    ).toHaveProperty('bounds')
  })
  it('draws every raster address as a layer', () => {
    expect(backgroundStyle([])).toBe('https://tiles.openfreemap.org/styles/bright')
    expect(backgroundStyle(['https://example.test/{x}/{y}.png'])).toMatchObject({
      version: 8,
      layers: [expect.objectContaining({ type: 'raster' })],
    })
    const style = backgroundStyle([
      'https://example.test/{z}/{x}/{y}.png',
      'https://example.test/overlay/{z}/{x}/{y}.png',
    ])
    expect(typeof style).toBe('object')
    if (typeof style !== 'string') expect(style.layers).toHaveLength(2)
    expect(backgroundStyle(['https://example.test/style.json'])).toBe(
      'https://example.test/style.json'
    )
  })
  it('never treats formula outputs as writable note properties', () => {
    expect(writableCoordinateKey('note.position')).toBe('position')
    expect(writableCoordinateKey('formula.position')).toBeNull()
    expect(writableCoordinateKey('file.name')).toBeNull()
  })
})
