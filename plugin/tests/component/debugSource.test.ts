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
it('names disabled points instead of exposing an undefined label', async () => {
  const w = mount(DebugSource, {
    props: {
      text: 'sample',
      path: 'sample.ts',
      breakpoints: [{ file: 'sample.ts', line: 1, state: 'disabled' }],
    },
  })
  try {
    await nextTick()
    expect(w.get('button.abele-debug-source__point').attributes('aria-label')).toContain(
      'Breakpoint disabled'
    )
  } finally {
    w.unmount()
  }
})
it('identifies log points and refreshes their message without claiming they stop execution', async () => {
  const point = {
    file: 'sample.ts',
    line: 1,
    state: 'set' as const,
    kind: 'log' as const,
    logMessage: 'value {n}',
  }
  const w = mount(DebugSource, {
    props: { text: 'sample', path: 'sample.ts', breakpoints: [point] },
  })
  try {
    await nextTick()
    expect(w.get('button.abele-debug-source__point').attributes('aria-label')).toContain(
      'Log point: value {n}'
    )
    await w.setProps({ breakpoints: [{ ...point, logMessage: 'next {n}' }] })
    expect(w.get('button.abele-debug-source__point').attributes('aria-label')).toContain(
      'Log point: next {n}'
    )
  } finally {
    w.unmount()
  }
})

it.each(['stop', 'record'] as const)('toggles a %s off with one mark per line', async (kind) => {
  const w = mount(DebugSource, {
    props: {
      text: 'sample',
      path: 'sample.ts',
      breakpoints: [{ file: 'sample.ts', line: 1, state: 'set', kind }],
    },
  })
  try {
    await nextTick()
    const marks = w.findAll('button.abele-debug-source__point')
    expect(marks).toHaveLength(1)
    await marks[0]!.trigger('click')
    expect(w.emitted('breakpoint')).toEqual([[1]])
    expect(w.emitted('edit-point')).toBeUndefined()
    await w.setProps({ breakpoints: [] })
    expect(w.findAll('.abele-breakpoint-mark_set')).toHaveLength(0)
  } finally {
    w.unmount()
  }
})

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
