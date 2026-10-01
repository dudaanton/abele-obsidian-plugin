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
  const positions = new Map<unknown, string>()
  const handlers = new Map<string, (event: any) => void>()
  let features: unknown[] = []
  let popupContent: HTMLElement | null = null
  const construct = vi.fn()

  class MockMap {
    constructor(options: { container: HTMLElement }) {
      construct(options.container.ownerDocument)
    }
    addControl(control: unknown, position: string) {
      controls.push(control)
      positions.set(control, position)
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
  const markers: Marker[] = []
  class Marker {
    togglePopup = vi.fn()
    constructor(readonly options: { element: HTMLElement }) {
      markers.push(this)
    }
    setLngLat() {
      return this
    }
    addTo() {
      return this
    }
    setPopup() {
      return this
    }
  }
  class Popup {
    content: HTMLElement | null = null
    setLngLat() {
      return this
    }
    setText() {
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
    construct,
    markers,
    controls,
    positions,
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
import { MapLocationControl } from '@/helpers/mapLocationControl'

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
  maplibre.positions.clear()
  maplibre.handlers.clear()
  maplibre.setFeatures([])
  geo.reverseGeocode.mockReset()
  maplibre.construct.mockReset()
  maplibre.markers.length = 0
})

describe('map stylesheet lifetime', () => {
  const styles = (doc: Document) => doc.querySelectorAll('style[data-abele-map]')

  it('installs CSS before construction, only in the map document, and shares it between maps', async () => {
    const doc = document.implementation.createHTMLDocument()
    const other = document.implementation.createHTMLDocument()
    expect(styles(doc)).toHaveLength(0)
    maplibre.construct.mockImplementation((owner: Document) => {
      expect(styles(owner)).toHaveLength(1)
      expect(styles(owner)[0].textContent).toContain('.maplibregl-map')
    })

    const first = await renderMap(doc.createElement('div'), config)
    expect(styles(other)).toHaveLength(0)
    const second = await renderMap(doc.createElement('div'), config)
    const popout = await renderMap(other.createElement('div'), config)
    expect(styles(doc)).toHaveLength(1)
    expect(styles(other)).toHaveLength(1)
    first.destroy()
    expect(styles(doc)).toHaveLength(1)
    second.destroy()
    expect(styles(doc)).toHaveLength(0)
    expect(styles(other)).toHaveLength(1)
    popout.destroy()
    expect(styles(other)).toHaveLength(0)
  })

  it('does not retain styles if WebGL construction fails', async () => {
    const doc = document.implementation.createHTMLDocument()
    maplibre.construct.mockImplementation(() => {
      throw new Error('WebGL unavailable')
    })
    await expect(renderMap(doc.createElement('div'), config)).rejects.toThrow('WebGL unavailable')
    expect(styles(doc)).toHaveLength(0)
  })
})

describe('map controls', () => {
  it('toggles a pin popup without forwarding the press to the base-map lookup', async () => {
    const handle = await renderMap(document.createElement('div'), {
      ...config,
      points: [{ lat: 10, lon: 20, label: 'Sample point' }],
    })
    const marker = maplibre.markers[0]
    const parent = document.createElement('div')
    parent.appendChild(marker.options.element)
    const baseClick = vi.fn()
    parent.addEventListener('click', baseClick)
    marker.options.element.click()
    expect(marker.togglePopup).toHaveBeenCalledOnce()
    expect(baseClick).not.toHaveBeenCalled()
    handle.destroy()
  })
  it('keeps the scale away from expanded bottom attribution on a narrow map', async () => {
    await renderMap(document.createElement('div'), config)
    const scale = maplibre.controls.find((control) => control instanceof maplibre.ScaleControl)
    expect(maplibre.positions.get(scale)).toBe('top-left')
  })

  it('lets a person zoom, reset direction, use fullscreen and read the scale', async () => {
    await renderMap(document.createElement('div'), config)

    expect(maplibre.controls.some((control) => control instanceof maplibre.NavigationControl)).toBe(
      true
    )
    expect(maplibre.controls.some((control) => control instanceof maplibre.FullscreenControl)).toBe(
      true
    )
    expect(maplibre.controls.some((control) => control instanceof maplibre.ScaleControl)).toBe(true)
    expect(maplibre.controls.some((control) => control instanceof MapLocationControl)).toBe(true)
  })
})

describe('a non-interactive map', () => {
  it('does not offer location or navigation controls', async () => {
    await renderMap(document.createElement('div'), { ...config, interactive: false })
    expect(maplibre.controls).toEqual([])
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
