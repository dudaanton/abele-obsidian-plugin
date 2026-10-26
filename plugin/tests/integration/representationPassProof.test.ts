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
  const representation = await ExternalRepresentation.open({
    state: null,
    emptyView: { ledgerId: 'sample-ledger', binding },
    ledger: new MemoryStateStore(),
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
  }
}

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
