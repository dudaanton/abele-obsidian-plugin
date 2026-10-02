import { describe, expect, it, vi, afterEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { App } from 'obsidian'
import { activateScriptProvenance, scriptTrustFor } from '@/scripting/trust/scriptTrustStorage'
import { scriptForExecution } from '@/scripting/trust/scriptExecutionGate'
import { buildFakeVault } from '../helpers/fakeVault'
import { setScriptConnection } from '../helpers/scriptConnection'

const binding = {
  endpoint: 'https://sync.example',
  vaultId: 'sample-vault',
  principal: 'sample-device',
  facet: 'personal' as const,
  grantId: null,
}
const a = 'Scripts/sample.js',
  b = 'Scripts/moved.js',
  h = '// @name Sample\nreturn "approved"'
afterEach(() => vi.unstubAllGlobals())

describe('late ledger receipt after local rename', () => {
  it('holds an old spelling after a case-only rename and a late receipt on a case-sensitive vault', async () => {
    const source = 'Scripts/sample.js',
      destination = 'Scripts/SAMPLE.js'
    const app = buildFakeVault([{ path: source, content: h }]) as unknown as App
    const factory = new IDBFactory()
    vi.stubGlobal('indexedDB', factory)
    setScriptConnection(app, binding)
    const trust = await activateScriptProvenance(app, binding, factory)
    try {
      await trust.provenance.record(source, 'sample-identity')
      await scriptForExecution(app, source, async () => true)
      await app.vault.adapter.rename(source, destination)
      await trust.provenance.rename(source, destination)
      // The underlying fixture normally folds paths. Simulate a case-sensitive device where
      // the old spelling is a separate new file with the previously approved exact bytes.
      const read = app.vault.adapter.readBinary.bind(app.vault.adapter)
      app.vault.adapter.readBinary = async (path) =>
        path === source ? (new TextEncoder().encode(h).buffer as ArrayBuffer) : read(path)
      await trust.provenance.record(source, 'sample-identity')
      expect(await trust.provenance.lookup(source)).toMatchObject({ fileId: null })
      expect(await trust.provenance.lookup(destination)).toMatchObject({
        fileId: 'sample-identity',
      })
      await expect(scriptForExecution(app, source)).rejects.toThrow(/unknown/)
    } finally {
      trust.store.close()
    }
    const reopened = await scriptTrustFor(app, factory)
    try {
      await reopened!.provenance.record(source, 'sample-identity')
      expect(await reopened!.provenance.lookup(source)).toMatchObject({ fileId: null })
      await reopened!.provenance.rename(destination, source)
      expect(await reopened!.provenance.lookup(source)).toMatchObject({ fileId: 'sample-identity' })
      await reopened!.provenance.record(destination, 'sample-identity')
      expect(await reopened!.provenance.lookup(destination)).toMatchObject({ fileId: null })
    } finally {
      reopened!.store.close()
    }
  })
  it('retires the last known identity even when a pending mutation already holds the source', async () => {
    const app = buildFakeVault([{ path: a, content: h }]) as unknown as App
    const factory = new IDBFactory()
    vi.stubGlobal('indexedDB', factory)
    setScriptConnection(app, binding)
    const trust = await activateScriptProvenance(app, binding, factory)
    try {
      await trust.provenance.record(a, 'sample-identity')
      await scriptForExecution(app, a, async () => true)
      await trust.provenance.pending(a)
      await trust.provenance.rename(a, b)
      await trust.provenance.record(a, 'sample-identity')
      expect(await trust.provenance.lookup(a)).toMatchObject({ fileId: null })
      await expect(scriptForExecution(app, a)).rejects.toThrow(/unknown/)
      expect(await trust.provenance.lookup(b)).toMatchObject({ fileId: null })
      await trust.provenance.record(b, 'sample-identity')
      expect(await trust.provenance.lookup(b)).toMatchObject({ fileId: 'sample-identity' })
    } finally {
      trust.store.close()
    }
  })
  it('never restores the moved identity to a recreated source, including after restart', async () => {
    const app = buildFakeVault([{ path: a, content: h }]) as unknown as App
    const factory = new IDBFactory()
    vi.stubGlobal('indexedDB', factory)
    setScriptConnection(app, binding)
    const trust = await activateScriptProvenance(app, binding, factory)
    try {
      await trust.provenance.record(a, 'sample-identity')
      await scriptForExecution(app, a, async () => true)
      // H2 was submitted before the rename; its accepted receipt arrives afterward.
      await app.vault.adapter.writeBinary(
        a,
        new TextEncoder().encode(h + '\n// H2').buffer as ArrayBuffer
      )
      await app.vault.adapter.rename(a, b)
      await trust.provenance.rename(a, b)
      await app.vault.adapter.writeBinary(a, new TextEncoder().encode(h).buffer as ArrayBuffer)
      await trust.provenance.record(a, 'sample-identity')
      expect(await trust.provenance.lookup(a)).toMatchObject({ fileId: null })
      expect(await trust.provenance.lookup(b)).toMatchObject({ fileId: 'sample-identity' })
      await expect(scriptForExecution(app, a)).rejects.toThrow(/unknown/)
    } finally {
      trust.store.close()
    }
    const reopened = await scriptTrustFor(app, factory)
    try {
      await reopened!.provenance.pending(a)
      await reopened!.provenance.record(a, 'sample-identity')
      expect(await reopened!.provenance.lookup(a)).toMatchObject({ fileId: null })
      // A genuinely different identity can settle at the old name, never inherit I's approval.
      await reopened!.provenance.record(a, 'replacement-identity')
      await expect(scriptForExecution(app, a)).rejects.toThrow(/approval/)
      // A late I receipt cannot replace even a newer valid J binding at that path.
      await reopened!.provenance.record(a, 'sample-identity')
      expect(await reopened!.provenance.lookup(a)).toMatchObject({ fileId: 'replacement-identity' })
      // Deliberate proven move back is the only way I can return through this adapter.
      await reopened!.provenance.rename(b, a)
      expect(await reopened!.provenance.lookup(a)).toMatchObject({ fileId: 'sample-identity' })
    } finally {
      reopened!.store.close()
    }
  })
})
