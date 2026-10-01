import { describe, expect, it } from 'vitest'
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
