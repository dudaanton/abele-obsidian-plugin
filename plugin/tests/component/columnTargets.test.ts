import { describe, it, expect } from 'vitest'
import { columnMenuTarget, columnPath, renderedColumns } from '@/columns/target'
import { createColumns } from '@/columns/operations'

describe('column DOM targets', () => {
  it('leaves links and interactive content their own context menus', () => {
    const parent = document.createElement('div')
    parent.className = 'abele-columns'
    parent.innerHTML =
      '<a class="internal-link"><strong>Link</strong></a><button><span>Button</span></button><input><pre><code>Code</code></pre><table><tr><td>Cell</td></tr></table><img><div class="math"><span>Equation</span></div><div class="internal-embed"><p>Embed</p></div><p class="ordinary">Prose</p>'
    for (const element of Array.from(
      parent.querySelectorAll('a strong,button span,input,code,td,img,.math span,.internal-embed p')
    ))
      expect(columnMenuTarget(element), element.outerHTML).toBeNull()
    expect(columnMenuTarget(parent.querySelector('.ordinary')!)).toBe(parent)
  })
  it('resolves the specific nested toolbar rather than its outer native widget position', () => {
    const parent = document.createElement('div')
    parent.className = 'abele-columns'
    parent.innerHTML =
      '<div class="abele-column"><div class="abele-columns"><button>Inner</button></div></div><div class="abele-column"></div>'
    const inner = parent.querySelector<HTMLElement>('.abele-columns')!
    const text = createColumns(createColumns('Inner passage', 'two'), 'two')
    expect(columnPath(inner)).toEqual({ root: parent, path: [0] })
    expect(renderedColumns(text, 0, inner)?.from).toBe(text.indexOf('> > > [!abele-columns'))
  })
})
