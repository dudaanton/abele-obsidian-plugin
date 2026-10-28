import { afterEach, expect, it, vi } from 'vitest'
import { TFile, type App } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { ChatRewind } from '@/ai/rewind/ChatRewind'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'
import { memoryStore } from '@/ai/rewind/RewindStore'

afterEach(() => {
  ChangeTracker.get()?.uninstall()
  vi.restoreAllMocks()
})
it('does not publish snapshots from an invalidated tool invocation', async () => {
  const app = useVault([{ path: 'sample.md', content: 'before' }]) as unknown as App
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  ChangeTracker.install(app)
  const store = memoryStore()
  const log = new ChatRewind(app, { key: () => 'sample-chat', turn: () => 'sample-turn' }, store)
  let current = true
  const owner = log.track('write', 'sample-run', undefined, () => current)
  current = false
  await owner.app.vault.modify(app.vault.getAbstractFileByPath('sample.md') as TFile, 'late')
  await owner.close()
  expect(log.entries.value).toEqual([])
  expect((await store.readLog('sample-chat'))?.entries ?? []).toEqual([])
})

it.each(['chat-b', null])(
  'saves late text and binary edits under the captured owner after host becomes %s',
  async (next) => {
    const app = useVault([
      { path: 'alpha.md', content: 'original' },
      { path: 'beta.md', content: 'beta original' },
    ]) as unknown as App
    const binary = await app.vault.createBinary('sample.bin', new Uint8Array([1]).buffer)
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
    ChangeTracker.install(app)
    let key: string | null = 'chat-a'
    const store = memoryStore()
    const log = new ChatRewind(app, { key: () => key, turn: () => key + '-turn' }, store)
    const owner = log.track('script_sample', 'run-a')
    await owner.close()
    key = next
    if (key) {
      const current = log.track('write', 'run-b')
      await current.app.vault.modify(
        app.vault.getAbstractFileByPath('beta.md') as TFile,
        'beta changed'
      )
      await current.close()
    }
    await owner.app.vault.modify(app.vault.getAbstractFileByPath('alpha.md') as TFile, 'late alpha')
    await owner.app.vault.modifyBinary(binary, new Uint8Array([2]).buffer)
    await log.flush()
    expect((await store.readLog('chat-a'))?.entries).toHaveLength(2)
    expect(
      (await store.readLog('chat-a'))?.entries.every(
        (e) => e.chat === 'chat-a' && e.run === 'run-a'
      )
    ).toBe(true)
    expect((await store.readLog('chat-b'))?.entries.length ?? 0).toBe(next ? 1 : 0)
    expect(log.entries.value.every((e) => e.chat === next)).toBe(true)
    const reopened = new ChatRewind(app, { key: () => 'chat-a', turn: () => null }, store)
    const plan = await reopened.planSince(0)
    expect(plan.items.map((i) => i.path).sort()).toEqual(['alpha.md', 'sample.bin'])
    expect((await reopened.apply(plan)).restored.sort()).toEqual(['alpha.md', 'sample.bin'])
    expect(await app.vault.read(app.vault.getAbstractFileByPath('alpha.md') as TFile)).toBe(
      'original'
    )
    expect(new Uint8Array(await app.vault.readBinary(binary))).toEqual(new Uint8Array([1]))
    if (next)
      expect(await app.vault.read(app.vault.getAbstractFileByPath('beta.md') as TFile)).toBe(
        'beta changed'
      )
  }
)
