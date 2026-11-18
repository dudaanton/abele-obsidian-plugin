import { expect, it } from 'vitest'
import { validatePath } from '@abele/sync-sdk/protocol'
import { unsupportedSyncName } from '@/sync/platformSyncNames'

it.each(['windows', 'android'] as const)('rejects filesystem aliases on %s', (platform) => {
  for (const path of [
    'Notes/sample\\part.md',
    'Notes/sample\u0001.md',
    'Notes/COM¹.txt',
    'Notes/LPT².md',
    'Notes/COM³',
  ])
    expect(unsupportedSyncName(path, platform), path).not.toBeNull()
})

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

it.each(
  (['windows', 'android', 'macos', 'linux', 'ios'] as const).flatMap((platform) =>
    [
      'sample:part.md',
      'sample*.md',
      'sample?.md',
      'sample".md',
      'sample<.md',
      'sample>.md',
      'sample|.md',
      'sample.',
      'sample ',
      'CON.md',
      'PRN',
      'AUX',
      'NUL.txt',
      'COM1.md',
      'LPT9',
      'COM¹.txt',
      'folder?/sample.md',
    ].map((path) => ({ platform, path }))
  )
)(
  'applies host admission before acquiring incoming content on $platform: $path',
  async ({ platform, path }) => {
    const { Platform } = await import('obsidian')
    const { applyStaged, ExpectedWrites, MemoryStateStore, sha256, scan } = await import(
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
      path,
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
        // Missing on this device is not a deletion to upload to the other devices.
        expect(
          (await scan(new ObsidianFileSystem(app as never), state, options.filter)).ops
        ).toEqual([])
        const renamed = {
          ...change,
          seq: 2,
          version_id: 'renamed-version',
          op: 'move' as const,
          prev_path: change.path,
          path: 'sample-part.md',
        }
        expect(
          (
            await applyStaged(
              client as Parameters<typeof applyStaged>[0],
              new ObsidianFileSystem(app as never),
              state,
              [renamed],
              options
            )
          ).applied
        ).toBe(1)
        expect((await state.get(renamed.path))?.sha).toBe(change.sha)
        expect(await new NotSyncedState(state).snapshot()).toEqual([])
        expect(
          (await scan(new ObsidianFileSystem(app as never), state, options.filter)).ops
        ).toEqual([])
        const blockedMove = {
          ...renamed,
          seq: 3,
          version_id: 'blocked-version',
          prev_path: renamed.path,
          path: 'blocked?.md',
        }
        expect(
          (
            await applyStaged(
              client as Parameters<typeof applyStaged>[0],
              new ObsidianFileSystem(app as never),
              state,
              [blockedMove],
              options
            )
          ).applied
        ).toBe(0)
        expect((await state.get(renamed.path))?.sha).toBe(change.sha)
        expect(
          (await scan(new ObsidianFileSystem(app as never), state, options.filter)).ops
        ).toEqual([])
        expect(await new NotSyncedState(state).snapshot()).toContainEqual(
          expect.objectContaining({ path: blockedMove.path, kind: 'name', direction: 'in' })
        )
        await applyStaged(
          client as Parameters<typeof applyStaged>[0],
          new ObsidianFileSystem(app as never),
          state,
          [{ ...renamed, seq: 4, version_id: 'repaired-version', prev_path: blockedMove.path }],
          options
        )
        expect(await new NotSyncedState(state).snapshot()).toEqual([])
        if (platform === 'windows') {
          const collision = {
            ...renamed,
            seq: 5,
            file_id: 'other-id',
            version_id: 'other-version',
            op: 'create' as const,
            prev_path: null,
            path: 'SAMPLE-PART.md',
          }
          const result = await applyStaged(
            client as Parameters<typeof applyStaged>[0],
            new ObsidianFileSystem(app as never),
            state,
            [collision],
            options
          )
          expect(result.applied).toBe(0)
          expect(await new NotSyncedState(state).snapshot()).toContainEqual(
            expect.objectContaining({ path: collision.path, kind: 'name', direction: 'in' })
          )
          expect((await state.get(renamed.path))?.fileId).toBe(change.file_id)
          expect(requests).toBe(1)
          await applyStaged(
            client as Parameters<typeof applyStaged>[0],
            new ObsidianFileSystem(app as never),
            state,
            [
              {
                ...collision,
                seq: 6,
                version_id: 'resolved-version',
                op: 'move',
                prev_path: collision.path,
                path: 'other.md',
              },
            ],
            options
          )
          expect(await new NotSyncedState(state).snapshot()).toEqual([])
          // Changing the spelling of the same identity remains a normal remote move.
          expect(
            (
              await applyStaged(
                client as Parameters<typeof applyStaged>[0],
                new ObsidianFileSystem(app as never),
                state,
                [
                  {
                    ...renamed,
                    seq: 7,
                    version_id: 'case-version',
                    prev_path: renamed.path,
                    path: 'Sample-Part.md',
                  },
                ],
                options
              )
            ).applied
          ).toBe(1)
        }
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
