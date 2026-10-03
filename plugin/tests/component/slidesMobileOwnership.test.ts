import { expect, it, vi } from 'vitest'
import { DeckViewer } from '@/slides/core/DeckViewer'
import { mobilePresentation } from '@/slides/mobilePresentation'
import { parseDeck } from '@/slides/core/markdown'

it('destroying a viewer with native hide pending does not restore chrome over its replacement', async () => {
  let visible = true
  let finish!: () => void
  const bridge = {
    getInfo: vi.fn(async () => ({ visible })),
    hide: vi.fn(() => {
      visible = false
      return new Promise<void>((r) => {
        finish = r
      })
    }),
    show: vi.fn(async () => {
      visible = true
    }),
  }
  const win = { Capacitor: { Plugins: { StatusBar: bridge } } }
  const a = mobilePresentation(win),
    b = mobilePresentation(win)
  const renderer = { render: async () => () => {} }
  const media = { resolve: () => null, readCss: async () => '' }
  const first = new DeckViewer(document.body, renderer, media, { presentationHost: a })
  const second = new DeckViewer(document.body, renderer, media, { presentationHost: b })
  try {
    await first.setDeck(parseDeck('# Sample first'))
    await second.setDeck(parseDeck('# Sample successor'))
    await first.present(false)
    await vi.waitFor(() => expect(bridge.hide).toHaveBeenCalledTimes(1))
    first.destroy()
    await second.present(false)
    const ready = b.enter()
    finish()
    await ready
    expect(visible).toBe(false)
    expect(bridge.show).not.toHaveBeenCalled()
    expect(second.root.classList.contains('abele-deck-presenting')).toBe(true)
    second.destroy()
    await b.exit()
    expect(visible).toBe(true)
    expect(bridge.show).toHaveBeenCalledTimes(1)
  } finally {
    finish?.()
    first.destroy()
    second.destroy()
    await a.exit()
    await b.exit()
    document.body.replaceChildren()
  }
})
