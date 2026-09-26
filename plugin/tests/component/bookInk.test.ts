/**
 * Drawing on a PDF's pages, as the row under the page shows it (`BookInkBar.vue`, `BookFooter.vue`,
 * `BookReader.vue`): the pen that turns drawing on, and while it is on, the bar with the tools, the
 * colours, undo and the way out, in the place of everything else that row holds.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import BookReader from '@/components/reader/BookReader.vue'
import BookInkBar from '@/components/reader/BookInkBar.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_READER_SETTINGS } from '@/reader/settings'
import { emptyBookModel, type BookModel } from '@/reader/model'
import { emptyInk, type InkModel } from '@/reader/ink/inkModel'
import { useVault } from '../helpers/testEnv'

const model = (over: Partial<BookModel> = {}): BookModel =>
  reactive({ ...emptyBookModel(), status: 'ready', kind: 'pdf', ...over }) as BookModel

const ink = (over: Partial<InkModel> = {}): InkModel => ({ ...emptyInk(), on: true, ...over })

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().reader = { ...DEFAULT_READER_SETTINGS }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})

describe('the pen under a PDF', () => {
  it('is offered in the line under a PDF, not under a book, and turns drawing on', async () => {
    const onInk = vi.fn()
    const view = mount(BookReader, { props: { model: model(), onInk } })
    const pen = view.find('.abele-book-reader__draw')
    expect(pen.exists()).toBe(true)
    await pen.trigger('click')
    expect(onInk).toHaveBeenCalledWith(true)
    const book = mount(BookReader, { props: { model: model({ kind: 'epub' }) } })
    expect(book.find('.abele-book-reader__draw').exists()).toBe(false)
  })

  it('gives its row to the drawing bar while drawing is on, over words selected and all', () => {
    const view = mount(BookReader, {
      props: {
        model: model({
          ink: ink(),
          selection: { cfi: 'x', text: 'words', label: 'Page 1' },
          speech: 'playing',
        }),
      },
    })
    expect(view.find('.abele-book-ink').exists()).toBe(true)
    expect(view.find('.abele-book-selection').exists()).toBe(false)
    expect(view.find('.abele-book-speech').exists()).toBe(false)
    expect(view.find('.abele-book-reader__footer').exists()).toBe(false)
  })
})

describe('the drawing bar', () => {
  it('keeps Obsidian’s swipes off itself and says what it is', () => {
    const bar = mount(BookInkBar, { props: { ink: ink() } })
    expect(bar.attributes('data-ignore-swipe')).toBe('true')
    expect(bar.attributes('role')).toBe('toolbar')
  })

  it('picks the pen, the marker and the eraser, the one in hand pressed', async () => {
    const bar = mount(BookInkBar, { props: { ink: ink({ tool: 'marker' }) } })
    const tools = bar.findAll('.abele-book-ink__tool')
    expect(tools.map((t) => t.attributes('aria-pressed'))).toEqual(['false', 'true', 'false'])
    await tools[2].trigger('click')
    await tools[0].trigger('click')
    expect(bar.emitted('tool')).toEqual([['eraser'], ['pen']])
  })

  it("offers the pen's colours for the pen and the marker's for the marker", async () => {
    const pen = mount(BookInkBar, { props: { ink: ink({ penColor: 'red' }) } })
    const dots = pen.findAll('.abele-book-ink__swatch')
    expect(dots).toHaveLength(4)
    expect(dots.map((d) => d.attributes('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ])
    await dots[2].trigger('click')
    expect(pen.emitted('color')).toEqual([['blue']])
    const marker = mount(BookInkBar, { props: { ink: ink({ tool: 'marker' }) } })
    await marker.findAll('.abele-book-ink__swatch')[3].trigger('click')
    expect(marker.emitted('color')).toEqual([['pink']])
  })

  it('offers drawing with a finger only on a touch screen', async () => {
    expect(
      mount(BookInkBar, { props: { ink: ink() } })
        .find('.abele-book-ink__finger')
        .exists()
    ).toBe(false)
    const bar = mount(BookInkBar, { props: { ink: ink({ touch: true, finger: false }) } })
    const finger = bar.find('.abele-book-ink__finger')
    expect(finger.attributes('aria-pressed')).toBe('false')
    await finger.trigger('click')
    expect(bar.emitted('finger')).toEqual([[true]])
  })

  it('undoes and redoes only when there is something to, and leaves drawing', async () => {
    const bar = mount(BookInkBar, { props: { ink: ink({ canUndo: true }) } })
    const undo = bar.find('.abele-book-ink__undo')
    const redo = bar.find('.abele-book-ink__redo')
    expect(redo.classes()).toContain('abele-obsidian-icon_disabled')
    await undo.trigger('click')
    await redo.trigger('click')
    expect(bar.emitted('undo')).toHaveLength(1)
    expect(bar.emitted('redo')).toBeUndefined()
    await bar.find('.abele-book-ink__done').trigger('click')
    expect(bar.emitted('done')).toHaveLength(1)
  })

  it('has the way out on the left, where the pen that turned drawing on sat', () => {
    const bar = mount(BookInkBar, { props: { ink: ink() } })
    const first = bar.find('.abele-obsidian-icon')
    expect(first.classes()).toContain('abele-book-ink__done')
  })
})
