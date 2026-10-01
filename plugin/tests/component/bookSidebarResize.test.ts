import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import BookReader from '@/components/reader/BookReader.vue'
import { PANEL_WIDTH_KEY } from '@/reader/panel'
import { emptyBookModel, type PanelTab } from '@/reader/model'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

let observer: ResizeObserverCallback
class FakeResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    observer = callback
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
const wrappers: VueWrapper[] = []
const app = () => GlobalStore.getInstance().app
const handle = (view: VueWrapper) => view.find('.abele-book-reader__resize')
const sized = async (view: VueWrapper, width = 1000) => {
  observer(
    [{ target: view.element, contentRect: { width } } as ResizeObserverEntry],
    {} as ResizeObserver
  )
  await nextTick()
}
const render = async (panelTab: PanelTab = 'contents') => {
  const model = reactive({ ...emptyBookModel(), status: 'ready' as const, panel: true, panelTab })
  const view = mount(BookReader, {
    props: { model },
    attrs: { style: 'font-size: 16px' },
    attachTo: document.body,
  })
  wrappers.push(view)
  await nextTick()
  await sized(view)
  return { view, model }
}
beforeEach(() => {
  useVault([])
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})
afterEach(() => {
  for (const view of wrappers.splice(0)) view.unmount()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('reader navigation split width', () => {
  it.each<PanelTab>(['contents', 'search', 'highlights', 'bookmarks'])(
    'resizes the %s panel without writing synced settings',
    async (tab) => {
      const config = AbeleConfig.getInstance()
      const save = vi.spyOn(config, 'saveSettings')
      const reader = JSON.stringify(config.reader)
      const { view } = await render(tab)
      expect(handle(view).attributes()).toMatchObject({
        role: 'separator',
        'aria-label': 'Navigation panel width',
        'aria-orientation': 'vertical',
        tabindex: '0',
        'aria-valuemin': '192',
        'aria-valuemax': '400',
        'aria-valuenow': '336',
      })
      await handle(view).trigger('keydown', { key: 'ArrowLeft' })
      expect(app().loadLocalStorage(PANEL_WIDTH_KEY)).toBe(320)
      expect(view.attributes('style')).toContain('--abele-panel-width: 320px')
      expect(save).not.toHaveBeenCalled()
      expect(JSON.stringify(config.reader)).toBe(reader)
      expect(app().loadLocalStorage('abele-github-tree-width')).toBeNull()
    }
  )

  it('keeps the width through a closed panel, another book and a reset', async () => {
    app().saveLocalStorage(PANEL_WIDTH_KEY, 370)
    const { view, model } = await render()
    expect(handle(view).attributes('aria-valuenow')).toBe('370')
    model.panel = false
    await nextTick()
    expect(handle(view).exists()).toBe(false)
    model.panel = true
    await nextTick()
    expect(handle(view).attributes('aria-valuenow')).toBe('370')
    const next = await render()
    expect(handle(next.view).attributes('aria-valuenow')).toBe('370')
    await handle(next.view).trigger('dblclick')
    expect(app().loadLocalStorage(PANEL_WIDTH_KEY)).toBeNull()
    expect(handle(next.view).attributes('aria-valuenow')).toBe('336')
  })

  it('clamps to available space without replacing the saved desktop preference in a drawer', async () => {
    app().saveLocalStorage(PANEL_WIDTH_KEY, 700)
    const { view } = await render()
    expect(handle(view).attributes('aria-valuenow')).toBe('400')
    await sized(view, 700)
    expect(handle(view).attributes('aria-valuenow')).toBe('280')
    await sized(view, 390)
    expect(handle(view).attributes('tabindex')).toBe('-1')
    await handle(view).trigger('keydown', { key: 'Home' })
    await handle(view).trigger('dblclick')
    expect(app().loadLocalStorage(PANEL_WIDTH_KEY)).toBe(700)
  })

  it('ignores an invalid stored width', async () => {
    app().saveLocalStorage(PANEL_WIDTH_KEY, '370')
    const { view } = await render()
    expect(handle(view).attributes('aria-valuenow')).toBe('336')
  })
})
