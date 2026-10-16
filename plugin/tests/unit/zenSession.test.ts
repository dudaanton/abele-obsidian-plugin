import { describe, expect, it } from 'vitest'
import { zenSettings, zenEscapeBlocked } from '@/zen/zenSession'

describe('zen session', () => {
  it('restores independent windows and sanitizes the shared width', () => {
    expect(zenSettings({ width: NaN, windows: { main: true, popup: false } })).toEqual({
      width: 700,
      windows: { main: true, popup: false },
    })
    expect(zenSettings({ width: 200 })).toEqual({ width: 480, windows: {} })
  })
  it('lets overlays consume Escape before zen leaves', () => {
    const modal = document.createElement('div')
    modal.className = 'modal-container'
    document.body.append(modal)
    expect(zenEscapeBlocked(document)).toBe(true)
    modal.remove()
    expect(zenEscapeBlocked(document)).toBe(false)
  })

  it('ignores a closed search still mounted in the view', () => {
    const search = document.createElement('div')
    search.className = 'document-search-container'
    search.style.display = 'none'
    document.body.append(search)
    expect(zenEscapeBlocked(document)).toBe(false)
    search.remove()
  })

  it('carries the width and window preferences in the Other transfer section', async () => {
    const { collectEntries, applyEntries } = await import('@/transfer/entries')
    const source = { zen: { width: 864, windows: { main: true } } }
    const entry = collectEntries(source).find((item) => item.section === 'other')!
    expect(entry.data).toMatchObject(source)
    expect(applyEntries([entry], {}).zen).toEqual(source.zen)
  })
})
