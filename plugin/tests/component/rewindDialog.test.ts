/**
 * The dialog that takes back what a chat's agent changed: which files it lists and what it says
 * will happen to each, the choice it asks for on a file somebody changed since, and what each
 * of its buttons does — to the files and to the conversation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { TFile, type App } from 'obsidian'
import AiRewindDialog from '@/components/AiRewindDialog.vue'
import Button from '@/components/obsidian/Button.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
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
  await fn()
  await end()
}

async function open(mode: 'since' | 'turn' = 'since') {
  const view = mount(AiRewindDialog, {
    props: { rewind, mode, messageId: 'u1', since: 0 },
    global: { stubs: STUBS },
  })
  await flushPromises()
  return view
}

const button = (view: Awaited<ReturnType<typeof open>>, text: string) =>
  view.findAllComponents(Button).find((b) => b.props('text') === text)!

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
    expect(rows.map((r) => [r.props('text'), r.props('flair')])).toEqual([
      ['Notes/New.md', 'to the trash'],
      ['Notes/Plan.md', 'put back'],
    ])
    await rows[1].find('.tree-item-self').trigger('click')
    expect(view.find('.diff-stub').text()).toBe('second draft|first draft')
  })

  it('says so when the agent changed nothing', async () => {
    const view = await open()
    expect(view.text()).toContain('The agent changed no files from here on.')
    expect(button(view, 'Files only').props('disabled')).toBe(true)
  })
})

describe('the buttons', () => {
  it('"Files only" puts the files back and leaves the conversation', async () => {
    await agentWrites(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))
    const view = await open()
    await button(view, 'Files only').trigger('click')
    await flushPromises()

    expect(await app.vault.read(file('Notes/Plan.md'))).toBe('first draft')
    expect(view.emitted('conversation')).toBeUndefined()
    expect(view.emitted('close')).toHaveLength(1)
  })

  it('"Files and conversation" does both', async () => {
    await agentWrites(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))
    const view = await open()
    await button(view, 'Files and conversation').trigger('click')
    await flushPromises()

    expect(await app.vault.read(file('Notes/Plan.md'))).toBe('first draft')
    expect(view.emitted('conversation')).toEqual([['u1']])
  })

  it('"Conversation only" leaves the files alone', async () => {
    await agentWrites(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))
    const view = await open()
    await button(view, 'Conversation only').trigger('click')
    await flushPromises()

    expect(await app.vault.read(file('Notes/Plan.md'))).toBe('second draft')
    expect(view.emitted('conversation')).toEqual([['u1']])
  })

  it('undoing a turn offers the one button', async () => {
    await agentWrites(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))
    const view = await open('turn')
    expect(view.findAllComponents(Button).map((b) => b.props('text'))).toEqual(['Undo changes'])
    await button(view, 'Undo changes').trigger('click')
    await flushPromises()
    expect(await app.vault.read(file('Notes/Plan.md'))).toBe('first draft')
  })
})

describe('a file changed since', () => {
  beforeEach(async () => {
    await agentWrites(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))
    await app.vault.modify(file('Notes/Plan.md'), 'my own words')
  })

  it('is marked, and left alone unless the person chooses otherwise', async () => {
    const view = await open()
    expect(view.findComponent(TreeItem).props('flair')).toBe('changed since')
    await button(view, 'Files only').trigger('click')
    await flushPromises()
    expect(await app.vault.read(file('Notes/Plan.md'))).toBe('my own words')
  })

  it('is put back once the person says to', async () => {
    const view = await open()
    await view.findComponent(TreeItem).find('.tree-item-self').trigger('click')
    view.findComponent(Dropdown).vm.$emit('update:modelValue', 'overwrite')
    await button(view, 'Files only').trigger('click')
    await flushPromises()
    expect(await app.vault.read(file('Notes/Plan.md'))).toBe('first draft')
  })
})
