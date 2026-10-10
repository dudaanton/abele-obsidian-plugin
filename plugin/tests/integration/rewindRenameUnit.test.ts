import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TFile, type App } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'
import { ChatRewind } from '@/ai/rewind/ChatRewind'
import { memoryStore } from '@/ai/rewind/RewindStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'

let app: App
let log: ChatRewind
let owned: App
const file = (path: string) => app.vault.getAbstractFileByPath(path) as TFile
const text = (path: string) => (file(path) ? app.vault.read(file(path)) : Promise.resolve(null))
beforeEach(() => {
  app = useVault([{ path: 'old.md', content: 'original' }]) as unknown as App
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  ChangeTracker.install(app)
  log = new ChatRewind(app, { key: () => 'chat-a', turn: () => 'turn-a' }, memoryStore())
  owned = log.track('edit', 'run-a').app
})
afterEach(() => {
  ChangeTracker.get()?.uninstall()
  vi.restoreAllMocks()
})

it('keeps the destination when a human edit interrupted the source before its rename', async () => {
  await owned.vault.modify(file('old.md'), 'alpha')
  await app.vault.modify(file('old.md'), 'human')
  await owned.fileManager.renameFile(file('old.md'), 'new.md')
  const result = await log.apply(await log.planSince(0))
  expect(await text('new.md')).toBe('human')
  expect(await text('old.md')).toBeNull()
  expect(result.skipped.sort()).toEqual(['new.md', 'old.md'])
  expect(log.entries.value).toHaveLength(2)
})

it.each(['before-preview', 'after-preview'])(
  'keeps both paths when someone occupies the source %s',
  async (when) => {
    await owned.fileManager.renameFile(file('old.md'), 'new.md')
    await owned.vault.modify(file('new.md'), 'alpha')
    if (when === 'before-preview') await app.vault.create('old.md', 'human')
    const plan = await log.planSince(0)
    if (when === 'after-preview') await app.vault.create('old.md', 'human')
    await log.apply(plan)
    expect(await text('old.md')).toBe('human')
    expect(await text('new.md')).toBe('alpha')
    expect(log.entries.value).toHaveLength(2)
  }
)

it('rechecks the restored source before deleting the destination', async () => {
  await owned.fileManager.renameFile(file('old.md'), 'new.md')
  await owned.vault.modify(file('new.md'), 'alpha')
  const plan = await log.planSince(0)
  const create = app.vault.create.bind(app.vault)
  vi.spyOn(app.vault, 'create').mockImplementation(async (path, content) => {
    const made = await create(path, content)
    if (path === 'old.md') await app.vault.modify(made, 'human after restoration')
    return made
  })
  await log.apply(plan)
  expect(await text('old.md')).toBe('human after restoration')
  expect(await text('new.md')).toBe('alpha')
  expect(log.entries.value).toHaveLength(2)
})

it('propagates a refusal through a chain of renamed paths', async () => {
  await owned.vault.modify(file('old.md'), 'alpha')
  await app.vault.modify(file('old.md'), 'human')
  await owned.fileManager.renameFile(file('old.md'), 'middle.md')
  await owned.fileManager.renameFile(file('middle.md'), 'new.md')
  await log.apply(await log.planSince(0))
  expect(await text('new.md')).toBe('human')
  expect(await text('old.md')).toBeNull()
  expect(await text('middle.md')).toBeNull()
  expect(log.entries.value).toHaveLength(3)
})
