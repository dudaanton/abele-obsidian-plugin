import { describe, expect, it } from 'vitest'
import { mapStyleUrl } from '@/helpers/mapStyles'

const free = (name: string) => `https://tiles.openfreemap.org/styles/${name}`

describe('the look maps are drawn in', () => {
  it('follows the theme unless a style is picked', () => {
    expect(mapStyleUrl('theme', '', false)).toBe(free('bright'))
    expect(mapStyleUrl('theme', '', true)).toBe(free('dark'))
    expect(mapStyleUrl('positron', '', true)).toBe(free('positron'))
  })

  it("draws one's own style, and an older settings file with a URL means that URL", () => {
    expect(mapStyleUrl('custom', 'https://example.test/style.json', false)).toBe(
      'https://example.test/style.json'
    )
    expect(mapStyleUrl(undefined, 'https://example.test/style.json', true)).toBe(
      'https://example.test/style.json'
    )
    expect(mapStyleUrl(undefined, '', true)).toBe(free('dark'))
    expect(mapStyleUrl('custom', '', false)).toBe(free('bright'))
  })
})
