import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as analysis from './qualification-analysis.mjs'

test('reports every precise counter interval and its transfer overlap without changing budgets', () => {
  const r = { phaseTimings: [{ name: 'second device pull', at: 100, durationMs: 200 }] }
  const rows = [
    { event: 'precise-coverage-start', device: '1', id: 'sample', intervalId: 'a', startedAt: 110 },
    {
      event: 'precise-coverage-stop',
      device: '1',
      id: 'sample',
      intervalId: 'a',
      endedAt: 130,
      stopped: true,
    },
    { event: 'reindex-complete', device: '1', id: 'sample', at: 131 },
  ]
  const result = analysis.qualificationAnalysis(r, rows)
  assert.equal(result.preciseCoverage[0].endedAt, 130)
  assert.equal(result.preciseCoverage[0].stoppedByCompletion, true)
  assert.equal(result.preciseCoverage[0].transferOverlaps[0].durationMs, 20)
})

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
