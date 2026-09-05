/**
 * What the agent reads back after building a view.
 *
 * HTML would show classes and divs; this shows the tree the script wrote, with the values a
 * script would ask about — a button's text and state, an input's value, which tab is up.
 */
import { describe, it, expect, vi } from 'vitest'
import { describeView } from '@/scripting/view/describe'
import { View, type ViewHost } from '@/scripting/view/View'
import {
  Row,
  Badge,
  Card,
  Markdown,
  Button,
  Tabs,
  Text,
  Input,
  Select,
  Checkbox,
  Table,
  Html,
  Image,
  Stack,
} from '@/scripting/view/components'

const host: ViewHost = { async open() {}, close() {} }
vi.spyOn(console, 'error').mockImplementation(() => {})

describe('describeView', () => {
  it('prints the tree with the values that matter', () => {
    const v = new View({ title: 'Flashcards · German' }, host, {
      script: 'Flashcards',
      params: { deck: 'German' },
    })
    v.state.index = 3
    v.body = [
      new Row([new Badge('4 / 20')]),
      new Card({
        title: 'Word',
        cover: 'poster.jpg',
        large: true,
        children: [new Markdown('der Hund — the dog')],
      }),
      new Row([
        new Button({ text: 'Flip', accent: true, id: 'flip' }),
        new Button({ text: 'Next', icon: 'arrow-right', disabled: true }),
        new Text('hidden', { hidden: true }),
      ]),
      new Tabs({
        tabs: [
          { id: 'a', label: 'A', content: new Text('in a') },
          { id: 'b', label: 'B', content: [] },
        ],
        active: 'b',
      }),
      new Input({ value: 'typed', placeholder: 'Search' }),
      new Select({ options: ['x', 'y'], value: 'y' }),
      new Checkbox({ checked: true, label: 'Done' }),
      new Table({
        columns: ['k', 'v'],
        rows: [
          ['a', '1'],
          ['b', new Badge('two')],
        ],
      }),
      new Image({ src: 'Media/a.png', alt: 'A' }),
      new Html({
        html: '<article class="post"><h3>T</h3></article>',
        children: { '.post': new Text('slot') },
      }),
    ]
    expect(describeView(v)).toBe(
      `View "Flashcards · German" — script "Flashcards", params {"deck":"German"}, state {"index":3}
Row
  Badge "4 / 20"
Card "Word" cover=poster.jpg large
  Markdown "der Hund — the dog"
Row
  Button "Flip" accent #flip
  Button "Next" icon=arrow-right disabled
  Text "hidden" (hidden)
Tabs active=b [a "A", b "B"]
  [a] Text "in a"
Input value="typed" placeholder="Search"
Select value=y options=[x, y]
Checkbox checked "Done"
Table columns=[k, v] rows=2
  a | 1
  b | Badge "two"
Image src=Media/a.png alt="A"
Html <article class="post"><h3>T</h3></article>
  slot .post: Text "slot"`
    )
  })

  it('prints the strip under the header when the view has errors, and nothing when not', () => {
    const v = new View({ title: 'T' }, host, { script: 'S', params: {} })
    v.body = [new Text('x')]
    expect(describeView(v).split('\n')[1]).toBe('Text "x"')
    v.report(new Error('bad press'))
    v.report('worse')
    const lines = describeView(v).split('\n')
    expect(lines[1]).toBe('errors: ["bad press", "worse"]')
    expect(lines[2]).toBe('Text "x"')
  })

  it('reads a row assigned as an array by column order, as the screen does', () => {
    const v = new View({ title: 'T' }, host, { script: 'S', params: {} })
    const t = new Table({ columns: ['k', 'v'], rows: [] })
    t.rows = [['a', '1'] as unknown as Record<string, string>]
    v.body = [t]
    expect(describeView(v)).toContain('Table columns=[k, v] rows=1\n  a | 1')
  })

  it('cuts long markdown and markup', () => {
    const v = new View({ title: 'T' }, host, { script: 'S', params: {} })
    v.body = [new Markdown('x'.repeat(200)), new Html({ html: '<p>' + 'y'.repeat(400) + '</p>' })]
    const out = describeView(v)
    expect(out).toContain('Markdown "' + 'x'.repeat(120) + '…"')
    // The markup keeps 300 characters of what the script wrote: the opening tag and 297 y's.
    expect(out).toContain('Html <p>' + 'y'.repeat(297) + '…')
    expect(out).toContain('…')
    expect(out.length).toBeLessThan(700)
  })

  it('survives state it cannot serialise and a node that holds itself', () => {
    const v = new View({ title: 'T' }, host, { script: 'S', params: {} })
    const loop: Record<string, unknown> = {}
    loop.self = loop
    v.state.loop = loop
    const s = new Stack({ id: 'outer' })
    s.add(s)
    v.body = [s]
    const out = describeView(v)
    expect(out).toContain('state <unserialisable>')
    expect(out).toContain('Stack #outer (cycle)')
    // The node itself is still printed once, above the line that stops the descent.
    expect(out.split('\n')).toHaveLength(3)
  })
})
