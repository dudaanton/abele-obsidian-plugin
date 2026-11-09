import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import DebugSource from '@/components/debugger/DebugSource.vue'
import { useVault } from '../helpers/testEnv'

vi.mock('@/github/codeViewer', () => ({
  mountCode: (parent: HTMLElement, text: string) => {
    const editor = new EditorView({ state: EditorState.create({ doc: text }), parent })
    return {
      destroy: () => editor.destroy(),
      targetTop: () => {
        const pane = parent.closest<HTMLElement>('[data-navigation-pane]')!
        return pane.getBoundingClientRect().top + Number(pane.dataset.targetY) - pane.scrollTop
      },
    }
  },
}))

beforeEach(() => useVault([]))

it.each([
  [403, 202, 0],
  [446, 231.5, 0],
  [400, 395, 24],
])(
  'keeps an already visible linked line at the top of a short %spx pane',
  async (height, y, expected) => {
    const pane = document.body.appendChild(document.createElement('div'))
    pane.dataset.navigationPane = ''
    pane.dataset.targetY = String(y)
    pane.style.overflowY = 'auto'
    Object.defineProperty(pane, 'clientHeight', { value: height })
    Object.defineProperty(pane, 'scrollHeight', { value: height + 24 })
    let scroll = 0
    Object.defineProperty(pane, 'scrollTop', {
      get: () => scroll,
      set: (value: number) => {
        scroll = Math.max(0, Math.min(24, value))
      },
    })
    pane.getBoundingClientRect = () => ({ top: 100, bottom: 100 + height }) as DOMRect
    const view = mount(DebugSource, {
      attachTo: pane,
      props: {
        text: 'sample\nsecond',
        path: 'sample.ts',
        breakpoints: [],
        range: { start: 1, end: 1 },
      },
    })
    try {
      await flushPromises()
      expect(pane.scrollTop).toBe(expected)
      await view.setProps({ range: { start: 2, end: 2 } })
      await flushPromises()
      expect(pane.scrollTop).toBe(expected)
    } finally {
      view.unmount()
      pane.remove()
    }
  }
)
