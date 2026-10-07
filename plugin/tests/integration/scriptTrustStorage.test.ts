import { describe, expect, it, vi } from 'vitest'
import { sha256 } from '@abele/sync-core'
import { scriptForExecution } from '@/scripting/trust/scriptExecutionGate'
import { IDBFactory } from 'fake-indexeddb'
import type { App } from 'obsidian'
import { buildFakeVault } from '../helpers/fakeVault'
import { setScriptConnection } from '../helpers/scriptConnection'
import {
  activateScriptProvenance,
  scriptTrustFor,
  SCRIPT_TRUST_KEY,
  SCRIPT_SENTINEL,
} from '@/scripting/trust/scriptTrustStorage'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
const binding = {
  endpoint: 'https://sync.example',
  vaultId: 'sample-vault',
  principal: 'sample-device',
  facet: 'personal' as const,
  grantId: null,
}

describe('script provenance persistence adapter', () => {
  it('survives reopen/adoption and refuses a missing database behind its sentinel', async () => {
    const app = buildFakeVault([]) as unknown as App
    const factory = new IDBFactory()
    setScriptConnection(app, binding)
    const first = await activateScriptProvenance(app, binding, factory)
    await first.provenance.record('Scripts/sample.js', 'sample-file')
    first.store.close()
    const reopened = await scriptTrustFor(app, factory)
    expect(await reopened!.provenance.lookup('Scripts/sample.js')).toMatchObject({
      fileId: 'sample-file',
    })
    reopened!.store.close()
    await expect(scriptTrustFor(app, new IDBFactory())).rejects.toThrow(/missing/)
  })
  it('does not adopt a copied recovery marker or silently return local trust', async () => {
    const app = buildFakeVault([
      { path: SCRIPT_SENTINEL, content: 'Managed script provenance required\n' },
    ]) as unknown as App
    await expect(scriptTrustFor(app, new IDBFactory())).rejects.toThrow(/missing/)
    await expect(activateScriptProvenance(app, binding, new IDBFactory())).rejects.toThrow(
      /missing/
    )
  })
  it('restarts provenance on a connected new device without inheriting a copied marker or approvals', async () => {
    const factory = new IDBFactory()
    vi.stubGlobal('indexedDB', factory)
    const path = 'Scripts/sample.js',
      source = '// @name Sample\nreturn "sample"'
    const oldApp = buildFakeVault([{ path, content: source }]) as unknown as App
    setScriptConnection(oldApp, binding)
    const old = await activateScriptProvenance(oldApp, binding, factory)
    await old.provenance.record(path, 'sample-file')
    const sha = await sha256(new TextEncoder().encode(source))
    await old.provenance.approve(path, (await old.provenance.lookup(path))!, sha)
    const copied = oldApp.loadLocalStorage(SCRIPT_TRUST_KEY)
    old.store.close()
    const app = buildFakeVault([
      { path: SCRIPT_SENTINEL, content: JSON.stringify(copied) },
      { path, content: source },
    ]) as unknown as App
    const nextBinding = { ...binding, principal: 'sample-new-device' }
    setScriptConnection(app, nextBinding)
    try {
      await expect(scriptForExecution(app, path)).rejects.toThrow(/provenance.*missing/i)
      const next = await activateScriptProvenance(app, nextBinding, factory)
      try {
        expect(next.provenance.binding.localVault).not.toBe((copied as any).id)
        expect(await next.provenance.lookup(path)).toBeNull()
        await expect(scriptForExecution(app, path)).rejects.toThrow(/unknown.*blocked/)
        await next.provenance.record(path, 'sample-file') // Ordinary durable sync receipt, not the marker.
      } finally {
        next.store.close()
      }
      await expect(scriptForExecution(app, path)).rejects.toThrow(/approval/)
      const confirm = vi.fn(async () => true)
      await expect(scriptForExecution(app, path, confirm)).resolves.toMatchObject({ path })
      expect(confirm).toHaveBeenCalledOnce()
      const reopened = await scriptTrustFor(app, factory)
      try {
        expect(
          await reopened!.provenance.approved((await reopened!.provenance.lookup(path))!, sha)
        ).toBe(true)
      } finally {
        reopened!.store.close()
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('leaves an unconnected ordinary local vault alone', async () => {
    const app = buildFakeVault([]) as unknown as App
    expect(await scriptTrustFor(app, new IDBFactory())).toBeNull()
    expect(app.loadLocalStorage(SCRIPT_TRUST_KEY)).toBeNull()
  })
  it('blocks a native write when its durable pre-mutation hold cannot be saved', async () => {
    const app = buildFakeVault([
      { path: 'Scripts/sample.js', content: 'local bytes' },
    ]) as unknown as App
    const fs = new ObsidianFileSystem(app, {
      beforeEngineMutation: async () => {
        throw new Error('provenance unavailable')
      },
    })
    await expect(
      fs.writeAtomic('Scripts/sample.js', new TextEncoder().encode('incoming bytes'), 1)
    ).rejects.toThrow(/provenance/)
    expect(await app.vault.adapter.readBinary('Scripts/sample.js')).toEqual(
      new TextEncoder().encode('local bytes').buffer
    )
  })
  it('records provenance before an adopted identity enters the ledger', async () => {
    const factory = new IDBFactory()
    const store = await IndexedDbStateStore.open(factory, 'sample-ledger')
    store.observeEntries(async () => {
      throw new Error('provenance unavailable')
    })
    const entry = {
      path: 'Scripts/sample.js',
      wirePath: 'Scripts/sample.js',
      fileId: 'sample-file',
      versionId: 'sample-version',
      sha: 'sample-sha',
      size: 1,
      mtime: 1,
    }
    await expect(store.put(entry)).rejects.toThrow(/provenance/)
    expect(await store.get(entry.path)).toBeNull()
    store.close()
  })
})
