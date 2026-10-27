import { expect, it, vi } from 'vitest'
import { MemoryStateStore } from '@abele/sync-sdk/core'
import type { App } from 'obsidian'
import { ExternalRepresentation } from '@/sync/external/representation'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { buildFakeVault } from '../helpers/fakeVault'

const binding = {
  endpoint: 'https://sync.example.invalid',
  vaultId: 'sample-vault',
  mode: 'personal' as const,
  principalId: 'sample-device',
  principalType: 'device' as const,
  grantId: null,
  generation: 1,
  credentialAssociation: 'sample-slot',
}
const INVENTORY_PASS = Symbol.for('abele.sync.inventory-pass-v1')

it('hands continuous watcher coverage between subscribers without rechecking every identity', async () => {
  const { raw, list, identity } = await setup(3)
  const first = raw.watch(() => {})
  let second: (() => void) | undefined
  try {
    await list()
    identity.mockClear()
    second = raw.watch(() => {})
    await list()
    expect(identity).not.toHaveBeenCalled()
    first()
    await list()
    expect(identity).not.toHaveBeenCalled()
    second()
    second = undefined
    const resumed = raw.watch(() => {})
    try {
      await list()
      expect(identity).toHaveBeenCalled()
    } finally {
      resumed()
    }
  } finally {
    first()
    second?.()
  }
})

it('retires a scope snapshot for entry commits, representation changes and local events', async () => {
  const { app, raw, ledger, representation } = await setup(1)
  const clock = Symbol.for('abele.sync.scope-state-revision-v1')
  let revision = 0
  Reflect.set(ledger, clock, async () => revision)
  const stop = raw.watch(() => {})
  const state = representation.stateStore()
  const read = () => Reflect.get(state, clock).call(state)
  try {
    const initial = await read()
    expect(await read()).toBe(initial)
    revision++
    const committed = await read()
    expect(committed).not.toBe(initial)
    Reflect.get(representation, 'document').revision++
    const managed = await read()
    expect(managed).not.toBe(committed)
    app.emit('vault', 'modify', app.vault.getFileByPath('Shared/sample-0.md'))
    expect(await read()).not.toBe(managed)
    const racing = read()
    app.emit('vault', 'modify', app.vault.getFileByPath('Shared/sample-0.md'))
    expect(await racing).toBeUndefined()
  } finally {
    stop()
  }
})

it('opens an ordinary representation without walking the ledger before the handshake', async () => {
  const all = vi.spyOn(MemoryStateStore.prototype, 'all')
  try {
    const { list } = await setup(1)
    expect(all).not.toHaveBeenCalled()
    expect(await list()).toHaveLength(1)
  } finally {
    all.mockRestore()
  }
})

it('loads advisory inspection records only when reconciliation first classifies a path', async () => {
  const { representation, list } = await setup(1)
  const options = Reflect.get(representation, 'options')
  const load = vi.fn(async () => [])
  options.inspection.load = load
  expect(load).not.toHaveBeenCalled()
  await list()
  expect(load).toHaveBeenCalledOnce()
  await list()
  expect(load).toHaveBeenCalledOnce()
})

it('keeps watched proofs when a polled path uses the inventory clock', async () => {
  const { raw, identity, list } = await setup(40)
  const revision = Symbol.for('abele.sync.watch-revision-v1')
  const original = Reflect.get(raw, revision).bind(raw)
  Reflect.set(raw, revision, (path: string) =>
    path === 'Shared/sample-20.md' ? undefined : original(path)
  )
  const stop = raw.watch(() => {})
  try {
    const pass = Reflect.get(raw, INVENTORY_PASS)
    await pass.call(raw, list)
    const before = identity.mock.calls.length
    await pass.call(raw, async () => {
      await list()
      await list()
    })
    // Only the polled path needs a new identity check in the next inventory pass.
    expect(identity.mock.calls.slice(before).map(([path]) => path)).toEqual([
      'Shared/sample-20.md',
      'Shared/sample-20.md',
    ])
  } finally {
    stop()
  }
})

async function setup(count: number, placed = false) {
  const app = buildFakeVault(
    Array.from({ length: count }, (_, i) => ({
      path: `Shared/sample-${i}.md`,
      content: 'ordinary',
    }))
  )
  const raw = new ObsidianFileSystem(app as unknown as App)
  const placement = placed ? new LocalFolderPlacement('Shared', 'Shared') : undefined
  const fs = placement ? placement.fileSystem(raw) : raw
  const identity = vi.fn(async (path: string) => {
    const stat = await app.vault.adapter.stat(path)
    if (stat?.type !== 'file') return null
    return { size: stat.size, mtime: stat.mtime, ctime: stat.ctime }
  })
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  const ledger = new MemoryStateStore()
  const representation = await ExternalRepresentation.open({
    state: null,
    emptyView: { ledgerId: 'sample-ledger', binding },
    ledger,
    fs,
    assertOwned: () => {},
    scriptsFolder: () => 'Scripts',
    inspection: {
      entries: [],
      cacheKey: (path) => placement?.toLocal(path) ?? path,
      identity: async (path) => {
        const value = await identity(placement?.toLocal(path) ?? path)
        return value && { size: value.size, mtime: value.mtime, ctime: value.ctime }
      },
      save: () => {},
    },
    verify: async () => {
      throw Error('unexpected verification')
    },
    installProjection: async () => {
      throw Error('unexpected install')
    },
  })
  const list = async () => {
    const seen: string[] = []
    for await (const info of representation.fileSystem().list()) seen.push(info.path)
    return seen
  }
  return {
    app,
    raw,
    representation,
    identity,
    read,
    list,
    ledger,
  }
}

