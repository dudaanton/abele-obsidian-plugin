/**
 * The catalogue a script builds a view from.
 *
 * Instances are the script's handle on what is on screen: assign a prop and the view changes,
 * attach a handler and a press reaches it. Nothing here touches DOM or Vue templates — that is
 * the renderer's job — so what is asserted is reactivity, handlers and the shapes the
 * constructors accept.
 */
import { describe, it, expect, vi } from 'vitest'
import { watch, nextTick, isReactive } from 'vue'
import {
  Stack,
  Row,
  Grid,
  Section,
  Tabs,
  Setting,
  Markdown,
  Text,
  Image,
  Table,
  Badge,
  EmptyState,
  Button,
  Icon,
  Input,
  Select,
  Checkbox,
  Search,
  Card,
  Html,
  VIEW_GLOBALS,
  isNode,
} from '@/scripting/view/components'

describe('a node', () => {
  it('is reactive: assigning a prop is observed', async () => {
    const b = new Button({ text: 'Go' })
    const seen = vi.fn()
    watch(() => b.text, seen)
    b.text = 'Gone'
    await nextTick()
    expect(seen).toHaveBeenCalledWith('Gone', 'Go', expect.anything())
    expect(isReactive(b)).toBe(true)
  })

  it('takes handlers from the constructor and from on()', async () => {
    const fromCtor = vi.fn()
    const later = vi.fn()
    const b = new Button({ text: 'Go', onClick: fromCtor }).on('click', later)
    await b.click()
    expect(fromCtor).toHaveBeenCalledTimes(1)
    expect(later).toHaveBeenCalledTimes(1)
    expect(b.has('click')).toBe(true)
  })

  it('awaits async handlers in order and lets a throw escape', async () => {
    const order: string[] = []
    const b = new Button({ text: 'Go' })
      .on('click', async () => {
        await Promise.resolve()
        order.push('a')
      })
      .on('click', () => {
        order.push('b')
      })
    await b.emit('click')
    expect(order).toEqual(['a', 'b'])
    b.on('click', () => {
      throw new Error('boom')
    })
    await expect(b.emit('click')).rejects.toThrow('boom')
  })

  it('manages children and finds by id', () => {
    const inner = new Badge({ text: 'x', id: 'mark' })
    const card = new Card({ title: 'c', badges: [inner] })
    const s = new Stack([card])
    expect(s.find('mark') === inner).toBe(true)
    const b = new Button({ text: 'b' })
    s.add(b)
    expect(s.children.length).toBe(2)
    s.remove(b)
    expect(s.children.length).toBe(1)
    s.clear()
    expect(s.children.length).toBe(0)
  })

  it('update() assigns several props at once and returns the node', () => {
    const b = new Button({ text: 'a' })
    expect(b.update({ text: 'b', disabled: true }) === b).toBe(true)
    expect(b.disabled).toBe(true)
  })

  it('update() replaces a handler instead of stacking another one up', async () => {
    const f = vi.fn()
    const b = new Button({ text: 'a' })
    b.update({ onClick: f })
    b.update({ onClick: f })
    await b.click()
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('find() walks a cycle once instead of forever', () => {
    const s = new Stack([])
    s.add(s)
    expect(s.find('nope')).toBeUndefined()
  })

  it('has a stable key distinct from every other node', () => {
    const a = new Text('a')
    const b = new Text('b')
    expect(a.key).not.toBe(b.key)
  })
})

describe('constructors', () => {
  it('layout takes a bare array or props', () => {
    const a = new Stack([new Text('x')])
    const b = new Stack({ children: [new Text('x')], gap: 'small' })
    expect(a.gap).toBe('medium')
    expect(b.gap).toBe('small')
    expect(new Row([]).wrap).toBe(true)
    expect(new Row({ justify: 'between' }).justify).toBe('between')
    // The old name still lands, so a script written against it keeps its layout.
    expect(new Row({ align: 'end' }).justify).toBe('end')
    expect(new Grid({ wide: true }).wide).toBe(true)
    expect(new Section({ title: 'T', children: [] }).title).toBe('T')
    expect(new Setting({ name: 'N', children: [] }).name).toBe('N')
  })

  it('Tabs holds content per tab and lists it as nested', () => {
    const t = new Tabs({
      tabs: [
        { id: 'a', label: 'A', content: new Text('a') },
        { id: 'b', label: 'B', content: [new Text('b1'), new Text('b2', { id: 'deep' })] },
      ],
      active: 'a',
    })
    expect(t.contentOf('b').length).toBe(2)
    expect(t.contentOf('zzz')).toEqual([])
    expect(t.find('deep')?.type).toBe('text')
  })

  it('Markdown takes text or a file', () => {
    expect(new Markdown('**hi**').text).toBe('**hi**')
    expect(new Markdown({ file: 'Notes/a.md' }).file).toBe('Notes/a.md')
  })

  it('Text, Badge, EmptyState take a bare string', () => {
    expect(new Text('t').text).toBe('t')
    expect(new Badge('b').text).toBe('b')
    expect(new EmptyState('nothing').text).toBe('nothing')
    expect(new Image({ src: 'a.png' }).fit).toBe('contain')
  })

  it('Table normalises columns and rows', () => {
    const t = new Table({
      columns: ['Name', 'Size'],
      rows: [
        ['a', '1'],
        ['b', new Badge('2')],
      ],
    })
    expect(t.columns).toEqual([
      { key: 'Name', label: 'Name' },
      { key: 'Size', label: 'Size' },
    ])
    expect(t.rows[0]).toEqual({ Name: 'a', Size: '1' })
    expect(isNode(t.rows[1].Size)).toBe(true)
    const u = new Table({ columns: [{ key: 'n', label: 'Name' }], rows: [{ n: 'x' }] })
    expect(u.rows[0].n).toBe('x')
    expect(t.find((t.rows[1].Size as Badge).id ?? '')).toBeUndefined()
  })

  it('Select normalises options', () => {
    expect(new Select({ options: ['a', 'b'], value: 'a' }).options).toEqual([
      { value: 'a', label: 'a' },
      { value: 'b', label: 'b' },
    ])
    expect(new Select({ options: [{ value: 'x', label: 'X' }], value: 'x' }).options[0].label).toBe(
      'X'
    )
  })

  it('Input, Checkbox, Search, Icon carry their defaults', () => {
    expect(new Input({}).value).toBe('')
    expect(new Input({ textarea: true, rows: 3 }).rows).toBe(3)
    expect(new Checkbox({}).checked).toBe(false)
    expect(new Search({}).value).toBe('')
    expect(new Icon({ icon: 'x', tooltip: 'Close' }).tooltip).toBe('Close')
  })

  it('Card nests badges, actions and children', () => {
    const c = new Card({
      title: 'T',
      badges: [new Badge({ text: 'b', id: 'badge' })],
      actions: [new Icon({ icon: 'x', tooltip: 'x', id: 'act' })],
      children: [new Text('t', { id: 'child' })],
    })
    expect(c.find('badge')).toBeDefined()
    expect(c.find('act')).toBeDefined()
    expect(c.find('child')).toBeDefined()
  })

  it('Html keeps delegated handlers and slot nodes', async () => {
    const fn = vi.fn()
    const h = new Html({
      html: '<div class="a"><span class="b"></span></div>',
      on: { 'click .b': fn },
      children: { '.a': new Text('inside', { id: 'in' }) },
    })
    expect(h.delegates).toEqual([{ event: 'click', selector: '.b', fn }])
    expect(h.find('in')).toBeDefined()
    h.on('click', fn, '.c')
    expect(h.delegates.length).toBe(2)
    const mounted = vi.fn()
    h.on('mount', mounted)
    await h.emit('mount', 'el')
    expect(mounted).toHaveBeenCalledWith('el')
  })

  it('Html counts a delegated handler as bound and unbinds it with the event', () => {
    const fn = vi.fn()
    const other = vi.fn()
    const h = new Html({ html: '<div></div>', on: { 'click .b': fn, 'input .c': other } })
    expect(h.has('click')).toBe(true)
    h.off('click')
    expect(h.has('click')).toBe(false)
    expect(h.delegates).toEqual([{ event: 'input', selector: '.c', fn: other }])
  })

  it('exports every class as a script global', () => {
    expect(Object.keys(VIEW_GLOBALS).sort()).toEqual([
      'Badge',
      'Button',
      'Card',
      'Checkbox',
      'EmptyState',
      'Grid',
      'Html',
      'Icon',
      'Image',
      'Input',
      'Markdown',
      'Row',
      'Search',
      'Section',
      'Select',
      'Setting',
      'Stack',
      'Table',
      'Tabs',
      'Text',
    ])
  })
})
