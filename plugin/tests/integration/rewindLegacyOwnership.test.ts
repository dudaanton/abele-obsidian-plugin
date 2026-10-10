import { afterEach, expect, it } from 'vitest'
import { TFile, type App } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'
import { ChatRewind } from '@/ai/rewind/ChatRewind'
import { memoryStore } from '@/ai/rewind/RewindStore'
import { contentHash } from '@/ai/readGuard'

afterEach(() => ChangeTracker.get()?.uninstall())
it.each(['created', 'modified'] as const)(
  'refuses legacy %s evidence even when bytes match the journal',
  async (kind) => {
    const app = useVault([{ path: 'sample.md', content: 'other chat' }]) as unknown as App
    ChangeTracker.install(app)
    const store = memoryStore()
    await store.writeLog('chat-a', {
      version: 1,
      entries: [
        {
          id: 'legacy',
          turn: 'old-turn',
          at: 1,
          op: 'write',
          changes: [
            {
              path: 'sample.md',
              after: contentHash('other chat'),
              before:
                kind === 'created'
                  ? { t: 'missing' }
                  : { t: 'text', text: 'original', hash: contentHash('original') },
            },
          ],
        },
      ],
    })
    const log = new ChatRewind(app, { key: () => 'chat-a', turn: () => null }, store)
    const plan = await log.planSince(0)
    expect(plan.items[0]).toMatchObject({
      conflict: true,
      reason: expect.stringMatching(/no chat owner/i),
    })
    // Even an old caller retaining an earlier preview cannot authorize an unowned snapshot.
    plan.items[0].conflict = false
    const result = await log.apply(plan, { 'sample.md': 'overwrite' })
    expect(result.skipped).toEqual(['sample.md'])
    expect(await app.vault.read(app.vault.getAbstractFileByPath('sample.md') as TFile)).toBe(
      'other chat'
    )
    expect(log.entries.value).toHaveLength(1)
  }
)
