/**
 * A script's tree, on screen.
 *
 * Each node type must come out as the matching kit component — that is what keeps a scripted
 * view looking like the rest of the plugin — and the two directions must both work: a press
 * reaches the script's handler, and an assignment in the script reaches the DOM.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick, shallowReactive } from 'vue'
import { TFile } from 'obsidian'
import ScriptViewComponent from '@/components/ScriptView.vue'
import KitButton from '@/components/obsidian/Button.vue'
import KitCard from '@/components/obsidian/Card.vue'
import KitTabs from '@/components/obsidian/Tabs.vue'
import KitTable from '@/components/obsidian/Table.vue'
import KitMarkdown from '@/components/obsidian/Markdown.vue'
import { View, type ViewHost } from '@/scripting/view/View'
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
} from '@/scripting/view/components'
import type { ScriptViewModel } from '@/views/ScriptView'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const host: ViewHost = {
  async open(v) {
    v.leafId = 'L'
  },
  close() {},
}

function live(view: View): ScriptViewModel {
  return { id: 'leaf-1', view, status: { kind: 'live' }, saved: null, runAgain: vi.fn() }
}

const make = (title = 'T') => new View({ title }, host, { script: 'Demo', params: {} })

let app: FakeApp

beforeEach(() => {
  app = useVault([{ path: 'Notes/a.md', content: 'hello from a' }])
})

describe('states', () => {
  it('says which script is starting', () => {
    const w = mount(ScriptViewComponent, {
      props: {
        model: {
          id: 'x',
          view: null,
          status: { kind: 'starting', script: 'Flashcards' },
          saved: null,
          runAgain: vi.fn(),
        },
      },
    })
    expect(w.text()).toContain('Starting Flashcards')
  })

  it('shows the failure and offers to run again', async () => {
    const runAgain = vi.fn()
    const w = mount(ScriptViewComponent, {
      props: {
        model: {
          id: 'x',
          view: null,
          status: { kind: 'failed', script: 'F', message: 'Script "F" not found' },
          saved: null,
          runAgain,
        },
      },
    })
    expect(w.text()).toContain('Script "F" not found')
    await w.findComponent(KitButton).trigger('click')
    expect(runAgain).toHaveBeenCalled()
  })

  it('goes from starting to live in place, keeping the style it was given', async () => {
    // What every tab does: the leaf is made while the script runs, then the view is bound.
    const v = make()
    v.style('.mine { color: var(--text-accent); }')
    v.body = [new Text('ready', { cls: 'mine' })]
    const model: ScriptViewModel = shallowReactive({
      id: 'leaf-1',
      view: null,
      status: { kind: 'starting', script: 'Demo' },
      saved: null,
      runAgain: vi.fn(),
    })
    const w = mount(ScriptViewComponent, { props: { model } })
    expect(w.text()).toContain('Starting Demo')
    expect(w.find('.abele-script-view > style').text()).toBe('')

    model.view = v
    model.status = { kind: 'live' }
    await nextTick()
    expect(w.text()).not.toContain('Starting')
    expect(w.find('.abele-script-node__text').text()).toBe('ready')
    expect(w.find('.abele-script-view').classes()).toContain('abele-script-view_live')
    expect(w.find('.abele-script-view > style').text()).toContain(
      '.abele-script-view[data-id="leaf-1"] .mine'
    )
  })
})

describe('nodes', () => {
  it('renders each type through its kit component', async () => {
    const v = make()
    v.body = [
      new Stack([new Text('t')]),
      new Row([new Badge('b')]),
      new Grid([new Card({ title: 'c' })]),
      new Section({ title: 's', children: [new EmptyState('nothing')] }),
      new Tabs({
        tabs: [
          { id: 'a', label: 'A', content: new Text('in a') },
          { id: 'b', label: 'B', content: new Text('in b') },
        ],
      }),
      new Setting({ name: 'n', children: [new Checkbox({ checked: true })] }),
      new Markdown('**m**'),
      new Image({ src: 'https://x/y.png' }),
      new Table({ columns: ['k'], rows: [['v'], [new Badge('cell')]] }),
      new Button({ text: 'go' }),
      new Icon({ icon: 'x', tooltip: 'close' }),
      new Input({ value: 'val' }),
    ]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    await flushPromises()
    expect(w.find('.abele-script-node__stack').text()).toBe('t')
    expect(w.find('.abele-badge').text()).toBe('b')
    expect(w.find('.abele-card-grid').exists()).toBe(true)
    expect(w.findComponent(KitCard).props('title')).toBe('c')
    expect(w.find('.abele-section__heading').text()).toBe('s')
    expect(w.find('.abele-empty-state').text()).toBe('nothing')
    expect(w.findComponent(KitTabs).props('tabs')).toEqual([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ])
    expect(w.text()).toContain('in a')
    expect(w.text()).not.toContain('in b')
    expect(w.find('.setting-item-name').text()).toBe('n')
    expect(w.find('.checkbox-container').classes()).toContain('is-enabled')
    expect(w.findComponent(KitMarkdown).props('text')).toBe('**m**')
    expect(w.find('img').attributes('src')).toBe('https://x/y.png')
    expect(
      w
        .findComponent(KitTable)
        .findAll('.abele-badge')
        .map((b) => b.text())
    ).toEqual(['cell'])
    expect(w.findComponent(KitButton).props('text')).toBe('go')
    expect(w.find('.abele-obsidian-icon').exists()).toBe(true)
    expect((w.find('input.abele-obsidian-input').element as HTMLInputElement).value).toBe('val')
  })

  it('puts the script own class on the root of the element', () => {
    const v = make()
    v.body = [new Text('x', { cls: 'mine' }), new Button({ text: 'b', cls: 'theirs' })]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    expect(w.find('.abele-script-node__text').classes()).toContain('mine')
    expect(w.find('button').classes()).toContain('theirs')
  })

  it('carries a press to the handler and an assignment to the DOM', async () => {
    const v = make()
    const pressed = vi.fn()
    const b = new Button({ text: 'Flip', onClick: pressed })
    v.body = [b]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    await w.findComponent(KitButton).trigger('click')
    expect(pressed).toHaveBeenCalledTimes(1)
    b.text = 'Flipped'
    b.disabled = true
    await nextTick()
    expect(w.find('button').text()).toBe('Flipped')
    expect(w.find('button').attributes('disabled')).toBeDefined()
    b.hidden = true
    await nextTick()
    expect(w.find('button').exists()).toBe(false)
  })

  it('switches tab content and tells the script', async () => {
    const v = make()
    const changed = vi.fn()
    const t = new Tabs({
      tabs: [
        { id: 'a', label: 'A', content: new Text('in a') },
        { id: 'b', label: 'B', content: new Text('in b') },
      ],
      onChange: changed,
    })
    v.body = [t]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    await w.findAll('.abele-tabs__tab')[1].trigger('click')
    await flushPromises()
    expect(t.active).toBe('b')
    expect(changed).toHaveBeenCalledWith('b')
    expect(w.text()).toContain('in b')
  })

  it('writes typing back into Input and fires input, change and enter', async () => {
    const v = make()
    const events: string[] = []
    const i = new Input({
      onInput: () => events.push('input'),
      onChange: () => events.push('change'),
      onEnter: () => events.push('enter'),
    })
    v.body = [i]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    // Driven one event at a time: test-utils' `setValue` fires `change` as well as `input`,
    // and what is being counted here is exactly which events reach the script.
    const input = w.find('input')
    ;(input.element as HTMLInputElement).value = 'abc'
    await input.trigger('input')
    await input.trigger('change')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(i.value).toBe('abc')
    expect(events).toEqual(['input', 'change', 'enter'])
  })

  it('renders the options of a Select and reports a pick', async () => {
    const v = make()
    const changed = vi.fn()
    const s = new Select({ options: ['a', { value: 'b', label: 'Bee' }], onChange: changed })
    v.body = [s]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    expect(w.findAll('option').map((o) => o.text())).toEqual(['a', 'Bee'])
    expect((w.find('select').element as HTMLSelectElement).value).toBe('a')
    await w.find('select').setValue('b')
    await flushPromises()
    expect(s.value).toBe('b')
    expect(changed).toHaveBeenCalledWith('b')
  })

  it('writes typing back into a Search, with or without a suggester', async () => {
    const v = make()
    const changed = vi.fn()
    const plain = new Search({ placeholder: 'Find', onChange: changed })
    const files = new Search({ suggest: 'file' })
    v.body = [plain, files]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    const inputs = w.findAll('input')
    expect(inputs).toHaveLength(2)
    expect(inputs[0].attributes('placeholder')).toBe('Find')
    await inputs[0].setValue('q')
    await flushPromises()
    expect(plain.value).toBe('q')
    expect(changed).toHaveBeenCalledWith('q')
  })

  it('toggles a checkbox and reports the new value', async () => {
    const v = make()
    const changed = vi.fn()
    const c = new Checkbox({ label: 'Done', onChange: changed })
    v.body = [c]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    await w.find('.checkbox-container').trigger('click')
    await flushPromises()
    expect(c.checked).toBe(true)
    expect(changed).toHaveBeenCalledWith(true)
    expect(w.text()).toContain('Done')
  })

  it('renders a note for Markdown({ file }) and re-renders when it changes', async () => {
    const v = make()
    v.body = [new Markdown({ file: 'Notes/a.md' })]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    await flushPromises()
    expect(w.findComponent(KitMarkdown).props('text')).toBe('hello from a')
    expect(w.findComponent(KitMarkdown).props('filePath')).toBe('Notes/a.md')

    const file = app.vault.getAbstractFileByPath('Notes/a.md') as TFile
    await app.vault.modify(file, 'changed')
    app.emit('vault', 'modify', file)
    await flushPromises()
    expect(w.findComponent(KitMarkdown).props('text')).toBe('changed')
  })

  it('a card is clickable only when the script listens', async () => {
    const v = make()
    const clicked = vi.fn()
    v.body = [new Card({ title: 'quiet' }), new Card({ title: 'loud', onClick: clicked })]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    const cards = w.findAllComponents(KitCard)
    expect(cards[0].props('clickable')).toBe(false)
    expect(cards[1].props('clickable')).toBe(true)
    await cards[1].trigger('click')
    expect(clicked).toHaveBeenCalled()
  })

  it('shows a handler error in the strip and stays alive', async () => {
    const v = make()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const b = new Button({
      text: 'bad',
      onClick: () => {
        throw new Error('bad press')
      },
    })
    v.body = [b]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    await w.findComponent(KitButton).trigger('click')
    await flushPromises()
    expect(w.find('.abele-script-view__error').text()).toBe('bad press')
    await w.find('.abele-script-view__errors .abele-obsidian-icon').trigger('click')
    expect(w.find('.abele-script-view__errors').exists()).toBe(false)
    expect(w.findComponent(KitButton).exists()).toBe(true)
  })

  it('shows a render error of a top-level node in the strip', async () => {
    const v = make()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // `ScriptNode` catches for the nodes below it, not for its own template: a top-level
    // node's throw goes up to the view, which is what this exercises.
    const c = new Card({ title: 'c' })
    ;(c as { badges: unknown }).badges = null
    v.body = [c]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    await flushPromises()
    expect(w.find('.abele-script-view__error').text()).toContain('length')
  })

  it('a card whose title a script unset still satisfies the kit', () => {
    const v = make()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c = new Card({ title: 'c', description: 'd' })
    ;(c as { title?: string }).title = undefined
    v.body = [c]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    expect(w.findComponent(KitCard).props('title')).toBe('')
    expect(warn).not.toHaveBeenCalled()
  })

  it('keeps the latest read of a note when two modify events settle out of order', async () => {
    const v = make()
    v.body = [new Markdown({ file: 'Notes/a.md' })]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    await flushPromises()
    const file = app.vault.getAbstractFileByPath('Notes/a.md') as TFile
    let releaseFirst!: (text: string) => void
    const reads = [
      new Promise<string>((resolve) => {
        releaseFirst = resolve
      }),
      Promise.resolve('fresh'),
    ]
    vi.spyOn(app.vault, 'cachedRead').mockImplementation(() => reads.shift() ?? Promise.resolve(''))
    app.emit('vault', 'modify', file)
    app.emit('vault', 'modify', file)
    await flushPromises()
    expect(w.findComponent(KitMarkdown).props('text')).toBe('fresh')
    releaseFirst('stale')
    await flushPromises()
    expect(w.findComponent(KitMarkdown).props('text')).toBe('fresh')
  })
})

describe('the script own CSS', () => {
  it('lands in a style element under the root, confined to this view', async () => {
    const v = make()
    v.style('.mine { color: var(--text-accent); }')
    v.body = [new Text('x', { cls: 'mine' })]
    const w = mount(ScriptViewComponent, { props: { model: live(v) } })
    await nextTick()
    const style = w.find('.abele-script-view > style')
    expect(style.exists()).toBe(true)
    expect(style.text()).toContain('.abele-script-view[data-id="leaf-1"] .mine')
  })
})
