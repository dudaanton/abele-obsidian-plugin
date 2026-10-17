import { expect, it, vi } from 'vitest'
import { loadBackgroundStyle } from '@/maps/backgroundStyle'
import type { StyleSpecification } from 'maplibre-gl'

it('loads style JSON through the injected host transport and resolves its relative assets', async () => {
  const style = {
    version: 8,
    sprite: './sprites/main',
    glyphs: './fonts/{fontstack}/{range}.pbf',
    sources: { sample: { type: 'vector', url: './tiles.json' } },
    layers: [],
  }
  const request = vi.fn().mockResolvedValue({ status: 200, json: style })
  const loaded = await loadBackgroundStyle('https://example.test/maps/style.json', request)
  expect(request).toHaveBeenCalledWith('https://example.test/maps/style.json')
  expect(loaded).toMatchObject({
    sprite: 'https://example.test/maps/sprites/main',
    sources: { sample: { url: 'https://example.test/maps/tiles.json' } },
  })
  expect(style.sources.sample.url).toBe('./tiles.json')
})
it('passes raster specifications through and retains the URL fallback on host transport failure', async () => {
  const raster: StyleSpecification = { version: 8, sources: {}, layers: [] }
  const request = vi.fn().mockRejectedValue(Error('offline'))
  expect(await loadBackgroundStyle(raster, request)).toBe(raster)
  expect(request).not.toHaveBeenCalled()
  expect(await loadBackgroundStyle('https://example.test/style.json', request)).toBe(
    'https://example.test/style.json'
  )
})

it('resolves the upstream Mapbox source, sprite and font protocols without contacting a provider', async () => {
  const request = vi.fn().mockResolvedValue({
    status: 200,
    json: {
      version: 8,
      projection: { name: 'mercator' },
      sprite: 'mapbox://sprites/sample-owner/sample-style',
      glyphs: 'mapbox://fonts/sample-owner/{fontstack}/{range}.pbf',
      sources: { sample: { type: 'vector', url: 'mapbox://sample-owner.sample-tiles' } },
      layers: [],
    },
  })
  const style = await loadBackgroundStyle(
    'https://api.mapbox.com/styles/v1/sample-owner/sample-style?access_token=sample-token',
    request
  )
  expect(style).toMatchObject({
    sprite:
      'https://api.mapbox.com/styles/v1/sample-owner/sample-style/sprite?access_token=sample-token',
    glyphs:
      'https://api.mapbox.com/fonts/v1/sample-owner/{fontstack}/{range}.pbf?access_token=sample-token',
  })
  if (typeof style !== 'string') {
    const source = style.sources.sample as { url: string }
    expect(new URL(source.url).pathname).toBe('/v4/sample-owner.sample-tiles.json')
    expect(new URL(source.url).searchParams.has('secure')).toBe(true)
    expect(style.projection).toBeUndefined()
  }
})
