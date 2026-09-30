import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapLocationControl } from '@/helpers/mapLocationControl'

const location = vi.hoisted(() => ({ get: vi.fn(), notices: [] as string[] }))
vi.mock('@/services/DeviceLocation', () => ({ getDeviceLocation: location.get }))
vi.mock('obsidian', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../mocks/obsidian')),
  Notice: class {
    constructor(message: string) {
      location.notices.push(message)
    }
  },
}))

const markers: FakeMarker[] = []
class FakeMarker {
  coordinates: number[] = []
  removed = false
  constructor(public options: { element: HTMLElement }) {
    markers.push(this)
  }
  setLngLat(coordinates: number[]) {
    this.coordinates = coordinates
    return this
  }
  addTo() {
    return this
  }
  remove() {
    this.removed = true
  }
}
const library = {
  Marker: FakeMarker,
  LngLat: class {
    constructor(
      public lng: number,
      public lat: number
    ) {}
  },
  LngLatBounds: {
    fromLngLat: ({ lng, lat }: { lng: number; lat: number }, radius: number) => ({
      lon: lng,
      lat,
      radius,
    }),
  },
  MercatorCoordinate: {
    fromLngLat: () => ({ meterInMercatorCoordinateUnits: () => 1 / 40000000 }),
  },
} as unknown as ConstructorParameters<typeof MapLocationControl>[1]
const makeMap = () => ({ fitBounds: vi.fn(), getZoom: () => 15, on: vi.fn(), off: vi.fn() })
let map: ReturnType<typeof makeMap>
let control: MapLocationControl
let button: HTMLButtonElement
const position = {
  latitude: 12.345,
  longitude: 67.89,
  accuracy: 24,
  timestamp: 1234567890000,
  device: 'sample platform',
}

beforeEach(() => {
  markers.length = 0
  location.get.mockReset()
  location.notices.length = 0
  map = makeMap()
  control = new MapLocationControl(document.createElement('div'), library)
  const container = control.onAdd(map as unknown as Parameters<typeof control.onAdd>[0])
  button = container.querySelector('button')!
})
afterEach(() => control.onRemove())

const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('show my location map control', () => {
  it('uses a labelled MapLibre button and never requests location when the map opens', () => {
    expect(button.getAttribute('aria-label')).toBe('Show my location')
    expect(button.closest('.maplibregl-ctrl-group')).not.toBeNull()
    expect(location.get).not.toHaveBeenCalled()
  })

  it('centres on the fresh answer with a native marker and accuracy circle', async () => {
    location.get.mockResolvedValue(position)
    button.click()
    await settle()
    expect(location.get).toHaveBeenCalledOnce()
    expect(map.fitBounds).toHaveBeenCalledWith(
      { lon: 67.89, lat: 12.345, radius: 48 },
      { maxZoom: 15, center: [67.89, 12.345] }
    )
    expect(markers).toHaveLength(2)
    expect(markers.every((marker) => marker.coordinates.join(',') === '67.89,12.345')).toBe(true)
    expect(markers[0].options.element.className).toContain('user-location-accuracy-circle')
    expect(parseFloat(markers[0].options.element.style.width)).toBeCloseTo(20.1327, 3)
    expect(markers[1].options.element.className).toContain('user-location-dot')
    expect(button.disabled).toBe(false)
  })

  it.each([0, 1])('marker %i never bubbles a click into the map lookup handler', async (index) => {
    location.get.mockResolvedValue(position)
    button.click()
    await settle()
    const canvas = document.createElement('div')
    const reverseLookup = vi.fn()
    canvas.addEventListener('click', reverseLookup)
    canvas.appendChild(markers[index].options.element)

    markers[index].options.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(reverseLookup).not.toHaveBeenCalled()
    // A press on the ordinary base map still reaches its handler.
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(reverseLookup).toHaveBeenCalledOnce()
  })

  it('suppresses repeated taps while pending and replaces rather than duplicates the marker', async () => {
    let answer: (value: typeof position) => void
    location.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    )
    button.click()
    button.click()
    expect(location.get).toHaveBeenCalledOnce()
    expect(button.getAttribute('aria-busy')).toBe('true')
    answer!(position)
    await settle()
    const first = [...markers]
    location.get.mockResolvedValue(position)
    button.click()
    await settle()
    expect(first.every((marker) => marker.removed)).toBe(true)
    expect(markers).toHaveLength(4)
  })

  it('shows the actionable reason in a Notice and lets the person retry', async () => {
    location.get.mockRejectedValue(new Error('Location permission denied. Check privacy settings.'))
    button.click()
    await settle()
    expect(location.notices).toEqual(['Location permission denied. Check privacy settings.'])
    expect(map.fitBounds).not.toHaveBeenCalled()
    expect(button.disabled).toBe(false)
  })

  it('aborts on removal and neither moves a destroyed map nor shows a late notice', async () => {
    let reject: (reason: Error) => void
    location.get.mockImplementationOnce(
      () =>
        new Promise((_resolve, no) => {
          reject = no
        })
    )
    button.click()
    const signal = location.get.mock.calls[0][0] as AbortSignal
    control.onRemove()
    expect(signal.aborted).toBe(true)
    reject!(new Error('Location request cancelled.'))
    await settle()
    expect(location.notices).toEqual([])
    expect(map.fitBounds).not.toHaveBeenCalled()
  })

  it('ignores a successful answer after removal and removes existing markers and zoom listener', async () => {
    location.get.mockResolvedValue(position)
    button.click()
    control.onRemove()
    await settle()
    expect(map.fitBounds).not.toHaveBeenCalled()
    expect(markers).toHaveLength(0)
    expect(map.off).toHaveBeenCalledWith('zoom', expect.any(Function))
  })
})
