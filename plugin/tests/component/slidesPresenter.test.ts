import { afterEach, describe, expect, it, vi } from 'vitest'
import { PresenterView } from '@/slides/core/PresenterView'
import { Presentation } from '@/slides/core/Presentation'
import { parseDeck } from '@/slides/core/markdown'
import type { BlockRenderer, MediaResolver } from '@/slides/core/model'

let presenter: PresenterView | undefined
const media: MediaResolver = { resolve: () => null, readCss: async () => '' }
afterEach(() => {
  presenter?.destroy()
  presenter = undefined
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('presenter surface', () => {
  it('keeps citations in private notes and shares the derived appendix and selector with previews', async () => {
    const show = new Presentation(1)
    presenter = new PresenterView(
      document.body,
      show,
      {
        render: async (block, target) => {
          target.textContent = block.source
          return () => {}
        },
      },
      media
    )
    await presenter.setDeck(
      parseDeck(
        '# Topic\n\n> [!notes]\n> A private explanation\n> [Report](https://example.test/report)'
      )
    )
    expect(presenter.notes.textContent).toContain('https://example.test/report')
    expect(presenter.current.root.textContent).not.toContain('A private explanation')
    expect(presenter.root.querySelectorAll('select option')).toHaveLength(2)
    expect(presenter.next.model?.slides[1].generated).toBe('sources')
    expect(presenter.next.index).toBe(1)
    await presenter.setDeck(parseDeck('# Topic\n\n> [!notes]\n> Reminder'))
    expect(presenter.root.querySelectorAll('select option')).toHaveLength(1)
    expect(presenter.current.model?.slides).toHaveLength(1)
  })
  it('shows current, next, private notes, timer and slide list; keys follow one shared state', async () => {
    vi.useFakeTimers()
    const dispose = vi.fn()
    const renderer: BlockRenderer = {
      render: async (block, target) => {
        target.textContent = block.source
        return dispose
      },
    }
    const show = new Presentation(2)
    presenter = new PresenterView(document.body, show, renderer, media)
    await presenter.setDeck(parseDeck('# First\n\n> [!notes]\n> Private cue\n---\n# Second'))
    expect(presenter.current.index).toBe(0)
    expect(presenter.next.index).toBe(1)
    expect(presenter.notes.textContent).toBe('Private cue')
    expect(presenter.current.root.textContent).not.toContain('Private cue')
    expect(presenter.root.querySelectorAll('select option')).toHaveLength(2)
    presenter.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }))
    await presenter.ready
    expect(show.index).toBe(1)
    expect(presenter.current.index).toBe(1)
    expect(presenter.next.root.hidden).toBe(true)
    expect(presenter.notes.textContent).toBe('No speaker notes')
    expect(dispose).toHaveBeenCalled()
    show.end()
    expect(document.querySelector('.abele-presenter')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not leave a timer behind if attached to an already ended show', () => {
    vi.useFakeTimers()
    const show = new Presentation(1)
    show.end()
    presenter = new PresenterView(document.body, show, { render: async () => () => {} }, media)
    expect(document.querySelector('.abele-presenter')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('disposes late notes rendering when the show ends', async () => {
    let finish!: (cleanup: () => void) => void
    const cleanup = vi.fn()
    const show = new Presentation(1)
    presenter = new PresenterView(
      document.body,
      show,
      {
        render: async (block, target) => {
          target.textContent = block.source
          if (block.source === 'Slow cue')
            return new Promise((resolve) => {
              finish = resolve
            })
          return () => {}
        },
      },
      media
    )
    const pending = presenter.setDeck(parseDeck('# First\n\n> [!notes]\n> Slow cue'))
    await Promise.resolve()
    await Promise.resolve()
    show.end()
    finish(cleanup)
    await pending
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})
