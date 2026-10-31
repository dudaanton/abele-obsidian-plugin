import assert from 'node:assert/strict'
import { test } from 'node:test'
import { oversizedEvidence } from './refusals.mjs'

test('a stopped-app restart starts a new oversized-attempt generation', () => {
  const file = { path: 'Sample/large.bin', size: 20, sha: 'sample-sha' }
  const snapshots = [{ snapshot: { rows: [{ status: 'idle' }], visibleStatus: [{ text: '1 file not synced' }] },
    activity: [{ refused: [{ path: file.path, reason: 'too large' }],
      events: [{ text: `${file.path}: too large` }] }] }]
  const wire = [100, 220, 300].map((at) => ({ device: '0', at, event: 'start', method: 'POST',
    route: `/v2/uploads/${file.sha}/begin` }))
  const [result] = oversizedEvidence([file], [file], snapshots, wire, [], 200, undefined, 250)
  assert.equal(result.maxAttemptsPerGeneration, 1)
  assert.equal(result.pass, true)
})
