// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as core from '@abele/sync-core'
import * as records from '@/sync/external/records'
import * as state from '@/sync/external/state'
import { SqliteExternalStateStore } from '@/sync/external/SqliteExternalStateStore'

const selected = '70b178a19ff66aad73ae2cc92e3508cca8e25c42'
const exported = core as Record<string, any>
describe('canonical external state inputs', () => {
  it('exports the public engine scheduler and scoped queue adapter', () => {
    expect(exported.SyncEngine.prototype.runExclusive).toBeTypeOf('function')
    expect(exported.exclusiveOperationPort).toBeTypeOf('function')
  })
  it('pins the explicit committed canonical input rather than a mutable sibling or unrelated revision', () => {
    const provenance = JSON.parse(
      readFileSync(new URL('../../vendor/sync/provenance.json', import.meta.url), 'utf8')
    )
    expect(provenance.commit).toBe(selected)
  })

  it('uses the core facade, schemas, transaction checks and error class together', () => {
    for (const name of [
      'ExternalState',
      'ExternalStateError',
      'checkExternalPhase',
      'prepareExternalLedger',
      'decodeExternalDocument',
    ]) {
      expect(exported[name], name).toBeTypeOf('function')
      expect((state as Record<string, unknown>)[name], name).toBe(exported[name])
    }
    for (const name of [
      'ConnectionBindingSchema',
      'LocalBaseSchema',
      'OwnedArtifactSchema',
      'ExternalRecordSchema',
      'ExternalOperationSchema',
      'ExternalDocumentSchema',
      'sameConnection',
    ]) {
      expect(exported[name], name).toBeDefined()
      expect((records as Record<string, unknown>)[name], name).toBe(exported[name])
    }
    expect(SqliteExternalStateStore).toBe(exported.SqliteExternalStateStore)
  })

  it('does not misclassify a canonical aborted commit as an unknown outcome through a local error prototype', async () => {
    expect(exported.ExternalState).toBeTypeOf('function')
    const binding = {
      endpoint: 'https://sync.example.invalid',
      vaultId: 'sample-vault',
      mode: 'personal',
      principalId: 'sample-principal',
      principalType: 'device',
      grantId: null,
      generation: 1,
      credentialAssociation: 'sample-slot',
    }
    const document = {
      schema: 1,
      ledgerId: 'sample-ledger',
      binding,
      revision: 0,
      files: [],
      operations: [],
    }
    const port = {
      externalDurability: 'durable' as const,
      getExternalState: async () => JSON.stringify(document),
      commitExternalPhase: async () => {
        throw new exported.ExternalStateError('aborted')
      },
    }
    const canonical = await state.ExternalState.open(port, document.ledgerId, binding)
    await expect(canonical.commit({ expectedRevision: 0 })).rejects.toMatchObject({
      reason: 'aborted',
    })
    await expect(canonical.commit({ expectedRevision: 0 })).rejects.toMatchObject({
      reason: 'aborted',
    })
  })
})