it('replays classification within a watched inventory, retiring it on a mid-walk edit', async () => {
  const { app, raw, representation, ledger, list } = await setup(5)
  for (let i = 0; i < 5; i++)
    await ledger.put({
      path: `Shared/sample-${i}.md`,
      wirePath: `Shared/sample-${i}.md`,
      fileId: `sample-${i}`,
      versionId: 'v1',
      sha: 'a'.repeat(64),
      size: 8,
      mtime: 1,
    })
  const stop = raw.watch(() => {})
  const state = representation.stateStore()
  try {
    await Reflect.get(raw, INVENTORY_PASS).call(raw, async () => {
      await list()
      expect(await Array.fromAsync(state.all())).toHaveLength(5)
      expect(await Array.fromAsync(state.all())).toHaveLength(5)
      expect(representation.classificationStats().callers['state.all'].pass).toBe(5)
      const iterator = state.all()[Symbol.asyncIterator]()
      await iterator.next()
      await app.vault.modify(
        app.vault.getFileByPath('Shared/sample-3.md')!,
        JSON.stringify({ format: 'abele.external', schema: 1 })
      )
      app.emit('vault', 'modify', app.vault.getFileByPath('Shared/sample-3.md')!)
      const remaining = []
      for (;;) {
        const next = await iterator.next()
        if (next.done) break
        remaining.push(next.value.path)
      }
      expect(remaining).not.toContain('Shared/sample-3.md')
    })
  } finally {
    stop()
  }
})

it.each([false, true])(
  'verifies an unchanged file once per inventory pass however many listings classify it (placed %s)',
  async (placed) => {
    const files = 40
    const { raw, identity, read, list } = await setup(files, placed)
    await Reflect.get(raw, INVENTORY_PASS).call(raw, async () => {
      for (let pass = 0; pass < 4; pass++) expect(await list()).toHaveLength(files)
    })
    // One fresh inspection per file: identity before and after its bounded read.
    expect(identity.mock.calls.length).toBe(2 * files)
    expect(read.mock.calls.length).toBeLessThanOrEqual(files)
  }
)

it('reverifies a file whose vault event arrives inside the same pass', async () => {
  const { app, raw, representation, identity, list } = await setup(3)
  const target = 'Shared/sample-1.md'
  await Reflect.get(raw, INVENTORY_PASS).call(raw, async () => {
    expect(await list()).toHaveLength(3)
    const before = identity.mock.calls.filter(([path]) => path === target).length
    // A recognizable marker of the same shape a projection starts with.
    const projection = JSON.stringify({ format: 'abele.external', schema: 1 })
    await app.vault.modify(app.vault.getFileByPath(target)!, projection)
    const listed = await list()
    expect(identity.mock.calls.filter(([path]) => path === target).length).toBeGreaterThan(before)
    expect(listed).not.toContain(target)
    expect((await representation.classify(target)).kind).toBe('hold')
  })
})

it('does not carry a pass proof into a later inventory pass', async () => {
  const { raw, identity, list } = await setup(5)
  const pass = Reflect.get(raw, INVENTORY_PASS)
  await pass.call(raw, list)
  const first = identity.mock.calls.length
  await pass.call(raw, list)
  // A later pass reuses the durable cache, which verifies identity again.
  expect(identity.mock.calls.length).toBeGreaterThan(first)
})

it('carries a proof across inventory passes while the watcher reports no change', async () => {
  const { app, raw, identity, list } = await setup(5)
  const pass = Reflect.get(raw, INVENTORY_PASS)
  const stop = raw.watch(() => {})
  try {
    await pass.call(raw, list)
    const first = identity.mock.calls.length
    await pass.call(raw, list)
    await pass.call(raw, list)
    // Engine cycles while nothing changed: no file is verified again.
    expect(identity.mock.calls.length).toBe(first)
    const target = 'Shared/sample-2.md'
    await app.vault.modify(app.vault.getFileByPath(target)!, 'changed bytes')
    await pass.call(raw, list)
    const again = identity.mock.calls.slice(first).map(([path]) => path)
    // Only the file the event named is verified again.
    expect(again.length).toBeGreaterThan(0)
    expect(new Set(again)).toEqual(new Set([target]))
  } finally {
    stop()
  }
})

it('lets a watcher proof stand for five minutes at most', async () => {
  const { raw, identity, list } = await setup(5)
  const pass = Reflect.get(raw, INVENTORY_PASS)
  const stop = raw.watch(() => {})
  const now = vi.spyOn(Date, 'now')
  try {
    now.mockReturnValue(1_000_000)
    await pass.call(raw, list)
    const first = identity.mock.calls.length
    now.mockReturnValue(1_000_000 + 299_000)
    await pass.call(raw, list)
    expect(identity.mock.calls.length).toBe(first)
    now.mockReturnValue(1_000_000 + 300_000)
    await pass.call(raw, list)
    expect(identity.mock.calls.length).toBeGreaterThan(first)
  } finally {
    now.mockRestore()
    stop()
  }
})

it('does not carry a proof past the watcher', async () => {
  const { raw, identity, list } = await setup(5)
  const pass = Reflect.get(raw, INVENTORY_PASS)
  const stop = raw.watch(() => {})
  await pass.call(raw, list)
  const first = identity.mock.calls.length
  stop()
  await pass.call(raw, list)
  expect(identity.mock.calls.length).toBeGreaterThan(first)
})
