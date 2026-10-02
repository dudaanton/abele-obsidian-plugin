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
