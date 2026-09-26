/**
 * Taking back what a chat's agent changed in the vault.
 *
 * The tracker sits under the vault, its adapter and the file manager, so these drive those
 * layers directly — the way the tools, the reader's bookmarks and a script reach them — while a
 * recording is open, and then ask the chat's log to put things back. The vault is the in-memory
 * one, so what the files hold afterwards is read straight out of it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TFile, type App } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'
import { ChatRewind } from '@/ai/rewind/ChatRewind'
import { memoryStore } from '@/ai/rewind/RewindStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'

let fake: FakeApp
let app: App
let tracker: ChangeTracker
let turn: string
let store: ReturnType<typeof memoryStore>
let log: ChatRewind

const file = (path: string) => app.vault.getAbstractFileByPath(path) as TFile
const text = (path: string) => app.vault.read(file(path))
const exists = (path: string) => !!app.vault.getAbstractFileByPath(path)

/** Runs `fn` as one tool call of the chat's current turn. */
async function asAgent(fn: () => Promise<unknown>, tool = 'write'): Promise<void> {
  const end = log.begin(tool)
  try {
    await fn()
  } finally {
    await end()
  }
}

async function rewindSince(since: number, choices = {}) {
  const plan = await log.planSince(since)
  return { plan, result: await log.apply(plan, choices) }
}

beforeEach(() => {
  fake = useVault([
    { path: 'Notes/Plan.md', content: 'first draft' },
    { path: 'Notes/Other.md', content: 'untouched' },
    { path: 'Notes/Tagged.md', frontmatter: { status: 'open' }, content: 'body' },
  ])
  app = fake as unknown as App
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  tracker = ChangeTracker.install(app)
  turn = 'u1'
  store = memoryStore()
  log = new ChatRewind(app, { key: () => 'chat-1', turn: () => turn }, store)
})

afterEach(() => {
  tracker.uninstall()
})

describe('what is recorded', () => {
  it('a write, with the text it replaced', async () => {
    await asAgent(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))

    expect(log.entries.value).toHaveLength(1)
    const [change] = log.entries.value[0].changes
    expect(change.path).toBe('Notes/Plan.md')
    expect(change.before).toMatchObject({ t: 'text', text: 'first draft' })
    expect(log.entries.value[0]).toMatchObject({ turn: 'u1', tool: 'write' })
  })

  it('nothing while no tool is running — the person typing is not the agent', async () => {
    await app.vault.modify(file('Notes/Plan.md'), 'typed by hand')
    expect(log.entries.value).toEqual([])
  })

  it('nothing for a write that changed nothing', async () => {
    await asAgent(() => app.vault.modify(file('Notes/Plan.md'), 'first draft'))
    expect(log.entries.value).toEqual([])
  })

  it('one entry for a rename, though three layers took part in it', async () => {
    await asAgent(() => app.fileManager.renameFile(file('Notes/Plan.md'), 'Archive/Plan.md'), 'mv')
    expect(log.entries.value).toHaveLength(1)
    expect(log.entries.value[0].op).toBe('fileManager.renameFile')
  })

  it('never the plugin folder, the trash or a chat file', async () => {
    await asAgent(async () => {
      await app.vault.adapter.write('.obsidian/plugins/abele/data.json', '{}')
      await app.vault.create('AI/Chats/Talk.abchat', '{}')
    })
    expect(log.entries.value).toEqual([])
  })

  it('is written to the store, and read back by the chat reopened', async () => {
    await asAgent(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))
    const reopened = new ChatRewind(app, { key: () => 'chat-1', turn: () => null }, store)
    await reopened.load()
    expect(reopened.entries.value.map((e) => e.id)).toEqual(log.entries.value.map((e) => e.id))
  })
})

