import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { App, Plugin } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { DEFAULT_READER_SETTINGS } from '@/reader/settings'
import { initBookBookmarks, bookBookmarkWriter, BOOKMARKS_FILE } from '@/reader/bookmarkFiles'
import { parseBookmarks } from '@/reader/bookmarks'
import { ChatRewind } from '@/ai/rewind/ChatRewind'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'
import { memoryStore } from '@/ai/rewind/RewindStore'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const close of cleanups.splice(0)) close()
  ChangeTracker.get()?.uninstall()
  vi.restoreAllMocks()
})

it('serializes concurrent invocation bookmark read-merge-write transactions', async () => {
  const app = useVault([]) as unknown as App
  await app.vault.adapter.mkdir('.obsidian/plugins/abele')
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  AbeleConfig.getInstance().reader = { ...DEFAULT_READER_SETTINGS }
  initBookBookmarks({
    app,
    manifest: { dir: '.obsidian/plugins/abele' },
    registerEvent: () => {},
    register: (close: () => void) => cleanups.push(close),
  } as unknown as Plugin)
  let release!: () => void, entered!: () => void
  const held = new Promise<void>((r) => {
    release = r
  })
  const ready = new Promise<void>((r) => {
    entered = r
  })
  const write = app.vault.adapter.write
  let first = true
  vi.spyOn(app.vault.adapter, 'write').mockImplementation(async function (
    this: App['vault']['adapter'],
    path,
    bytes
  ) {
    if (path.endsWith('book-bookmarks.backup.json') && first) {
      first = false
      entered()
      await held
    }
    await write.call(this, path, bytes)
  })
  ChangeTracker.install(app)
  const journal = memoryStore()
  const a = new ChatRewind(app, { key: () => 'chat-a', turn: () => 'a' }, journal)
  const b = new ChatRewind(app, { key: () => 'chat-b', turn: () => 'b' }, journal)
  const left = a.track('book_bookmark', 'run-a'),
    right = b.track('book_bookmark', 'run-b')
  const [one, two] = await Promise.all([
    bookBookmarkWriter(left.app),
    bookBookmarkWriter(right.app),
  ])
  const mark = (label: string) => ({ cfi: label, fraction: 0.5, label, text: label })
  await Promise.all([one!.add('sample-book', mark('alpha')), two!.add('sample-book', mark('beta'))])
  const savingOne = one!.flush()
  await ready
  const savingTwo = two!.flush()
  await flushPromises()
  release()
  await Promise.all([savingOne, savingTwo, left.close(), right.close()])
  const saved = parseBookmarks(await app.vault.adapter.read(BOOKMARKS_FILE))!
  expect(
    Object.values(saved['sample-book'])
      .map((m) => m.label)
      .sort()
  ).toEqual(['alpha', 'beta'])
  expect(a.entries.value.flatMap((e) => e.changes.map((c) => c.path))).toEqual([BOOKMARKS_FILE])
  expect(b.entries.value.flatMap((e) => e.changes.map((c) => c.path))).toEqual([BOOKMARKS_FILE])
  const before = b.entries.value[0].changes[0].before
  expect(before).toMatchObject({ t: 'text', text: expect.stringContaining('alpha') })
  expect((await b.planSince(0)).items[0].conflict).toBe(false)
})
