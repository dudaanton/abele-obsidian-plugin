import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyReindexHashes } from './reindex.mjs'

test('download installation payload digest within a reindex is reported separately', () => {
  const operation = { id: 'peer-reindex', device: '1', at: 100 }
  const digest = { event: 'renderer-hash', device: '1', source: 'abele', at: 125,
    sha: 'sample-payload', stack: 'at BoundedVaultIo.fingerprint\n at async Object.seal' }
  const entries = [digest, { event: 'reindex-complete', id: operation.id, device: '1', at: 150 }]
  const result = classifyReindexHashes(operation, entries, 200, new Set([digest.sha]))
  assert.deepEqual(result.reindexHashes, [])
  assert.deepEqual(result.inReindexPayloadDigests, [digest])
})
