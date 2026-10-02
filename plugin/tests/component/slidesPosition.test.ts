import { afterEach, expect, it, vi } from 'vitest'
import { FileView } from 'obsidian'
import { DeckView } from '@/slides/DeckView'
import { DeckViewer } from '@/slides/core/DeckViewer'
import { parseDeck } from '@/slides/core/markdown'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

it('sets the requested file position before permitting first-slide HTML or scripts', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const allowNetwork = vi.fn(async () => false)
  const script = vi.fn(async () => () => {})
  const viewer = new DeckViewer(
    host,
    { render: async () => () => {}, allowNetwork, script },
    { resolve: () => null, readCss: async () => '' }
  )
  const deck = parseDeck(
    '---\ntype: presentation\nhtmlNetwork: true\n---\n```slide-html\n<button>Sample</button>\n```\n```slide-script\nscript: Sample summary\n```\n---\n# Second\n---\n# Requested'
  )
  // Model Obsidian FileView's load-before-state contract with the real deck renderer.
  vi.spyOn(FileView.prototype, 'setState').mockImplementation(async () => {
    await viewer.setDeck(deck)
  })
  const view = Object.assign(Object.create(DeckView.prototype) as DeckView, {
    viewer,
    positioning: 0,
    show: null,
    leaf: {},
  })
  try {
    await view.setState({ file: 'sample-deck.md', slide: 2 }, {} as never)
    expect(viewer.index).toBe(2)
    expect(allowNetwork).not.toHaveBeenCalled()
    expect(script).not.toHaveBeenCalled()
    await viewer.go(0)
    expect(allowNetwork).toHaveBeenCalled()
    expect(script).toHaveBeenCalled()
  } finally {
    viewer.destroy()
  }
})
