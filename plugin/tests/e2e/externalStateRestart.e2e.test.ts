import { randomBytes } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  hasTestApi,
  isObsidianRunning,
  reopenVaultWindow,
} from './helpers/obsidianCli'
import { targets } from './helpers/target'

targets('desktop')
const available = isObsidianRunning() && hasTestApi()
const database = 'sample-external-state-' + randomBytes(16).toString('hex')
const binding = {
  endpoint: 'https://sync.example.invalid',
  vaultId: 'sample-vault',
  mode: 'personal',
  principalId: 'sample-device',
  principalType: 'device',
  grantId: null,
  generation: 1,
  credentialAssociation: 'sample-slot',
}
const operation = {
  schema: 1,
  operationId: 'sample-operation',
  kind: 'eviction',
  phase: 'delete-ready',
  revision: 0,
  connectionGeneration: 1,
  expected: {
    fileId: 'sample-file',
    versionId: 'sample-version',
    path: 'Media/sample.bin',
    sha: 'a'.repeat(64),
    size: 12,
  },
  sourcePath: 'Media/sample.bin',
  targetPath: 'Media/sample.bin.abele-ref',
  previousRepresentation: 'hydrated',
  localBase: null,
  desiredRepresentation: 'remote-only',
  projectionDigest: 'b'.repeat(64),
  ownedArtifacts: [],
  unresolvedOutcome: null,
  cleanupReason: null,
}
let created = false

afterAll(async () => {
  if (!available || !created) return
  await evalLong(`(async () => {
    const name = ${JSON.stringify(database)}
    if (!/^sample-external-state-[a-f0-9]{32}$/.test(name)) throw new Error('Unowned test database')
    await window.__abeleTest.externalState.IndexedDbStateStore.delete(indexedDB, name)
    return true
  })()`)
})

describe.skipIf(!available)('external durable phases across a real vault renderer restart', () => {
  it('commits through the production IndexedDB port and reads the same phase after closing/reopening only this vault window', async () => {
    expect(evalJson<boolean>('!!window.__abeleTest.externalState')).toBe(true)
    created = true
    const before = JSON.parse(
      await evalLong(`(async () => {
      const { ExternalState, IndexedDbStateStore } = window.__abeleTest.externalState
      const store = await IndexedDbStateStore.open(indexedDB, ${JSON.stringify(database)})
      try {
        const state = await ExternalState.open(store, 'sample-ledger', ${JSON.stringify(binding)})
        const receipt = await state.commit({ expectedRevision: 0, operations: [{ expectedRevision: null, next: ${JSON.stringify(operation)} }] })
        // This object and factory disappear with the renderer. No localStorage/fixture backup.
        window.__externalStateRestartWitness = ${JSON.stringify(database)}
        return { receipt, phase: (await state.snapshot()).operations[0], identity: store.databaseIdentity }
      } finally { store.close() }
    })()`)
    )
    expect(before.receipt).toEqual({ status: 'committed', revision: 1 })
    expect(before.phase).toEqual(operation)
    await reopenVaultWindow()
    expect(evalJson<boolean>('window.__externalStateRestartWitness === undefined')).toBe(true)
    const after = JSON.parse(
      await evalLong(`(async () => {
      const { ExternalState, IndexedDbStateStore } = window.__abeleTest.externalState
      const store = await IndexedDbStateStore.open(indexedDB, ${JSON.stringify(database)})
      try {
        const state = await ExternalState.open(store, 'sample-ledger', ${JSON.stringify(binding)})
        return { document: await state.snapshot(), identity: store.databaseIdentity }
      } finally { store.close() }
    })()`)
    )
    expect(after.identity).toBe(before.identity)
    expect(after.document.revision).toBe(1)
    expect(after.document.operations).toEqual([operation])
  })
})