describe('rewinding', () => {
  it('puts a rewritten note back', async () => {
    const since = Date.now()
    await asAgent(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))

    const { plan, result } = await rewindSince(since)
    expect(plan.items).toMatchObject([
      {
        path: 'Notes/Plan.md',
        action: 'rewrite',
        diff: { old: 'second draft', new: 'first draft' },
      },
    ])
    expect(result.restored).toEqual(['Notes/Plan.md'])
    expect(await text('Notes/Plan.md')).toBe('first draft')
    expect(log.entries.value).toEqual([])
  })

  it('takes a note back past several writes to the state before the first', async () => {
    const since = Date.now()
    await asAgent(() => app.vault.process(file('Notes/Plan.md'), (t) => t + ' + one'), 'edit')
    turn = 'u2'
    await asAgent(() => app.vault.append(file('Notes/Plan.md'), ' + two'), 'edit')

    await rewindSince(since)
    expect(await text('Notes/Plan.md')).toBe('first draft')
  })

  it('sends a file the agent made to the trash', async () => {
    const since = Date.now()
    await asAgent(() => app.vault.create('Notes/New.md', 'made up'), 'create')
    const { plan } = await rewindSince(since)
    expect(plan.items[0]).toMatchObject({ path: 'Notes/New.md', action: 'remove' })
    expect(exists('Notes/New.md')).toBe(false)
  })

  it('makes a deleted note again', async () => {
    const since = Date.now()
    await asAgent(() => app.fileManager.trashFile(file('Notes/Other.md')), 'rm')
    expect(exists('Notes/Other.md')).toBe(false)
    await rewindSince(since)
    expect(await text('Notes/Other.md')).toBe('untouched')
  })

  it('moves a renamed note back, the same file object and all', async () => {
    const since = Date.now()
    const note = file('Notes/Plan.md')
    await asAgent(() => app.fileManager.renameFile(note, 'Archive/Plan.md'), 'mv')

    const { plan } = await rewindSince(since)
    expect(plan.items).toMatchObject([
      { path: 'Notes/Plan.md', action: 'move-back', from: 'Archive/Plan.md' },
    ])
    expect(note.path).toBe('Notes/Plan.md')
    expect(exists('Archive/Plan.md')).toBe(false)
    expect(log.entries.value).toEqual([])
  })

  it('moves back a note that was renamed and then edited, with its old text', async () => {
    const since = Date.now()
    await asAgent(() => app.fileManager.renameFile(file('Notes/Plan.md'), 'Archive/Plan.md'), 'mv')
    await asAgent(() => app.vault.modify(file('Archive/Plan.md'), 'edited after the move'))

    await rewindSince(since)
    expect(await text('Notes/Plan.md')).toBe('first draft')
    expect(exists('Archive/Plan.md')).toBe(false)
  })

  it('undoes a frontmatter edit', async () => {
    const before = await text('Notes/Tagged.md')
    const since = Date.now()
    await asAgent(
      () =>
        app.fileManager.processFrontMatter(file('Notes/Tagged.md'), (fm) => (fm.status = 'done')),
      'replace'
    )
    expect(await text('Notes/Tagged.md')).not.toBe(before)
    await rewindSince(since)
    expect(await text('Notes/Tagged.md')).toBe(before)
  })

  it('puts back a picture, from the copy kept beside the log', async () => {
    await app.vault.createBinary('Media/cat.png', new Uint8Array([1, 2, 3]).buffer)
    const since = Date.now()
    await asAgent(() =>
      (
        app.vault as unknown as { modifyBinary: (f: TFile, d: ArrayBuffer) => Promise<void> }
      ).modifyBinary(file('Media/cat.png'), new Uint8Array([9, 9]).buffer)
    )
    expect(store.blobs.size).toBe(1)

    await rewindSince(since)
    const bytes = new Uint8Array(await fake.vault.adapter.readBinary('Media/cat.png'))
    expect([...bytes]).toEqual([1, 2, 3])
  })

  it('brings back a folder sent to the trash, with everything that was in it', async () => {
    const since = Date.now()
    await asAgent(
      () => app.fileManager.trashFile(app.vault.getAbstractFileByPath('Notes') as TFile),
      'rm'
    )
    expect(exists('Notes/Plan.md')).toBe(false)

    await rewindSince(since)
    expect(await text('Notes/Plan.md')).toBe('first draft')
    expect(await text('Notes/Other.md')).toBe('untouched')
  })

  it('takes back what the reader wrote straight through the adapter', async () => {
    const since = Date.now()
    await asAgent(
      () => app.vault.adapter.write('Books/marks.json', '{"marks":[1]}'),
      'book_bookmark'
    )
    const { plan } = await rewindSince(since)
    expect(plan.items[0]).toMatchObject({ path: 'Books/marks.json', action: 'remove' })
    expect(await app.vault.adapter.exists('Books/marks.json')).toBe(false)
  })

  it('does not record its own writes into another chat running at the same time', async () => {
    const other = new ChatRewind(app, { key: () => 'chat-2', turn: () => 'x' }, store)
    const since = Date.now()
    await asAgent(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))

    const end = other.begin('write')
    await rewindSince(since)
    await end()
    expect(other.entries.value).toEqual([])
  })
})

