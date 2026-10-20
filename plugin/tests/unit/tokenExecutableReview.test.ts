import { expect, it } from 'vitest'
import { MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
import { ExecutableReview, EXECUTABLE_REVIEW_KEY } from '@/sync/executableReview'
import { executablePath } from '@/sync/stagedPluginCode'

it.each(['Tools/sample.js', 'Tools/sample.py', '.obsidian/plugins/abele/main.js'])(
  'classifies executable rename/delete endpoints without a server kind: %s',
  (path) => {
    expect(executablePath(path)).toBe(true)
  }
)

const source = {
  id: 'connection-a',
  address: 'https://sync.example',
  spaceId: 'space-a',
  tokenId: 'token-a',
  scope: { kind: 'folder' as const, id: 'root', path: '/' },
}
const encode = (text: string) => new TextEncoder().encode(text)
it('records approval durably before an installer is available', async () => {
  const store = new MemoryStateStore(),
    review = new ExecutableReview(store)
  const { candidate } = await review.stage(await incoming())
  await review.recordApproval(candidate!.id)
  expect((await new ExecutableReview(store).state())[0].status).toBe('queued')
  const applied: string[] = []
  await review.approve([candidate!.id], {
    apply: async (one) => {
      applied.push(one.id)
    },
  })
  expect(applied).toEqual([candidate!.id])
  expect((await review.state())[0].status).toBe('approved')
})
it('retains saved consent after installation fails and retries the exact version after reopening', async () => {
  const store = new MemoryStateStore(),
    review = new ExecutableReview(store)
  const { candidate } = await review.stage(await incoming())
  await review.recordApproval(candidate!.id)
  await expect(
    review.approve([candidate!.id], {
      apply: async () => {
        throw new Error('sample unavailable file')
      },
    })
  ).rejects.toThrow('sample unavailable file')
  const reopened = new ExecutableReview(store)
  expect((await reopened.state())[0].status).toBe('queued')
  const applied: string[] = []
  await reopened.approve([candidate!.id], {
    apply: async (one) => {
      applied.push(one.versionId)
    },
  })
  expect(applied).toEqual([candidate!.versionId])
  expect((await reopened.state())[0].status).toBe('approved')
})
async function incoming(
  path = 'Scripts/sample.js',
  versionId = 'version-a',
  operation: 'create' | 'modify' | 'move' | 'delete' = 'modify',
  previousPath: string | null = null
) {
  const bytes = operation === 'delete' ? null : encode(versionId)
  return {
    source,
    path,
    previousPath,
    fileId: 'file-a',
    versionId,
    operation,
    directory: false,
    receivedAt: 200,
    mtime: 100,
    sha: bytes ? await sha256(bytes) : null,
    bytes,
  }
}
it.each(['create', 'modify', 'move', 'delete'] as const)(
  'stages executable %s with immutable source, time, mtime and bytes',
  async (operation) => {
    const store = new MemoryStateStore(),
      review = new ExecutableReview(store)
    const input = await incoming(
      '.obsidian/plugins/abele/main.js',
      'version-a',
      operation,
      operation === 'move' ? 'Scripts/previous.js' : null
    )
    expect((await review.stage(input)).disposition).toBe('staged')
    input.bytes?.fill(0)
    input.source = { ...source, address: 'https://other.example' }
    const pending = await new ExecutableReview(store).pending()
    expect(pending[0]).toMatchObject({ source, receivedAt: 200, mtime: 100, operation })
    expect(pending[0].bytes).toEqual(
      operation === 'delete' ? null : Array.from(encode('version-a'))
    )
  }
)
it('approves only the reviewed candidate while a later candidate arrives during application', async () => {
  const store = new MemoryStateStore(),
    review = new ExecutableReview(store)
  await review.stage(await incoming())
  const first = (await review.pending())[0]
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>((resolve) => {
      release = resolve
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve
    })
  const applied: unknown[] = []
  const applying = review.approve([first.id], {
    apply: async (candidate) => {
      applied.push(candidate)
      entered()
      await gate
    },
  })
  await started
  await review.stage(await incoming('Scripts/sample.js', 'version-b'))
  release()
  await applying
  expect(applied).toHaveLength(1)
  expect(applied[0]).toMatchObject({ versionId: 'version-a', mtime: 100 })
  expect(
    (await new ExecutableReview(store).pending()).map((candidate) => candidate.versionId)
  ).toEqual(['version-b'])
})
it('keeps ordinary files moving and excludes config on partial connections, including either end of a move', async () => {
  const review = new ExecutableReview(new MemoryStateStore(), {
    configRoots: ['.obsidian', '.config-vault'],
  })
  expect((await review.stage(await incoming('Notes/sample.md'))).disposition).toBe('ordinary')
  const partial = {
    ...source,
    scope: { kind: 'group' as const, id: 'group-a', path: 'Groups/sample.md' },
  }
  for (const path of ['.OBSIDIAN/plugins/sample/main.js', '.config-vault/app.json'])
    expect((await review.stage({ ...(await incoming(path)), source: partial })).disposition).toBe(
      'excluded'
    )
  expect(
    (
      await review.stage({
        ...(await incoming(
          'Notes/sample.md',
          'version-a',
          'move',
          '.obsidian/plugins/sample/main.js'
        )),
        source: partial,
      })
    ).disposition
  ).toBe('excluded')
  expect((await review.stage({ ...(await incoming()), source: partial })).disposition).toBe(
    'staged'
  )
})
it('retains an interrupted approval for exact-candidate retry and never accepts altered bytes', async () => {
  const store = new MemoryStateStore(),
    review = new ExecutableReview(store)
  await review.stage(await incoming())
  const candidate = (await review.pending())[0]
  await expect(
    review.approve([candidate.id], {
      apply: async () => {
        throw new Error('placement interrupted')
      },
    })
  ).rejects.toThrow('placement interrupted')
  expect((await new ExecutableReview(store).pending())[0].status).toBe('applying')
  const bad = await incoming('Scripts/sample.js', 'version-b')
  bad.bytes = encode('altered')
  await expect(review.stage(bad)).rejects.toThrow()
  await new ExecutableReview(store).approve([candidate.id], {
    apply: async (one) => {
      expect(one.versionId).toBe('version-a')
    },
  })
  expect(await review.pending()).toEqual([])
})
it('reviews moves out of executable folders and directory deletes; rejects only the selected version', async () => {
  const review = new ExecutableReview(new MemoryStateStore())
  await review.stage(await incoming('Notes/copied.txt', 'version-a', 'move', 'Scripts/sample.js'))
  await review.stage({
    ...(await incoming('.obsidian/plugins/sample', 'version-b')),
    operation: 'delete_directory',
    directory: true,
    bytes: null,
    sha: null,
  })
  const [first] = await review.pending()
  await review.reject([first.id])
  expect((await review.pending()).map((one) => one.operation)).toEqual(['delete_directory'])
  await review.stage(await incoming('Scripts/sample.js', 'version-c'))
  expect(await review.pending()).toHaveLength(2)
})
it('keeps deliveries from another server separate even when file and version IDs match', async () => {
  const review = new ExecutableReview(new MemoryStateStore())
  await review.stage(await incoming())
  await review.stage({
    ...(await incoming()),
    source: { ...source, id: 'connection-b', address: 'https://other.example' },
  })
  const [first, second] = await review.pending()
  expect(first.id).not.toBe(second.id)
  await review.approve([first.id], { apply: async () => {} })
  expect((await review.pending()).map((one) => one.source.id)).toEqual(['connection-b'])
})
it('does not acknowledge a failed stage write and validates persisted bytes before approval', async () => {
  const store = new MemoryStateStore(),
    review = new ExecutableReview(store)
  const write = store.setMeta.bind(store)
  store.setMeta = async () => {
    throw new Error('storage unavailable')
  }
  await expect(review.stage(await incoming())).rejects.toThrow('storage unavailable')
  store.setMeta = write
  expect(await review.pending()).toEqual([])
  await review.stage(await incoming())
  const [candidate] = await review.pending()
  const document = JSON.parse((await store.getMeta(EXECUTABLE_REVIEW_KEY))!)
  document.candidates[0].bytes[0] = 0
  await store.setMeta(EXECUTABLE_REVIEW_KEY, JSON.stringify(document))
  let applied = false
  await expect(
    review.approve([candidate.id], {
      apply: async () => {
        applied = true
      },
    })
  ).rejects.toThrow('integrity')
  expect(applied).toBe(false)
})
it('recognizes executable kinds outside the configured script folder and exposes both held move paths', async () => {
  const review = new ExecutableReview(new MemoryStateStore(), {
    scriptsFolder: 'Automation',
    configRoots: ['.vault-config'],
  })
  expect(
    (await review.stage({ ...(await incoming('Other/sample.js')), kind: 'script' })).disposition
  ).toBe('staged')
  await review.stage(
    await incoming('Notes/copied.txt', 'version-b', 'move', 'Automation/sample.js')
  )
  expect(await review.heldPaths(source.id)).toEqual([
    'Other/sample.js',
    'Notes/copied.txt',
    'Automation/sample.js',
  ])
  const partial = {
    ...source,
    id: 'connection-partial',
    scope: { kind: 'folder' as const, id: 'folder-a', path: 'Shared' },
  }
  expect(review.allowsPath(partial, '.vault-config/app.json')).toBe(false)
  expect(review.allowsPath(partial, '.obsidian/plugins/sample/main.js')).toBe(false)
  expect(review.allowsPath(source, '.vault-config/app.json')).toBe(true)
})
