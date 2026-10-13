import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useVault } from '../helpers/testEnv'
import DebugSource from '@/components/debugger/DebugSource.vue'

vi.mock('@/github/codeViewer', () => ({
  mountCode: (parent: HTMLElement, text: string) => {
    const editor = new EditorView({ state: EditorState.create({ doc: text }), parent })
    return { destroy: () => editor.destroy() }
  },
}))
beforeEach(() => useVault([]))

it('uses an inert hidden spacer while keeping actual stale breakpoint controls disabled', async () => {
  const w = mount(DebugSource, {
    props: { text: 'sample', path: 'sample.ts', breakpoints: [], stale: true },
  })
  try {
    await nextTick()
    const points = w.findAll('.abele-debug-source__point')
    const spacer = points.find((point) => point.element.tagName === 'SPAN')
    expect(spacer).toBeDefined()
    expect(spacer!.attributes('aria-hidden')).toBe('true')
    expect(spacer!.attributes('aria-label')).toBeUndefined()
    expect(spacer!.attributes('tabindex')).toBeUndefined()
    const buttons = points.filter((point) => point.element.tagName === 'BUTTON')
    expect(buttons.length).toBeGreaterThan(0)
    expect(buttons.every((button) => button.attributes('disabled') !== undefined)).toBe(true)
    expect(buttons.every((button) => button.attributes('aria-label') !== 'Stop at line 0')).toBe(
      true
    )
  } finally {
    w.unmount()
  }
})
