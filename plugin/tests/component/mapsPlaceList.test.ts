import { afterEach, expect, it, vi } from 'vitest'
import { shallowMount, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import MapBaseView from '@/components/mapBase/MapBaseView.vue'
import { Platform } from 'obsidian'
import MapPlaceCard from '@/components/mapBase/MapPlaceCard.vue'
import MapPlaceList from '@/components/mapBase/MapPlaceList.vue'

vi.mock('@/helpers/loadMaplibre', () => ({
  loadMaplibre: async () => {
    throw Error('fixture renderer unavailable')
  },
}))
vi.mock('@/components/GalleryViewer.vue', () => ({ default: {} }))
vi.mock('@/components/obsidian/Markdown.vue', () => ({ default: {} }))
const places = [
  { id: 'far', path: 'Far.md', title: 'Far', lat: 13, lon: 21, properties: [] },
  { id: 'near', path: 'Near.md', title: 'Near', lat: 12, lon: 20, properties: [] },
]
let wrapper: ReturnType<typeof shallowMount> | undefined
afterEach(() => wrapper?.unmount())
it('keeps the distance origin fixed until refresh and preserves native order as an alternative', async () => {
  const w = (wrapper = shallowMount(MapBaseView, {
    props: {
      places,
      list: true,
      styleUrl: {},
      background: '',
      backgrounds: [],
      problem: 'no-webgl',
    },
  }))
  const api = w.vm as unknown as {
    map: unknown
    resort: () => void
    markStale: () => void
    sortBy: (sort: string) => void
    pickFromList: (place: (typeof places)[0]) => void
  }
  let center = { lat: 12, lng: 20 }
  api.map = {
    getCenter: () => center,
    project: () => ({ x: 100, y: 100 }),
    getContainer: () => ({ clientWidth: 500, clientHeight: 500 }),
    remove: vi.fn(),
  }
  api.resort()
  await nextTick()
  const list = () => w.findComponent(MapPlaceList)
  expect(
    list()
      .props('places')
      .map((p: { id: string }) => p.id)
  ).toEqual(['near', 'far'])
  center = { lat: 13, lng: 21 }
  await nextTick()
  expect(list().props('places')[0].id).toBe('near')
  api.resort()
  await nextTick()
  expect(list().props('places')[0].id).toBe('far')
  api.markStale()
  await nextTick()
  expect(list().props('stale')).toBe(true)
  api.sortBy('base')
  await nextTick()
  expect(list().props('places')).toEqual(places)
  expect(list().props('stale')).toBe(false)
  api.pickFromList(places[0])
  await nextTick()
  expect(list().props('selected')).toBe('far')
  expect(w.emitted('open')).toBeUndefined()
  await w.setProps({ places: [places[1]] })
  expect(list().props('selected')).toBeNull()
})

it('returns from a phone list card to the map when Show on map is pressed', async () => {
  const platform = Platform as { isPhone: boolean }
  const original = platform.isPhone
  platform.isPhone = true
  try {
    const w = (wrapper = shallowMount(MapBaseView, {
      props: {
        places,
        list: true,
        styleUrl: {},
        background: '',
        backgrounds: [],
        problem: 'no-webgl',
      },
      global: { stubs: { ObsidianModal: { template: '<div><slot /></div>' } } },
    }))
    ;(w.vm as unknown as { openCard: (place: (typeof places)[0]) => void }).openCard(places[0])
    await nextTick()
    w.findComponent(MapPlaceCard).vm.$emit('show')
    expect(w.emitted('update:list')).toEqual([[false]])
  } finally {
    platform.isPhone = original
  }
})

it('uses an explicitly requested location for nearest-to-me sorting without starting GPS on sort', async () => {
  const geo = Object.getOwnPropertyDescriptor(navigator, 'geolocation')
  const watchPosition = vi.fn((success: PositionCallback) => {
    queueMicrotask(() =>
      success({ coords: { latitude: 12, longitude: 20 } } as GeolocationPosition)
    )
    return 7
  })
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition, clearWatch: vi.fn() },
  })
  try {
    const w = (wrapper = mount(MapBaseView, {
      props: {
        places,
        list: true,
        styleUrl: {},
        background: '',
        backgrounds: [],
        problem: 'offline',
      },
    }))
    ;(w.vm as unknown as { sortBy: (sort: string) => void }).sortBy('me')
    expect(watchPosition).not.toHaveBeenCalled()
    await w.get('[aria-label="Show my location"]').trigger('click')
    await nextTick()
    await nextTick()
    expect(watchPosition).toHaveBeenCalledOnce()
    expect(w.findComponent(MapPlaceList).props('places')[0].id).toBe('near')
  } finally {
    if (geo) Object.defineProperty(navigator, 'geolocation', geo)
    else Reflect.deleteProperty(navigator, 'geolocation')
  }
})

it('labels visible distances and their origin on the list, including without hover', async () => {
  const w = (wrapper = mount(MapPlaceList, {
    props: { places, selected: null, sortFrom: 'centre', distances: { near: '1 km' } },
  }))
  expect(w.text()).toContain('Straight-line distance from the map centre')
  expect(w.text()).not.toContain('Distance:')
  await w.setProps({ sortFrom: 'me' })
  expect(w.text()).toContain('Straight-line distance from your location')
  await w.setProps({ sortFrom: 'base', distances: {} })
  expect(w.text()).not.toContain('Straight-line distance')
})
