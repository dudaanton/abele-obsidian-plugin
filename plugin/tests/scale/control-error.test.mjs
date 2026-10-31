import assert from 'node:assert/strict'
import { test } from 'node:test'
import control from './control-error.cjs'
import { oversizedEvidence } from './refusals.mjs'

test('a failed control startup still starts its own oversized-attempt generation', () => {
  const file = { path: 'Sample/large.bin', size: 20, sha: 'sample-sha' }
  const snapshots = [{ snapshot: { rows: [{ status: 'idle' }], visibleStatus: [{ text: '1 file not synced' }] },
    activity: [{ refused: [{ path: file.path, reason: 'too large' }],
      events: [{ text: `${file.path}: too large` }] }] }]
  const wire = [220, 300].map(at => ({ device: '0', at, event: 'start', method: 'POST',
    route: `/v2/uploads/${file.sha}/begin` }))
  const report = { phases: [{ name: 'control restart', at: 250 }] }
  const [result] = oversizedEvidence([file], [file], snapshots, wire, [], 200,
    control.controlRestartBoundary(report))
  assert.equal(result.maxAttemptsPerGeneration, 1)
  assert.equal(result.pass, true)
})

test('control restart keeps startup error capture while selecting control mode', () => {
  const config = control.controlConfig({ failureDiagnostic: '/sample/capture.cjs' }, '/sample/receipt.json')
  assert.equal(config.mode, 'control')
  assert.equal(config.failureDiagnostic, '/sample/capture.cjs')
})

test('control error saves complete diagnostics before freezing and retains them through recovery', () => {
  const order = [], receipt = {}
  const state = { rows: [{ status: 'error' }], engines: [],
    activity: [{ failure: { stack: ['sample stack'], causes: [{ message: 'sample cause' }], substep: 'sample step' } }] }
  control.captureControlError(receipt, state, () => order.push('save'), () => order.push('freeze'))
  state.rows[0].status = 'idle'
  control.captureControlError(receipt, state, () => order.push('save'), () => order.push('freeze'))
  assert.deepEqual(order, ['save', 'freeze'])
  assert.equal(receipt.errorSnapshot.rows[0].status, 'error')
  assert.equal(receipt.errorSnapshot.activity[0].failure.substep, 'sample step')
  assert.equal(receipt.fatal, true)
})
