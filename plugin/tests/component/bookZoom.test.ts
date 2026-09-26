/**
 * A PDF's zoom as the line under the page shows it (`BookFooter.vue`): out, the scale — which
 * opens the fits — and in; on a phone, where the line is short, one magnifier that opens it all.
 * Not under a book whose pages flow, which has no zoom.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { Menu, Platform } from 'obsidian'
import BookReader from '@/components/reader/BookReader.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_READER_SETTINGS } from '@/reader/settings'
import { emptyBookModel, type BookModel } from '@/reader/model'
import { bookCallbacks, type BookActions } from '@/reader/bookCallbacks'
import { useVault } from '../helpers/testEnv'

const model = (over: Partial<BookModel> = {}): BookModel =>
  reactive({ ...emptyBookModel(), status: 'ready', kind: 'pdf', zoom: 1.25, ...over }) as BookModel

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().reader = { ...DEFAULT_READER_SETTINGS }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})

afterEach(() => {
  Platform.isPhone = false
  vi.restoreAllMocks()
})

describe('the zoom under a PDF', () => {
  it('zooms out and in a step, and says the scale', async () => {
    const onZoom = vi.fn()
    const view = mount(BookReader, { props: { model: model(), onZoom } })
    expect(view.find('.abele-book-reader__zoom').text()).toBe('125%')
    await view.find('.abele-book-reader__zoom-out').trigger('click')
    await view.find('.abele-book-reader__zoom-in').trigger('click')
    expect(onZoom.mock.calls).toEqual([['out'], ['in']])
  })

  it('opens the fits from the scale: the width, the whole page, as set', async () => {
    const show = vi.spyOn(Menu.prototype, 'showAtPosition')
    const zoom = vi.fn()
    const m = model()
    const callbacks = bookCallbacks({ model: m, zoom, setStage: vi.fn() } as unknown as BookActions)
    const view = mount(BookReader, { props: { model: m, ...callbacks } })
    await view.find('.abele-book-reader__zoom button').trigger('click')
    expect(show).toHaveBeenCalledTimes(1)
    const menu = show.mock.contexts[0] as Menu
    const titles = menu.items.map((i) => (i as unknown as { title: string }).title)
    expect(titles).toEqual(['Fit the width', 'Fit the page', 'Zoom as set'])
    ;(menu.items[1] as unknown as { handler: () => void }).handler()
    expect(zoom).toHaveBeenCalledWith('fit-page')
  })

  it('on a phone is one magnifier, whose menu steps as well', async () => {
    Platform.isPhone = true
    const show = vi.spyOn(Menu.prototype, 'showAtPosition')
    const m = model()
    const callbacks = bookCallbacks({
      model: m,
      zoom: vi.fn(),
      setStage: vi.fn(),
    } as unknown as BookActions)
    const view = mount(BookReader, { props: { model: m, ...callbacks } })
    expect(view.find('.abele-book-reader__zoom-in').exists()).toBe(false)
    expect(view.find('.abele-book-reader__zoom-out').exists()).toBe(false)
    await view.find('.abele-book-reader__zoom-menu').trigger('click')
    const menu = show.mock.contexts[0] as Menu
    const titles = menu.items.map((i) => (i as unknown as { title: string }).title)
    expect(titles).toEqual(['Zoom in', 'Zoom out', 'Fit the width', 'Fit the page', 'Zoom as set'])
  })

  it('is not under a book whose pages flow', () => {
    const view = mount(BookReader, { props: { model: model({ kind: 'epub', zoom: 0 }) } })
    expect(view.find('.abele-book-reader__zoom').exists()).toBe(false)
    expect(view.find('.abele-book-reader__zoom-menu').exists()).toBe(false)
  })
})
