import { afterEach, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { EditorView } from '@codemirror/view'
import DebugSource from '@/components/debugger/DebugSource.vue'
import GithubCode from '@/components/github/GithubCode.vue'
import { pinIntoView } from '@/github/scrollTo'
vi.mock('@/github/scrollTo', async (original) => ({
  ...(await original<typeof import('@/github/scrollTo')>()),
  pinIntoView: vi.fn(() => vi.fn()),
}))
enableAutoUnmount(afterEach)
afterEach(() => vi.clearAllMocks())
it.each([
  ['source in same file', DebugSource, 'same-file'],
  ['source in other file', DebugSource, 'other-file'],
  ['code in same file', GithubCode, 'same-file'],
  ['code in other file', GithubCode, 'other-file'],
] as const)('reveals the distant definition: %s', async (_name, component, kind) => {
  const text = Array.from({ length: 240 }, (_, i) =>
    i === 199 ? 'const sample = 1' : '// context'
  ).join('\n')
  const range = { start: 200, end: 200, match: { column: 6, length: 6 } }
  const wrapper = mount(component, {
    props: {
      text,
      path: 'sample.ts',
      ...(component === DebugSource ? { breakpoints: [] } : {}),
      ...(kind === 'other-file' ? { range } : {}),
    },
    attachTo: document.body,
  })
  await flushPromises()
  if (kind === 'same-file') await wrapper.setProps({ range })
  await flushPromises()
  const editor = EditorView.findFromDOM(wrapper.get('.cm-editor').element as HTMLElement)!
  expect(
    editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to)
  ).toBe('sample')
  expect(pinIntoView).toHaveBeenCalled()
})
