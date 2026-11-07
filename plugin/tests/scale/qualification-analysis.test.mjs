import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as analysis from './qualification-analysis.mjs'

test('reports ten-minute SHA seal rates and explicit inventory durations without inventing legacy timings', () => {
  assert.equal(typeof analysis.qualificationAnalysis, 'function')
  const report = {
    phases: [{ name: 'second device pull', at: 1000 }],
    peerInitialDownloadMs: 610000,
    reindexInventoryTimings: [{ id: 'comparison', inventoryMs: 40000, manifestMs: 12 }],
  }
  const seal = (at, sha) => ({
    device: '1',
    event: 'renderer-hash',
    source: 'abele',
    stack: 'at async Object.seal',
    at,
    sha,
  })
  const result = analysis.qualificationAnalysis(report, [
    seal(2000, 'a'),
    seal(2001, 'a'),
    seal(602000, 'b'),
  ])
  assert.equal(result.peerPull[0].seals, 1)
  assert.equal(result.peerPull[1].filesPerSecond, 0.1)
  assert.deepEqual(result.reindexInventory, report.reindexInventoryTimings)
  assert.deepEqual(analysis.qualificationAnalysis({}, []).reindexInventory, [])
  assert.deepEqual(
    analysis.qualificationAnalysis(
      {},
      [],
      [{ label: 'baseline', peerPull: [], reindexInventory: [] }]
    ).baselines,
    [{ label: 'baseline', peerPull: [], reindexInventory: [] }]
  )
})
