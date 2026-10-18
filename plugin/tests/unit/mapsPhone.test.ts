import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { Platform, StringValue, type BasesEntry } from 'obsidian'
import MapBaseView from '@/components/mapBase/MapBaseView.vue'
import MapControls from '@/components/map/MapControls.vue'
import Modal from '@/components/obsidian/Modal.vue'
import { mapRows } from '@/bases/mapRows'
const fake = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  fitBounds: vi.fn(),
  easeTo: vi.fn(),
  leaves: [] as any[],
}))
vi.mock('obsidian', async (original) => ({
  ...(await original<object>()),
  StringValue: class {
    constructor(private value: string) {}
    toString() {
      return this.value
    }
    isTruthy() {
      return !!this.value
    }
  },
  NullValue: class {},
  ListValue: class {},
}))
vi.mock('@/components/GalleryViewer.vue', () => ({ default: {} }))
vi.mock('@/components/obsidian/Markdown.vue', () => ({ default: {} }))
vi.mock('@/maps/layers', () => ({
  PLACE_LAYER: 'places',
  CLUSTER_LAYER: 'clusters',
  PlaceLayers: class {
    update = vi.fn().mockResolvedValue(undefined)
    dispose() {}
    source() {
      return { getClusterLeaves: async () => fake.leaves, getClusterExpansionZoom: async () => 14 }
    }
  },
}))
vi.mock('@/helpers/loadMaplibre', async () => {
  const { LngLatBounds, LngLat } = await import('maplibre-gl')
  return {
    loadMaplibre: async () => ({
      LngLatBounds,
      LngLat,
      ScaleControl: class {},
      Marker: class {
        setLngLat() {
          return this
        }
        addTo() {
          return this
        }
        remove() {}
      },
      Map: class {
        constructor(private options: any) {}
        on(event: string, layer: any, callback?: any) {
          fake.handlers.set(callback ? `${event}:${layer}` : event, callback ?? layer)
        }
        resize() {}
        addControl() {}
        getContainer() {
          return this.options.container
        }
        getCanvasContainer() {
          return this.options.container
        }
        getCenter() {
          return { lng: 20, lat: 12 }
        }
        getZoom() {
          return 3
        }
        fitBounds = fake.fitBounds
        easeTo = fake.easeTo
        remove() {}
      },
    }),
  }
})
const places = [
  { id: 'one', path: 'One.md', title: 'One', lat: 12, lon: 20, properties: [] },
  { id: 'two', path: 'Two.md', title: 'Two', lat: 12.01, lon: 20.02, properties: [] },
  { id: 'three', path: 'Three.md', title: 'Three', lat: 12.03, lon: 20.01, properties: [] },
]
let wrapper: ReturnType<typeof shallowMount> | undefined
const originalPhone = Platform.isPhone
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  ;(Platform as { isPhone: boolean }).isPhone = originalPhone
  fake.handlers.clear()
  vi.clearAllMocks()
})
async function view() {
  wrapper = shallowMount(MapBaseView, {
    props: { places, styleUrl: {}, background: '', backgrounds: [] },
  })
  await flushPromises()
  fake.fitBounds.mockClear()
  return wrapper
}
it('frames cluster leaves even when a touch lands away from the cluster centre', async () => {
  await view()
  fake.leaves = places.map((p) => ({ properties: { id: p.id } }))
  fake.handlers.get('click:clusters')!({
    features: [{ properties: { cluster_id: 1, point_count: 3 } }],
    lngLat: { lng: 20.3, lat: 12.3 },
    originalEvent: { clientX: 100, clientY: 100 },
  })
  await flushPromises()
  expect(fake.fitBounds).toHaveBeenCalledOnce()
  expect(fake.fitBounds.mock.calls[0][0].toArray()).toEqual([
    [20, 12],
    [20.02, 12.03],
  ])
  expect(fake.easeTo).not.toHaveBeenCalled()
})
it('the frame control fits all places instead of requesting fullscreen', async () => {
  const w = await view()
  w.findComponent(MapControls).vm.$emit('full')
  expect(fake.fitBounds).toHaveBeenCalledOnce()
  expect(fake.fitBounds.mock.calls[0][0].toArray()).toEqual([
    [20, 12],
    [20.02, 12.03],
  ])
})
it('a phone place card uses the content-sized native sheet', async () => {
  ;(Platform as { isPhone: boolean }).isPhone = true
  const w = await view()
  ;(w.vm as unknown as { openCard: (p: (typeof places)[0]) => void }).openCard(places[0])
  await flushPromises()
  expect(w.findComponent(Modal).props('phoneSheet')).toBe(true)
  expect(w.findComponent(Modal).props('contentSized')).toBe(true)
  expect(w.findComponent(Modal).props('size')).toBeUndefined()
})
it('does not turn a filename or repeated title into the card and list subtitle', () => {
  const row = {
    file: { path: 'Sample.md', basename: 'Sample' },
    getValue: (id: string) =>
      new StringValue(
        id === 'note.coordinates' ? '12, 20' : id === 'note.kind' ? 'Museum' : 'Sample'
      ),
  } as unknown as BasesEntry
  const result = mapRows(
    [row],
    { coordinates: 'note.coordinates', icon: null, color: null },
    ['file.name', 'note.title', 'note.kind'],
    String
  )
  expect(result.places[0].properties).toEqual([{ name: 'note.kind', value: 'Museum' }])
})
