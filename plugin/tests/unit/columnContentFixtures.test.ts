import { describe, expect, it } from 'vitest'
import { COLUMN_CONTENT, COLUMN_IMAGES, COLUMN_MAP_STYLE } from '../fixtures/columns/content'

describe('visible column content fixtures', () => {
  it('uses distinct filled images with labels inside the square gallery crop', () => {
    expect(new Set(COLUMN_IMAGES.map((image) => image.rgb.join(','))).size).toBe(2)
    for (const image of COLUMN_IMAGES) {
      const svg = new DOMParser().parseFromString(image.svg, 'image/svg+xml')
      const root = svg.documentElement
      const width = Number(root.getAttribute('width')),
        height = Number(root.getAttribute('height'))
      const rect = svg.querySelector('rect')!,
        label = svg.querySelector('text')!
      expect(rect.getAttribute('width')).toBe(String(width))
      expect(rect.getAttribute('height')).toBe(String(height))
      expect(rect.getAttribute('fill')).toBe(`rgb(${image.rgb.join(',')})`)
      expect(label.getAttribute('x')).toBe(String(width / 2))
      expect(Number(label.getAttribute('y'))).toBeGreaterThan(height / 4)
      expect(Number(label.getAttribute('y'))).toBeLessThan((height * 3) / 4)
      expect(label.getAttribute('text-anchor')).toBe('middle')
      expect(label.textContent).toBe(image.label)
      expect(label.getAttribute('fill')).toBe('white')
      expect(image.rgb.reduce((sum, channel) => sum + channel, 0)).toBeLessThan(650)
    }
    const gallery = COLUMN_CONTENT.find((sample) => sample.name === 'gallery')!
    for (const image of COLUMN_IMAGES)
      expect(gallery.body).toContain(`![[${image.name}|${image.label}]]`)
  })
  it('draws the map from inline invented regions rather than waiting for network tiles', () => {
    expect(COLUMN_MAP_STYLE.sources.sample.type).toBe('geojson')
    expect(COLUMN_MAP_STYLE.sources.sample.data.features).toHaveLength(2)
    expect(COLUMN_MAP_STYLE.layers.map((layer) => layer.type)).toContain('fill')
    expect(JSON.stringify(COLUMN_MAP_STYLE)).not.toContain('https://')
    expect(COLUMN_CONTENT.find((sample) => sample.name === 'maps')!.body).toContain(
      'label: Sample center'
    )
  })
})
