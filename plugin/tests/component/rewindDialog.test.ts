/**
 * The dialog that takes back what a chat's agent changed: which files it lists and what it says
 * will happen to each, the choice it asks for on a file somebody changed since, and what its
 * switches and its button do — to the files and to the conversation. Files go back only from a
 * button that says so, with the switch for them turned on here: it starts off.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { TFile, type App } from 'obsidian'
import AiRewindDialog from '@/components/AiRewindDialog.vue'
import Button from '@/components/obsidian/Button.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import StatusDot from '@/components/obsidian/StatusDot.vue'
import TreeItem from '@/components/obsidian/TreeItem.vue'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'
import { ChatRewind } from '@/ai/rewind/ChatRewind'
import { memoryStore } from '@/ai/rewind/RewindStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const STUBS = {
  ObsidianModal: { template: '<div><slot /><slot name="footer" /></div>' },
  // CodeMirror's merge view needs layout; what matters here is which texts it is given.
  Diff: {
    props: ['textLeft', 'textRight'],
    template: '<pre class="diff-stub">{{ textLeft }}|{{ textRight }}</pre>',
  },
}

let app: App
let tracker: ChangeTracker
let rewind: ChatRewind

const file = (path: string) => app.vault.getAbstractFileByPath(path) as TFile

async function agentWrites(fn: () => Promise<unknown>) {
  const end = rewind.begin('write')
  const host = app
  app = end.app
  try {
    await fn()
  } finally {
    app = host
    await end()
  }
}

async function open(mode: 'since' | 'turn' = 'since') {
  const view = mount(AiRewindDialog, {
    props: { rewind, mode, messageId: 'u1', since: 0 },
    global: { stubs: STUBS },
  })
  await flushPromises()
  return view
}

type View = Awaited<ReturnType<typeof open>>
const button = (view: View, text: string) =>
  view.findAllComponents(Button).find((b) => b.props('text') === text)!
/** The footer's last button, the one that acts; Cancel stands before it. */
const main = (view: View) => view.findAllComponents(Button).at(-1)!
/** The switch beside a settings row's name: "Put files back" or "Go back in chat". */
const toggle = (view: View, name: string) =>
  view
    .findAll('.setting-item')
    .find((row) => row.find('.setting-item-name').text() === name)!
    .findComponent(Checkbox)
/** What a file row's glyph says will happen to it, in its tooltip. */
const glyphSays = (row: ReturnType<View['findComponent']>) =>
  row.find('.abele-tree-item__glyph').attributes('aria-label')

beforeEach(() => {
  app = useVault([
    { path: 'Notes/Plan.md', content: 'first draft' },
    { path: 'Notes/Other.md', content: 'untouched' },
  ]) as unknown as App
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  tracker = ChangeTracker.install(app)
  rewind = new ChatRewind(app, { key: () => 'chat', turn: () => 'u1' }, memoryStore())
})

afterEach(() => tracker.uninstall())

describe('the list of files', () => {
  it('names each file with what will happen to it, and opens to the difference', async () => {
    await agentWrites(async () => {
      await app.vault.modify(file('Notes/Plan.md'), 'second draft')
      await app.vault.create('Notes/New.md', 'made up')
    })
    const view = await open()

    const rows = view.findAllComponents(TreeItem)
    expect(
      rows.map((r) => [r.props('note'), r.props('text'), r.props('icon'), glyphSays(r)])
    ).toEqual([
      ['Notes', 'New.md', 'trash-2', 'To the trash'],
      ['Notes', 'Plan.md', 'file-pen', 'Text put back'],
    ])
    expect(view.findAllComponents(StatusDot)).toHaveLength(0)
    await rows[1].find('.tree-item-self').trigger('click')
    expect(view.find('.diff-stub').text()).toBe('second draft|first draft')
  })

  it('says so when the agent changed nothing', async () => {
    const view = await open()
    expect(view.text()).toContain('The agent changed no files from here on.')
    expect(toggle(view, 'Put files back').props()).toMatchObject({
      isEnabled: false,
      disabled: true,
    })
    // Going back in the chat is still there to do.
    expect(button(view, 'Go back in chat').props('disabled')).toBe(false)
  })
})

