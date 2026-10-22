import { expect, it } from 'vitest'
import { isExcluded, MemoryStateStore, selectiveDefaults } from '@abele/sync-sdk/core'
import { startupSafetyReason, waitForStartupIndex } from '@/sync/startupSafety'
import { excludedFolderPrefix } from '@/sync/excludedFolder'

it.each([
  ['Notes/Archive/', 'Notes/Archive'],
  ['Notes/Archive///', 'Notes/Archive'],
  ['Notes/Cafe\u0301///', 'Notes/Café'],
  ['/', ''],
  ['///', ''],
  ['', ''],
  [' Notes/Archive/ ', ' Notes/Archive/ '],
  ['/Notes/Archive/', '/Notes/Archive'],
])('normalizes folder selectors with SDK matching semantics: %j', (input, expected) => {
  const prefix = excludedFolderPrefix(input)
  expect(prefix).toBe(expected)
  const selective = { ...selectiveDefaults(), excludedFolders: [input] }
  for (const path of ['Notes/Archive/sample.md', 'Notes/Café/sample.md', 'Other/sample.md'])
    expect(prefix !== '' && path.normalize('NFC').startsWith(prefix + '/')).toBe(
      isExcluded(path, 0, selective, 'Scripts')
    )
})

it.each([
  { notes: 5, present: 5, stopped: false },
  { notes: 100, present: 0, stopped: true },
])(
  'compares indexed notes independently of 100 synced config files ($notes notes, $present present)',
  async ({ notes, present, stopped }) => {
    const state = await ledger(notes)
    for (let i = 0; i < 100; i++) {
      const path = `.obsidian/plugins/sample/settings-${i}.json`
      await state.put({
        path,
        wirePath: path,
        fileId: `config-${i}`,
        versionId: 'v1',
        sha: 'b'.repeat(64),
        size: 1,
        mtime: 1,
      })
    }
    const reason = await startupSafetyReason(
      state,
      async () => ({ files: Array.from({ length: present }, (_, i) => `Notes/sample-${i}.md`) }),
      ''
    )
    if (stopped) expect(reason).toContain('Resume')
    else expect(reason).toBeNull()
  }
)

it.each(['Settings', 'Notes/.hidden', 'Excluded'])(
  'ignores ledger paths outside index visibility: %s',
  async (prefix) => {
    const state = await ledger(5)
    for (let i = 0; i < 100; i++) {
      const path = `${prefix}/sample-${i}.json`
      await state.put({
        path,
        wirePath: path,
        fileId: `hidden-${i}`,
        versionId: 'v1',
        sha: 'b'.repeat(64),
        size: 1,
        mtime: 1,
      })
    }
    expect(
      await startupSafetyReason(
        state,
        async () => ({ files: Array.from({ length: 5 }, (_, i) => `Notes/sample-${i}.md`) }),
        '',
        () => {},
        ['Settings', 'Excluded']
      )
    ).toBeNull()
  }
)

it('cancels an unloaded-index wait and ignores a later ready callback', async () => {
  let ready!: () => void
  const controller = new AbortController()
  const waiting = waitForStartupIndex(
    {
      onLayoutReady: (callback) => {
        ready = callback
      },
    },
    controller.signal
  )
  const rejected = expect(waiting).rejects.toThrow('startup cancelled')
  controller.abort(new Error('startup cancelled'))
  await rejected
  ready()
  expect(() =>
    waitForStartupIndex(
      {
        onLayoutReady: () => {
          throw new Error('must not register')
        },
      },
      controller.signal
    )
  ).toThrow('startup cancelled')
})

it.each([
  {
    root: 'Notes',
    files: Array.from({ length: 10 }, (_, i) => `Other/sample-${i}.md`),
    privateRoots: [],
  },
  {
    root: '',
    files: Array.from({ length: 10 }, (_, i) => `.abele-sync/recovery/sample-${i}.md`),
    privateRoots: [],
  },
  {
    root: '',
    files: Array.from(
      { length: 10 },
      (_, i) => `.config/plugins/abele/sync-recovery/sample-${i}.md`
    ),
    privateRoots: ['.config/plugins/abele/sync-recovery'],
  },
])(
  'excludes out-of-root and private files from the complete index ($root)',
  async ({ root, files, privateRoots }) => {
    expect(
      await startupSafetyReason(
        await ledger(100),
        async () => ({ files }),
        root,
        () => {},
        privateRoots
      )
    ).toContain('Resume')
  }
)

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
it.each([
  {
    kind: 'unrelated notes',
    files: Array.from({ length: 10 }, (_, i) => `Other/sample-${i}.md`),
    stopped: true,
  },
  {
    kind: 'ledger members',
    files: Array.from({ length: 10 }, (_, i) => `Notes/sample-${i}.md`),
    stopped: false,
  },
  {
    kind: 'offloaded members',
    files: Array.from({ length: 10 }, (_, i) => `Notes/sample-${i}.md.abele-ref`),
    stopped: false,
  },
  {
    kind: 'duplicate representations',
    files: Array.from({ length: 5 }, (_, i) => [
      `Notes/sample-${i}.md`,
      `Notes/sample-${i}.md.abele-ref`,
    ]).flat(),
    stopped: true,
  },
])(
  'compares only distinct connection files with the group ledger: $kind',
  async ({ files, stopped }) => {
    const reason = await startupSafetyReason(
      await ledger(100),
      async () => ({ files, folders: [] }),
      '',
      () => {},
      [],
      true
    )
    if (stopped) expect(reason).toContain('Resume')
    else expect(reason).toBeNull()
  }
)
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
