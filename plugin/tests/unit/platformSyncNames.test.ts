import { expect, it } from 'vitest'
import { validatePath } from '@abele/sync-sdk/protocol'
import { unsupportedSyncName } from '@/sync/platformSyncNames'

it.each(['windows', 'android', 'macos', 'linux', 'ios'] as const)(
  'holds OS-specific names only on %s',
  (platform) => {
    for (const path of [
      'Notes/sample:part.md',
      'Notes/sample*.md',
      'Notes/sample?.md',
      'Notes/sample".md',
      'Notes/sample<.md',
      'Notes/sample>.md',
      'Notes/sample|.md',
      'Notes/sample.',
      'Notes/sample ',
      'Notes/CON.md',
      'Notes/lpt1',
    ])
      expect(!!unsupportedSyncName(path, platform)).toBe(
        platform === 'windows' || platform === 'android'
      )
    expect(unsupportedSyncName('Notes/sample.md', platform)).toBeNull()
  }
)
it('D-011 admits platform-neutral wire names so supported hosts can place them', () => {
  for (const path of ['Notes/sample:part.md', 'Notes/CON.md', 'Notes/sample.', 'Notes/sample '])
    expect(() => validatePath(path)).not.toThrow()
})

it('uses Windows case and trailing-dot equivalence for the vault path key', async () => {
  const { Platform } = await import('obsidian')
  const { vaultPathKey } = await import('@/sync/vaultPathLinks')
  const { buildFakeVault } = await import('../helpers/fakeVault')
  const previous = Platform.isWin
  Object.assign(Platform, { isWin: true })
  try {
    const key = vaultPathKey(buildFakeVault([]).vault)
    expect(key('Notes./SAMPLE.md ')).toBe(key('notes/sample.md'))
  } finally {
    Object.assign(Platform, { isWin: previous })
  }
})

it.each(['windows', 'android', 'macos', 'linux', 'ios'] as const)(
  'applies host admission before acquiring incoming content on %s',
  async (platform) => {
    const { Platform } = await import('obsidian')
    const { applyStaged, ExpectedWrites, MemoryStateStore, sha256 } = await import(
      '@abele/sync-sdk/core'
    )
    const { ObsidianFileSystem } = await import('@/sync/ObsidianFileSystem')
    const { NotSyncedState } = await import('@/sync/notSyncedState')
    const { buildFakeVault } = await import('../helpers/fakeVault')
    const flags = {
      isWin: Platform.isWin,
      isAndroidApp: Platform.isAndroidApp,
      isIosApp: Platform.isIosApp,
      isMacOS: Platform.isMacOS,
    }
    Object.assign(Platform, {
      isWin: platform === 'windows',
      isAndroidApp: platform === 'android',
      isIosApp: platform === 'ios',
      isMacOS: platform === 'macos',
    })
    const app = buildFakeVault([])
    const state = new MemoryStateStore()
    const bytes = new Uint8Array([1, 2, 3])
    let requests = 0
    const client = {
      getBlob: async () => {
        requests++
        return bytes
      },
    }
    const change = {
      seq: 1,
      file_id: 'sample-id',
      version_id: 'sample-version',
      path: 'sample:part.md',
      prev_path: null,
      op: 'create' as const,
      kind: 'note' as const,
      sha: await sha256(bytes),
      size: bytes.length,
      mtime: 1000,
      at: '',
      actor: { kind: 'system' as const, id: 'sample', name: 'Sample' },
    }
    const options = {
      dirty: new Set<string>(),
      expected: new ExpectedWrites(),
      filter: { excluded: () => false },
    }
    try {
      const run = () =>
        applyStaged(
          client as Parameters<typeof applyStaged>[0],
          new ObsidianFileSystem(app as never),
          state,
          [change],
          options
        )
      const result = await run()
      if (platform === 'windows' || platform === 'android') {
        expect(result.applied).toBe(0)
        expect(requests).toBe(0)
        expect(await new NotSyncedState(state).snapshot()).toContainEqual(
          expect.objectContaining({ path: change.path, kind: 'name' })
        )
        await run() // A recreated adapter must preserve the refusal without a content request.
        expect(requests).toBe(0)
        expect(await state.get(change.path)).toBeNull()
      } else {
        expect(result.applied).toBe(1)
        expect(requests).toBe(1)
        expect((await state.get(change.path))?.sha).toBe(change.sha)
      }
    } finally {
      Object.assign(Platform, flags)
    }
  }
)