describe('a file changed since the agent left it', () => {
  beforeEach(async () => {
    await asAgent(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))
    await app.vault.modify(file('Notes/Plan.md'), 'second draft, and my own words')
  })

  it('is shown as changed since', async () => {
    const plan = await log.planSince(0)
    expect(plan.items).toMatchObject([{ path: 'Notes/Plan.md', conflict: true }])
  })

  it('is left alone unless the person says otherwise, and stays in the log', async () => {
    const { result } = await rewindSince(0)
    expect(result.skipped).toEqual(['Notes/Plan.md'])
    expect(await text('Notes/Plan.md')).toBe('second draft, and my own words')
    expect(log.entries.value).toHaveLength(1)
  })

  it('is put back when the person chooses to overwrite it', async () => {
    await rewindSince(0, { 'Notes/Plan.md': 'overwrite' })
    expect(await text('Notes/Plan.md')).toBe('first draft')
  })
})

describe('undoing one turn', () => {
  it('takes back that turn alone', async () => {
    await asAgent(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))
    turn = 'u2'
    await asAgent(() => app.vault.modify(file('Notes/Other.md'), 'touched later'))

    expect([...log.turnsWithChanges()]).toEqual(['u1', 'u2'])
    const plan = await log.planTurn('u1')
    await log.apply(plan, {})
    expect(await text('Notes/Plan.md')).toBe('first draft')
    expect(await text('Notes/Other.md')).toBe('touched later')
    expect([...log.turnsWithChanges()]).toEqual(['u2'])
  })

  it('calls a later turn’s change to the same file a change since', async () => {
    await asAgent(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))
    turn = 'u2'
    await asAgent(() => app.vault.modify(file('Notes/Plan.md'), 'third draft'))
    const plan = await log.planTurn('u1')
    expect(plan.items[0].conflict).toBe(true)
  })
})

describe('the room the copies may take', () => {
  it('drops the chat written to least recently first', async () => {
    const older = new ChatRewind(app, { key: () => 'old-chat', turn: () => 'o1' }, store)
    // What the old chat keeps is the long text the note had before its agent shortened it.
    await app.vault.modify(file('Notes/Other.md'), 'x'.repeat(4000))
    const end = older.begin('write')
    await app.vault.modify(file('Notes/Other.md'), 'short')
    await end()

    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, rewindLimitMb: 0.003 }
    await asAgent(() => app.vault.modify(file('Notes/Plan.md'), 'y'.repeat(10)))

    const kept = (await store.usage()).map((u) => u.key)
    expect(kept).toEqual(['chat-1'])
  })

  it('records nothing with the room set to zero', async () => {
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, rewindLimitMb: 0 }
    await asAgent(() => app.vault.modify(file('Notes/Plan.md'), 'second draft'))
    expect(log.entries.value).toEqual([])
  })
})
