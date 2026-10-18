import { expect, it, vi } from 'vitest'
import { cardContent, viewerPhotos } from '@/maps/cardContent'

it('extracts galleries without losing the clicked picture index after missing images', () => {
  const content = cardContent(
    '---\nkind: sample\n---\n# Sample\n\n::abele-gallery::\n![[missing.png]]\n![[sample.png|A picture]]\n\nBody',
    (path) => (path === 'sample.png' ? 'app://sample' : null)
  )
  expect(content.text).not.toMatch(/kind:|abele-gallery|missing.png/)
  expect(content.text).toContain('Body')
  expect(content.photos).toEqual([
    { path: 'missing.png', url: '', caption: '', missing: true, type: 'local' },
    {
      path: 'sample.png',
      url: 'app://sample',
      caption: 'A picture',
      missing: false,
      type: 'local',
    },
  ])
  expect(viewerPhotos(content.photos, 1)).toMatchObject({
    index: 0,
    images: [{ path: 'sample.png' }],
  })
  expect(viewerPhotos(content.photos, 0)).toBeNull()
})

it('keeps ordinary embeds and the source type of remote gallery pictures', () => {
  const content = cardContent(
    '![[ordinary.png]]\n\n::abele-gallery::\n![Sample](https://example.test/sample.png)',
    () => null
  )
  expect(content.text).toContain('![[ordinary.png]]')
  expect(viewerPhotos(content.photos, 0)).toMatchObject({
    images: [{ type: 'remote', url: 'https://example.test/sample.png' }],
  })
})

it('clears a removed or invalid place colour instead of retaining the previous glyph colour', async () => {
  const { placeGlyph, pinElement } = await import('@/components/mapBase/pins')
  const place = {
    id: 'sample',
    path: 'Sample.md',
    title: 'Sample',
    lat: 12,
    lon: 20,
    properties: [],
    color: '#338855',
  }
  const el = document.createElement('span')
  placeGlyph(el, place)
  expect(el.style.getPropertyValue('--abele-pin-color')).toBe('#338855')
  placeGlyph(el, { ...place, color: undefined })
  expect(el.style.getPropertyValue('--abele-pin-color')).toBe('')
  expect(
    pinElement(document, { ...place, color: 'invalid sample colour' }).style.getPropertyValue(
      '--abele-pin-color'
    )
  ).toBe('')
})

it('owns pin activation so the map underneath cannot activate a second place', async () => {
  const { pinElement } = await import('@/components/mapBase/pins')
  const activate = vi.fn()
  const background = vi.fn()
  const parent = document.body.createDiv()
  parent.addEventListener('click', background)
  const pin = pinElement(document, { id: 'sample', path: 'Sample.md', title: 'Sample', lat: 12, lon: 20, properties: [] }, activate)
  parent.appendChild(pin)
  pin.click()
  expect(activate).toHaveBeenCalledOnce()
  expect(background).not.toHaveBeenCalled()
  pin.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))
  expect(activate).toHaveBeenCalledTimes(2)
  expect(activate.mock.calls[1][0].metaKey).toBe(true)
  expect(background).not.toHaveBeenCalled()
  parent.remove()
})
