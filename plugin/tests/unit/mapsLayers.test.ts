import { afterEach, expect, it, vi } from 'vitest'
import type { Map as LibreMap } from 'maplibre-gl'
import { PlaceLayers } from '@/maps/layers'
vi.mock('obsidian', async (original) => ({
  ...(await original<object>()),
  getIcon: () => document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
}))
afterEach(() => vi.restoreAllMocks())

it('shares one glyph raster across thousands of points and restores layers after a style switch', async () => {
  const raster = vi.fn(() => ({ data: new Uint8ClampedArray(64 * 64 * 4), width: 64, height: 64 }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    beginPath() {},
    arc() {},
    fill() {},
    drawImage() {},
    getImageData: raster,
    fillText() {},
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue()
  const sources = new Map()
  const images = new Set()
  const layers = new Set()
  const container = document.body.createDiv()
  const fake = {
    isStyleLoaded: () => true,
    getContainer: () => container,
    hasImage: (id: string) => images.has(id),
    addImage: (id: string) => images.add(id),
    removeImage: (id: string) => images.delete(id),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, source: object) => sources.set(id, { ...source, setData: vi.fn() }),
    getLayer: (id: string) => layers.has(id),
    addLayer: (layer: { id: string }) => layers.add(layer.id),
    removeLayer: (id: string) => layers.delete(id),
    removeSource: (id: string) => sources.delete(id),
    getMaxZoom: () => 18,
    setMissingStyleImageResolver: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }
  const renderer = new PlaceLayers(fake as unknown as LibreMap, document)
  expect(fake.setMissingStyleImageResolver).toHaveBeenCalledOnce()
  const resolveImage = fake.setMissingStyleImageResolver.mock.calls[0][0]
  const places = Array.from({ length: 3000 }, (_, i) => ({
    id: String(i),
    path: `Sample ${i}.md`,
    title: `Sample ${i}`,
    lat: 12,
    lon: 20,
    icon: 'trees',
    properties: [],
  }))
  await renderer.update(places, true)
  expect(raster).toHaveBeenCalledTimes(1)
  expect(sources.size).toBe(1)
  expect(sources.get('abele-places').maxzoom).toBe(24)
  expect(layers.size).toBe(2)
  expect(sources.get('abele-places').data.features).toHaveLength(3000)
  expect(container.children.length).toBe(0)
  await resolveImage('abele-cluster-2')
  expect(images.has('abele-cluster-2')).toBe(true)
  await renderer.update([{ ...places[0], lat: 14 }], true)
  expect(sources.get('abele-places').setData).toHaveBeenCalledWith(
    expect.objectContaining({
      features: [expect.objectContaining({ geometry: { type: 'Point', coordinates: [20, 14] } })],
    })
  )
  expect(sources.size).toBe(1)
  const previous = [...images].filter((id) => !String(id).startsWith('abele-cluster-'))
  await renderer.update([{ ...places[0], color: '#f00' }], true)
  expect(previous.every((id) => !images.has(id))).toBe(true)
  sources.clear()
  layers.clear()
  images.clear()
  await renderer.update(places, false)
  expect(sources.get('abele-places').cluster).toBe(false)
  expect(layers.size).toBe(2)
  renderer.dispose()
  sources.clear()
  await renderer.update(places, true)
  expect(sources.size).toBe(0)
  container.remove()
})
