/**
 * What the agent reads back after building a view.
 *
 * HTML would show classes and divs; this shows the tree the script wrote, with the values a
 * script would ask about — a button's text and state, an input's value, which tab is up.
 */
import { describe, it, expect } from 'vitest'
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
} from '@/scripting/view/components'

const host: ViewHost = { async open() {}, close() {} }

describe('describeView', () => {
  it('prints the tree with the values that matter', () => {
    const v = new View({ title: 'Flashcards · German' }, host, {
      script: 'Flashcards',
      params: { deck: 'German' },
    })
    v.state.index = 3
    v.body = [
      new Row([new Badge('4 / 20')]),
      new Card({ title: 'Word', children: [new Markdown('der Hund — the dog')] }),
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
Card "Word"
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

  it('cuts long markdown and markup', () => {
    const v = new View({ title: 'T' }, host, { script: 'S', params: {} })
    v.body = [new Markdown('x'.repeat(200)), new Html({ html: '<p>' + 'y'.repeat(400) + '</p>' })]
    const out = describeView(v)
    expect(out).toContain('Markdown "' + 'x'.repeat(120) + '…"')
    expect(out).toContain('…')
    expect(out.length).toBeLessThan(700)
  })
})
