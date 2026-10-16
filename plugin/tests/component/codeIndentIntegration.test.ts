import { expect, it } from 'vitest'
import 'obsidian'
import { readingGuideProcessor, blockGuides } from '@/codeIndent/register'
import { codeGuideExtension, refreshCodeGuides } from '@/codeIndent/register'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { StreamLanguage } from '@codemirror/language'
import { Tag } from '@lezer/highlight'

it('skips inline and registered or special blocks and preserves text', () => {
  const root = document.createElement('div')
  root.innerHTML =
    '<pre><code class="language-js">a\n  b\n</code></pre><pre><code class="language-custom">a\n  b</code></pre><pre><code class="language-mermaid">a\n  b</code></pre><code>a\n  b</code>'
  const text = root.textContent
  readingGuideProcessor(
    () => ({ enabled: true, tabSize: 4 }),
    () => ({ custom: true })
  )(root)
  expect(root.querySelectorAll('.abele-code-line')).toHaveLength(2)
  expect(root.textContent).toBe(text)
})

it('decorates parsed editor lines, blanks and edits while preserving selection and text', () => {
  const names = ['hmd-codeblock-begin', 'hmd-codeblock-end', 'hmd-codeblock']
  const language = StreamLanguage.define({
    startState: () => ({ code: false }),
    token(stream, state) {
      const fence = stream.match(/^```/)
      stream.skipToEnd()
      if (fence) {
        state.code = !state.code
        return names[state.code ? 0 : 1]
      }
      return state.code ? names[2] : null
    },
    tokenTable: Object.fromEntries(names.map((name) => [name, Tag.define()])),
  })
  let enabled = true
  let tabSize = 4
  const doc = 'prose\n```\na\n\tb\n\n        c\n```\n  prose'
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [language, codeGuideExtension(() => ({ enabled, tabSize }))],
    }),
  })
  try {
    const rows = () => Array.from(view.dom.querySelectorAll<HTMLElement>('.abele-code-guides'))
    expect(rows().map((r) => r.style.getPropertyValue('--abele-guide-depth'))).toEqual([
      '1',
      '1',
      '2',
    ])
    tabSize = 2
    view.dispatch({ effects: refreshCodeGuides.of(null) })
    expect(rows()[0].style.getPropertyValue('--abele-guide-step')).toBe('2ch')
    expect(rows()[2].style.getPropertyValue('--abele-guide-depth')).toBe('4')
    view.dispatch({
      changes: { from: doc.indexOf('        c'), to: doc.indexOf('        c') + 8, insert: '  ' },
    })
    expect(rows()[2].style.getPropertyValue('--abele-guide-depth')).toBe('1')
    enabled = false
    view.dispatch({ effects: refreshCodeGuides.of(null) })
    expect(rows()).toHaveLength(0)
    expect(view.state.doc.toString()).toBe(doc.replace('        c', '  c'))
    expect(view.state.selection.main.anchor).toBe(0)
  } finally {
    view.destroy()
  }
})
it('gates reading guides', () => {
  const root = document.createElement('div')
  root.innerHTML = '<pre><code>a\n  b</code></pre>'
  readingGuideProcessor(() => ({ enabled: false, tabSize: 4 }))(root)
  expect(root.querySelector('.abele-code-line')).toBeNull()
})
it('computes editor depths and step with current tab size and gating', () => {
  expect(blockGuides(['a', '\tb', '        c'], { enabled: true, tabSize: 4 })).toEqual({
    depths: [0, 1, 2],
    step: 4,
  })
  expect(blockGuides(['a', '\tb', '        c'], { enabled: true, tabSize: 2 })).toEqual({
    depths: [0, 1, 4],
    step: 2,
  })
  expect(blockGuides(['a', '\tb'], { enabled: false, tabSize: 4 }).depths).toEqual([])
})