describe('the buttons', () => {
  it('opens going back in the chat only: files go back by no button that does not say so', async () => {
    await agentWrites(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))
    const view = await open()
    expect(view.findAllComponents(Button).map((b) => b.props('text'))).toEqual([
      'Cancel',
      'Go back in chat',
    ])
    expect(toggle(view, 'Put files back').props('isEnabled')).toBe(false)
    expect(toggle(view, 'Go back in chat').props('isEnabled')).toBe(true)
    await main(view).trigger('click')
    await flushPromises()

    expect(await app.vault.read(file('Notes/Plan.md'))).toBe('second draft')
    expect(view.emitted('conversation')).toEqual([['u1']])
  })

  it('puts the files back only from a red button named so, with the switch turned on', async () => {
    await agentWrites(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))
    const view = await open()
    await toggle(view, 'Put files back').trigger('click')
    await toggle(view, 'Go back in chat').trigger('click')
    expect(main(view).props()).toMatchObject({ text: 'Put files back', warning: true })
    await main(view).trigger('click')
    await flushPromises()

    expect(await app.vault.read(file('Notes/Plan.md'))).toBe('first draft')
    expect(view.emitted('conversation')).toBeUndefined()
    expect(view.emitted('close')).toHaveLength(1)
  })

  it('does both when both are on, and says both', async () => {
    await agentWrites(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))
    const view = await open()
    await toggle(view, 'Put files back').trigger('click')
    expect(main(view).props('text')).toBe('Put files back and go back')
    await main(view).trigger('click')
    await flushPromises()

    expect(await app.vault.read(file('Notes/Plan.md'))).toBe('first draft')
    expect(view.emitted('conversation')).toEqual([['u1']])
  })

  it('has nothing to do with both switches off', async () => {
    await agentWrites(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))
    const view = await open()
    await toggle(view, 'Go back in chat').trigger('click')
    expect(main(view).props('disabled')).toBe(true)
    await main(view).trigger('click')
    await flushPromises()

    expect(await app.vault.read(file('Notes/Plan.md'))).toBe('second draft')
    expect(view.emitted('conversation')).toBeUndefined()
    expect(view.emitted('close')).toBeUndefined()
  })

  it('undoing a turn names what it does to the files', async () => {
    await agentWrites(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))
    const view = await open('turn')
    expect(view.findAllComponents(Button).map((b) => b.props('text'))).toEqual([
      'Cancel',
      'Put files back',
    ])
    expect(main(view).props('warning')).toBe(true)
    await main(view).trigger('click')
    await flushPromises()
    expect(await app.vault.read(file('Notes/Plan.md'))).toBe('first draft')
  })

  it('closes on Cancel and changes nothing', async () => {
    await agentWrites(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))
    const view = await open('turn')
    await button(view, 'Cancel').trigger('click')
    await flushPromises()
    expect(view.emitted('close')).toHaveLength(1)
    expect(await app.vault.read(file('Notes/Plan.md'))).toBe('second draft')
  })
})

it('explains that a legacy snapshot has no proven owner instead of offering overwrite', async () => {
  await agentWrites(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))
  rewind.entries.value = rewind.entries.value.map(({ chat: _chat, run: _run, ...entry }) => entry)
  const view = await open()
  const row = view.findComponent(TreeItem)
  expect(glyphSays(row)).toBe('Owner not verified')
  expect(row.findComponent(StatusDot).props()).toMatchObject({ tone: 'orange' })
  expect(row.findComponent(StatusDot).props('label')).toContain('no chat owner')
  await row.find('.tree-item-self').trigger('click')
  expect(view.text()).toContain('no chat owner')
  expect(view.findComponent(Dropdown).exists()).toBe(false)
  expect(toggle(view, 'Put files back').props('disabled')).toBe(true)
  await toggle(view, 'Go back in chat').trigger('click')
  expect(main(view).props('disabled')).toBe(true)
  expect(await app.vault.read(file('Notes/Plan.md'))).toBe('second draft')
})

describe('a file changed since', () => {
  beforeEach(async () => {
    await agentWrites(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))
    await app.vault.modify(file('Notes/Plan.md'), 'my own words')
  })

  it('is marked, and left alone unless the person chooses otherwise', async () => {
    const view = await open()
    const row = view.findComponent(TreeItem)
    expect(glyphSays(row)).toBe('Changed since')
    expect(row.findComponent(StatusDot).props()).toMatchObject({
      tone: 'orange',
      label: 'Changed since; left as it is',
    })
    await main(view).trigger('click')
    await flushPromises()
    expect(await app.vault.read(file('Notes/Plan.md'))).toBe('my own words')
  })

  // BUG: the old overwrite control allowed undo to destroy another writer's work.
  it.fails('is put back once the person says to', async () => {
    const view = await open()
    await view.findComponent(TreeItem).find('.tree-item-self').trigger('click')
    view.findComponent(Dropdown).vm.$emit('update:modelValue', 'overwrite')
    await toggle(view, 'Put files back').trigger('click')
    await main(view).trigger('click')
    await flushPromises()
    expect(await app.vault.read(file('Notes/Plan.md'))).toBe('first draft')
  })
})
