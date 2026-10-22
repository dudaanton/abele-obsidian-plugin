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

  class MockMap {
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
  const popups: Popup[] = []
  class Popup {
    content: HTMLElement | null = null
    private readonly listeners = new Map<string, Array<() => void>>()
    constructor() {
      popups.push(this)
    }
    on(name: string, listener: () => void) {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
      return this
    }
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
    /** MapLibre's popup says `close` when it is taken off the map, by its button or by code. */
    remove() {
      for (const listener of this.listeners.get('close') ?? []) listener()
      return this
    }
  }

  return {
    popups,
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

// Preserve the same MapLibre test doubles while the production loader owns Blob imports.
vi.mock('@/helpers/loadMaplibre', () => ({ loadMaplibre: () => import('maplibre-gl') }))

import { mapFeatureInfo, renderMap } from '@/helpers/mapRender'
import { AbeleMapControls } from '@/helpers/mapControls'
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
  maplibre.markers.length = 0
  maplibre.popups.length = 0
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
  it('draws a pin with a glyph or a mark as a badge, and a plain one as a pin', async () => {
    await renderMap(document.createElement('div'), {
      ...config,
      points: [
        { lat: 10, lon: 20 },
        { lat: 11, lon: 21, icon: 'coffee' },
        { lat: 12, lon: 22, mark: '2' },
        { lat: 13, lon: 23, icon: 'no-such-glyph' },
      ],
    })
    const [plain, glyph, mark, unknown] = maplibre.markers.map((m) => m.options.element)
    expect(plain.className).toBe('abele-map__pin')
    expect(glyph.classList.contains('mod-badge')).toBe(true)
    expect(glyph.querySelector('svg')).not.toBeNull()
    expect(mark.classList.contains('mod-badge')).toBe(true)
    expect(mark.textContent).toBe('2')
    // A glyph Obsidian cannot draw would leave an empty disc; the plain pin says more.
    expect(unknown.className).toBe('abele-map__pin')
  })

  it('keeps the scale away from expanded bottom attribution on a narrow map', async () => {
    await renderMap(document.createElement('div'), config)
    const scale = maplibre.controls.find((control) => control instanceof maplibre.ScaleControl)
    expect(maplibre.positions.get(scale)).toBe('top-left')
  })

  // The plugin's own column of glyphs instead of MapLibre's buttons (zoom, north, location,
  // full screen), as the owner asked for maps in the plugin's look.
  it('lets a person zoom, reset direction, use fullscreen and read the scale', async () => {
    await renderMap(document.createElement('div'), config)

    expect(maplibre.controls.some((control) => control instanceof AbeleMapControls)).toBe(true)
    expect(maplibre.controls.some((control) => control instanceof maplibre.NavigationControl)).toBe(
      false
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

describe('the place popup', () => {
  const building = [
    { sourceLayer: 'building', layer: { id: 'building' }, properties: { render_height: 12 } },
  ]
  const press = () =>
    maplibre.handlers.get('click')?.({ point: {}, lngLat: { lat: 56.95, lng: 24.1 } })
  const settle = async () => {
    await Promise.resolve()
    await Promise.resolve()
  }

  it('says it is looking the place up, then fills the same popup with what was found', async () => {
    maplibre.setFeatures(building)
    let found: (place: unknown) => void = () => {}
    geo.reverseGeocode.mockReturnValue(new Promise((resolve) => (found = resolve)))
    const handle = await renderMap(document.createElement('div'), config)
    press()
    await Promise.resolve()

    const content = maplibre.popupContent!
    expect(content.classList.contains('abele-map__place')).toBe(true)
    expect(content.querySelector('strong')?.textContent).toBe('Looking up this place…')
    expect(content.querySelector('.abele-map__coordinates')?.textContent).toBe('56.95, 24.1')

    found({ name: 'Sample street 1', address: 'Sample town', kind: 'house' })
    await settle()
    expect(maplibre.popupContent).toBe(content)
    expect(content.querySelector('strong')?.textContent).toBe('Sample street 1')
    expect([...content.querySelectorAll(':scope > div')].map((d) => d.textContent)).toEqual([
      'Sample town',
      'house',
      '56.95, 24.1',
    ])
    handle.destroy()
  })

  it('says the details are unavailable when the lookup fails', async () => {
    maplibre.setFeatures(building)
    geo.reverseGeocode.mockRejectedValue(new Error('offline'))
    const handle = await renderMap(document.createElement('div'), config)
    press()
    await settle()

    expect(maplibre.popupContent?.querySelector('strong')?.textContent).toBe(
      'Place details unavailable'
    )
    handle.destroy()
  })

  it('takes its content out when it closes, when another place is pressed and with the map', async () => {
    maplibre.setFeatures([
      { sourceLayer: 'poi', layer: { id: 'poi_r20' }, properties: { name: 'Sample cafe' } },
    ])
    const handle = await renderMap(document.createElement('div'), config)

    press()
    await Promise.resolve()
    const first = maplibre.popupContent!
    expect(first.textContent).toContain('Sample cafe')
    maplibre.popups[0].remove()
    expect(first.childNodes).toHaveLength(0)

    press()
    await Promise.resolve()
    const second = maplibre.popupContent!
    press()
    await Promise.resolve()
    expect(second.childNodes).toHaveLength(0)

    const third = maplibre.popupContent!
    expect(third.textContent).toContain('Sample cafe')
    handle.destroy()
    expect(third.childNodes).toHaveLength(0)
  })
})
