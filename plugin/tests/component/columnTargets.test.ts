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
  it('does not shift a rejected rendered frame onto the next editable source frame', () => {
    const first = createColumns('First', 'two').replace('\n', '\n> <!-- annotation -->\n')
    const second = createColumns('Second', 'two')
    const text = createColumns(first + '\n\n' + second, 'two')
    const outer = document.createElement('div')
    outer.className = 'abele-columns'
    outer.innerHTML =
      '<div class="abele-column"><div class="abele-columns"><div class="abele-column"><p>First</p></div><div class="abele-column"></div></div><div class="abele-columns"><div class="abele-column"><p>Second</p></div><div class="abele-column"></div></div></div><div class="abele-column"></div>'
    const [firstElement, secondElement] = outer.querySelectorAll<HTMLElement>('.abele-columns')
    expect(renderedColumns(text, 0, firstElement)).toBeNull()
    expect(renderedColumns(text, 0, secondElement)?.from).toBe(
      text.lastIndexOf('> > > [!abele-columns')
    )
  })

  it('refuses a rendered range with lazy continuation beyond the strict frame end', () => {
    const text =
      '> [!abele-columns]\n> > [!abele-column]\n> > Left\n>\n> > [!abele-column]\n> > Right\ncontinued'
    const parent = document.createElement('div')
    parent.className = 'abele-columns'
    parent.innerHTML =
      '<div class="abele-column"><p>Left</p></div><div class="abele-column"><p>Right\ncontinued</p></div>'
    expect(renderedColumns(text, 0, parent)).toBeNull()
  })
  it('never reassigns established source ranges after existing DOM nodes are reordered', () => {
    const text = createColumns(
      createColumns('First', 'two') + '\n\n' + createColumns('Second', 'two'),
      'two'
    )
    const outer = document.createElement('div')
    outer.className = 'abele-columns'
    outer.innerHTML =
      '<div class="abele-column"><div class="abele-columns"><div class="abele-column"><p>First</p></div><div class="abele-column"></div></div><div class="abele-columns"><div class="abele-column"><p>Second</p></div><div class="abele-column"></div></div></div><div class="abele-column"></div>'
    const [first, second] = outer.querySelectorAll<HTMLElement>('.abele-columns')
    expect(renderedColumns(text, 0, first)?.from).toBe(text.indexOf('> > > [!abele-columns'))
    expect(renderedColumns(text, 0, second)?.from).toBe(text.lastIndexOf('> > > [!abele-columns'))
    const before = [
      first.dataset.abeleFrameFrom,
      first.dataset.abeleFrameTo,
      second.dataset.abeleFrameFrom,
      second.dataset.abeleFrameTo,
    ]
    first.before(second)
    expect(renderedColumns(text, 0, second)).toBeNull()
    expect(renderedColumns(text, 0, first)).toBeNull()
    expect([
      first.dataset.abeleFrameFrom,
      first.dataset.abeleFrameTo,
      second.dataset.abeleFrameFrom,
      second.dataset.abeleFrameTo,
    ]).toEqual(before)
  })

  it('resolves the specific nested toolbar rather than its outer native widget position', () => {
    const parent = document.createElement('div')
    parent.className = 'abele-columns'
    parent.innerHTML =
      '<div class="abele-column"><div class="abele-columns"><button>Inner</button><div class="abele-column"><p>Inner passage</p></div><div class="abele-column"></div></div></div><div class="abele-column"></div>'
    const inner = parent.querySelector<HTMLElement>('.abele-columns')!
    const text = createColumns(createColumns('Inner passage', 'two'), 'two')
    expect(columnPath(inner)).toEqual({ root: parent, path: [0] })
    expect(renderedColumns(text, 0, inner)?.from).toBe(text.indexOf('> > > [!abele-columns'))
    expect(inner.dataset.abeleFrameFrom).toBe(String(text.indexOf('> > > [!abele-columns')))
    inner.dataset.abeleFrameFrom = '0'
    expect(renderedColumns(text, 0, inner)).toBeNull()
  })
})
