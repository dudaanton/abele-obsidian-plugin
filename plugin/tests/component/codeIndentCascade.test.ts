import { expect, it } from 'vitest'
import { compileString } from 'sass-embedded'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

it('applies hanging padding together with text indent over native code-block padding', () => {
  const style = document.createElement('style')
  const guideScss = readFileSync(
    resolve(__dirname, '../../src/codeIndent/indentGuides.scss'),
    'utf8'
  )
  style.textContent = `.markdown-source-view.mod-cm6 .cm-line.HyperMD-codeblock:not(.HyperMD-list-line) { padding-inline-start: 16px; }\n${compileString(guideScss).css}`
  const editor = document.createElement('div')
  editor.className = 'markdown-source-view mod-cm6'
  const content = document.createElement('div')
  const cm = document.createElement('div')
  cm.className = 'cm-editor'
  content.className = 'cm-content'
  const row = document.createElement('div')
  row.className = 'cm-line HyperMD-codeblock HyperMD-codeblock-bg abele-code-guides'
  row.style.cssText = '--abele-guide-depth: 2; --abele-guide-step: 8px; --abele-guide-inset: 16px'
  content.append(row)
  cm.append(content)
  editor.append(cm)
  document.head.append(style)
  document.body.append(editor)
  try {
    expect(getComputedStyle(row).paddingInlineStart).not.toBe('16px')
    expect(getComputedStyle(row).paddingInlineStart).toContain('2 * 8px')
    expect(getComputedStyle(row).textIndent).toContain('-1 * 2 * 8px')
  } finally {
    style.remove()
    editor.remove()
  }
})
