import { describe, it, expect } from 'vitest'
import type { MarkdownPostProcessorContext } from 'obsidian'
import { columnRenderContext, setColumnRenderOrigin } from '@/columns/renderOrigin'
import { bindColumnRender, renderedColumns } from '@/columns/target'
import { createColumns } from '@/columns/operations'

describe('column render-time provenance', () => {
  it('refuses a rendered lookup with no original render binding', () => {
    const root = document.createElement('div')
    root.className = 'abele-columns'
    root.innerHTML = '<div class="abele-column"></div><div class="abele-column"></div>'
    const text = createColumns('', 'two')
    expect(renderedColumns(text, 0, root)).toBeNull()
    expect(root.hasAttribute('data-abele-frame-from')).toBe(false)
  })
  it('binds from the renderer section before another processor can reorder frames', () => {
    const text = createColumns(
      createColumns('First', 'two') + '\n\n' + createColumns('Second', 'two'),
      'two'
    )
    const host = document.createElement('div')
    setColumnRenderOrigin(host, text, 0, text.length)
    host.innerHTML =
      '<div class="abele-columns"><div class="abele-column"><div class="abele-columns"><div class="abele-column"><p>First</p></div><div class="abele-column"></div></div><div class="abele-columns"><div class="abele-column"><p>Second</p></div><div class="abele-column"></div></div></div><div class="abele-column"></div></div>'
    const ctx = columnRenderContext(host, {
      getSectionInfo: () => null,
    } as unknown as MarkdownPostProcessorContext)
    const info = ctx.getSectionInfo(host)!
    const root = host.firstElementChild as HTMLElement
    expect(bindColumnRender(info.text, 0, root)).toBe(true)
    const [first, second] = root.querySelectorAll<HTMLElement>('.abele-columns')
    first.before(second)
    expect(renderedColumns(text, 0, second)).toBeNull()
  })
  it('does not invent section information for a detached native render with no provenance', () => {
    const el = document.createElement('div'),
      ctx = { getSectionInfo: () => null } as unknown as MarkdownPostProcessorContext
    expect(columnRenderContext(el, ctx).getSectionInfo(el)).toBeNull()
  })
})
