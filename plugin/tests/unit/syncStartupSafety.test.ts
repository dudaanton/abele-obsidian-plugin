import { expect, it } from 'vitest'
import { MemoryStateStore } from '@abele/sync-sdk/core'
import { startupSafetyReason } from '@/sync/startupSafety'

async function ledger(count: number) {
  const state = new MemoryStateStore()
  for (let i = 0; i < count; i++)
    await state.put({
      path: `Notes/sample-${i}.md`,
      wirePath: `Notes/sample-${i}.md`,
      fileId: String(i),
      versionId: 'v1',
      sha: 'a'.repeat(64),
      size: 1,
      mtime: 1,
    })
  return state
}
it.each([0, 1, 9])('stops a missing or mostly missing root with %i files', async (count) => {
  const state = await ledger(100)
  const reason = await startupSafetyReason(
    state,
    async () => ({
      files: Array.from({ length: count }, (_, i) => `Notes/local-${i}.md`),
      folders: [],
    }),
    'Notes'
  )
  expect(reason).toContain('Resume')
  expect(await state.get('Notes/sample-0.md')).not.toBeNull()
})
it('allows new empty vaults and small ledgers', async () => {
  expect(
    await startupSafetyReason(await ledger(99), async () => ({ files: [], folders: [] }), '')
  ).toBeNull()
})
it('stops listing once a tenth of the previous population is present', async () => {
  const reason = await startupSafetyReason(
    await ledger(100),
    async (path) => {
      if (path === 'Other') throw new Error('must not walk further')
      return { files: Array.from({ length: 10 }, (_, i) => `sample-${i}.md`), folders: ['Other'] }
    },
    ''
  )
  expect(reason).toBeNull()
})
it('does not count private sync data as vault files', async () => {
  expect(
    await startupSafetyReason(
      await ledger(100),
      async () => ({ files: [], folders: ['.abele-sync'] }),
      ''
    )
  ).toContain('Resume')
})
it('does not count retained copies in configured private directories', async () => {
  expect(
    await startupSafetyReason(
      await ledger(100),
      async () => ({ files: [], folders: ['.config/plugins/abele/sync-recovery'] }),
      '',
      () => {},
      ['.config/plugins/abele/sync-recovery']
    )
  ).toContain('Resume')
})
it('checks the physical folder and propagates unreadable listings without approving startup', async () => {
  await expect(
    startupSafetyReason(
      await ledger(100),
      async (path) => {
        expect(path).toBe('Moved')
        throw new Error('unmounted')
      },
      'Moved'
    )
  ).rejects.toThrow('unmounted')
})

it.each([0, 50, 100, 101])(
  'does not approve startup when interrupted at check %i',
  async (boundary) => {
    const state = await ledger(100)
    let checks = 0
    await expect(
      startupSafetyReason(
        state,
        async () => ({ files: [], folders: [] }),
        '',
        () => {
          if (checks++ === boundary) throw new Error('startup cancelled')
        }
      )
    ).rejects.toThrow('startup cancelled')
    expect(await state.get('Notes/sample-0.md')).not.toBeNull()
  }
)
