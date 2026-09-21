/**
 * The parts of an interactive map that are not the route itself: controls and the information
 * behind the buildings and places already drawn by the base style.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVault } from '../helpers/testEnv'

const geo = vi.hoisted(() => ({
  reverseGeocode: vi.fn(),
}))

vi.mock('@/services/GeoService', () => ({
  formatLatLon: (lat: number, lon: number) => `${lat}, ${lon}`,
  reverseGeocode: geo.reverseGeocode,
}))

const maplibre = vi.hoisted(() => {
  const controls: unknown[] = []
  const handlers = new Map<string, (event: any) => void>()
  let features: unknown[] = []
  let popupContent: HTMLElement | null = null

  class MockMap {
    addControl(control: unknown) {
      controls.push(control)
      return this
    }
    on(name: string, handler: (event: any) => void) {
      handlers.set(name, handler)
      return this
    }
    queryRenderedFeatures() {
      return features
    }
    getCanvas() {
      return { style: { cursor: '' } }
    }
    remove() {}
  }

  class NavigationControl {}
  class FullscreenControl {}
  class ScaleControl {}
  class Marker {}
  class Popup {
    content: HTMLElement | null = null
    setLngLat() {
      return this
    }
    setDOMContent(content: HTMLElement) {
      this.content = content
      popupContent = content
      return this
    }
    addTo() {
      return this
    }
    remove() {}
  }

  return {
    controls,
    handlers,
    get popupContent() {
      return popupContent
    },
    setFeatures(next: unknown[]) {
      features = next
    },
    Map: MockMap,
    NavigationControl,
    FullscreenControl,
    ScaleControl,
    Marker,
    Popup,
  }
})

vi.mock('maplibre-gl', () => ({
  Map: maplibre.Map,
  NavigationControl: maplibre.NavigationControl,
  FullscreenControl: maplibre.FullscreenControl,
  ScaleControl: maplibre.ScaleControl,
  Marker: maplibre.Marker,
  Popup: maplibre.Popup,
  getWorkerUrl: () => 'worker.js',
  setWorkerUrl: vi.fn(),
}))

import { mapFeatureInfo, renderMap } from '@/helpers/mapRender'

const config = {
  points: [],
  lines: [],
  center: { lat: 56.9496, lon: 24.1052 },
  height: 320,
  interactive: true,
}

beforeEach(() => {
  useVault([])
  maplibre.controls.length = 0
  maplibre.handlers.clear()
  maplibre.setFeatures([])
  geo.reverseGeocode.mockReset()
})

describe('map controls', () => {
  it('lets a person zoom, reset direction, use fullscreen and read the scale', async () => {
    await renderMap(document.createElement('div'), config)

    expect(maplibre.controls.some((control) => control instanceof maplibre.NavigationControl)).toBe(
      true
    )
    expect(maplibre.controls.some((control) => control instanceof maplibre.FullscreenControl)).toBe(
      true
    )
    expect(maplibre.controls.some((control) => control instanceof maplibre.ScaleControl)).toBe(true)
  })
})

describe('a place already drawn by the base map', () => {
  it('turns its tile properties into readable popup information', () => {
    expect(
      mapFeatureInfo({
        sourceLayer: 'poi',
        properties: {
          name: 'Coffee House',
          class: 'cafe',
          'addr:street': 'Brīvības iela',
          'addr:housenumber': '12',
        },
      })
    ).toEqual({ title: 'Coffee House', details: ['Brīvības iela 12', 'cafe'] })
  })

  it('opens those details when the establishment is pressed', async () => {
    maplibre.setFeatures([
      {
        sourceLayer: 'poi',
        layer: { id: 'poi_r20' },
        properties: { name: 'Coffee House', class: 'cafe' },
      },
    ])
    await renderMap(document.createElement('div'), config)

    maplibre.handlers.get('click')?.({ point: {}, lngLat: { lat: 56.95, lng: 24.1 } })
    await Promise.resolve()

    expect(maplibre.popupContent?.textContent).toContain('Coffee House')
    expect(maplibre.popupContent?.textContent).toContain('cafe')
    expect(geo.reverseGeocode).not.toHaveBeenCalled()
  })

  it('resolves an unnamed building to the address at the clicked point', async () => {
    maplibre.setFeatures([
      { sourceLayer: 'building', layer: { id: 'building' }, properties: { render_height: 12 } },
    ])
    geo.reverseGeocode.mockResolvedValue({
      name: 'Brīvības iela 12',
      address: 'Centrs, Rīga',
      kind: 'house',
    })
    await renderMap(document.createElement('div'), config)

    maplibre.handlers.get('click')?.({ point: {}, lngLat: { lat: 56.95, lng: 24.1 } })
    await Promise.resolve()
    await Promise.resolve()

    expect(geo.reverseGeocode).toHaveBeenCalledWith({ lat: 56.95, lon: 24.1 })
    expect(maplibre.popupContent?.textContent).toContain('Brīvības iela 12')
    expect(maplibre.popupContent?.textContent).toContain('Centrs, Rīga')
  })

  it('leaves an unnamed building for reverse geocoding at the clicked point', () => {
    expect(
      mapFeatureInfo({ sourceLayer: 'building', properties: { render_height: 12 } })
    ).toBeNull()
  })
})
