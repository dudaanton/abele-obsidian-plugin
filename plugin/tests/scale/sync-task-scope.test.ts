// @vitest-environment node
import { expect, it } from 'vitest'
import { profileSummary, longTaskScope } from './diagnostics.mjs'
import { longTaskVerdict } from './oracles.mjs'

const lifecycle = [
  { event: 'renderer-start', device: '0', at: 0 },
  { event: 'cpu-profile-ready', device: '0', at: 500 },
  { event: 'plugin-load-mark', device: '0', name: 'abele:onload-end', at: 1000 },
  { event: 'harness-stop-request', device: '0', at: 2000 },
]
it('resets the boundary on launch and reload without exempting the preceding sync task', () => {
  expect(longTaskScope({ device: '0', startedAt: 1999, durationMs: 100 }, lifecycle)).toBe('sync')
  expect(longTaskScope({ device: '0', startedAt: 3050, durationMs: 100 }, [...lifecycle,
    { event: 'harness-launch-request', device: '0', at: 3000 }])).toBe('load')
  expect(longTaskScope({ device: '0', startedAt: 1550, durationMs: 100 }, [...lifecycle,
    { event: 'plugin-load-mark', device: '0', name: 'abele:eval-start', at: 1500 }])).toBe('load')
})
async function summarize(startedAt: number, urls: string[], complete = true, extra: any[] = [], pluginMs = 50) {
  const task = { event: 'long-task', device: '0', startedAt, durationMs: 100 }
  return (await profileSummary([task], [...lifecycle, ...extra, {
    event: 'cpu-profile', device: '0', startedAt: 0, endedAt: 4000, path: 'sample',
    clock: { beforeAt: 0, afterAt: 0, timestampMs: 0 },
  }], async () => ({ startTime: complete ? 0 : (startedAt + 25) * 1000, endTime: 4000000,
    nodes: urls.map((url, index) => ({ id: index + 1, callFrame: { functionName: 'sample', url },
      children: index + 1 < urls.length ? [index + 2] : [] })),
    samples: [urls.length], timeDeltas: [(complete ? startedAt + pluginMs : 25) * 1000] })))[0]
}
it('uses the load budget until onload completes even without CPU coverage', async () => {
  const row = await summarize(900, ['plugin:abele'], false)
  expect(row.owner).toBe('plugin load')
  expect(longTaskVerdict(row).status).toBe('PASS')
  expect(longTaskVerdict({ ...row, durationMs: 801 }).status).toBe('FAIL')
})
it('reports tasks after the quit request without gating attribution or duration', async () => {
  const row = await summarize(2000, [''], false)
  expect(row.owner).toBe('teardown')
  expect(longTaskVerdict({ ...row, durationMs: 900 }).status).toBe('PASS')
})
it('fails an uncovered task inside the sync interval', async () => {
  const row = await summarize(1000, ['app://obsidian.md/app.js'], false)
  expect(row.owner).toBe('unattributed')
  expect(longTaskVerdict(row).status).toBe('FAIL')
})
it('does not let incomplete ledger coverage veto a complete host profile', async () => {
  const row = await summarize(1000, ['app://obsidian.md/app.js'], true, [{
    event: 'plugin-entry-ledger-partial', device: '0', generation: 'sample', at: 0, reason: 'sample',
  }])
  expect(row.owner).toBe('host-only')
  expect(longTaskVerdict(row).status).toBe('PASS')
})
it('keeps plugin samples decisive even with a harness leaf and contradictory ledger', async () => {
  const evidence = [
    { event: 'plugin-entry-ledger-ready', device: '0', generation: 'sample', at: 0, complete: true, coverageStartedAt: 0 },
    { event: 'plugin-entry-ledger-checkpoint', device: '0', generation: 'sample', at: 3000, complete: true },
  ]
  const row = await summarize(1000, ['plugin:abele', 'plugin:scale-observer'], true, evidence)
  // Owner decision 2026-11-07: the ledger cannot erase plugin evidence; exactly 50 ms passes.
  expect(row.owner).toBe('host task with our code ≤ budget')
  expect(row.ownershipReason).toBe('sampled-plugin-frame')
  expect(row.ourSampledMs).toBe(50)
  expect(longTaskVerdict(row).status).toBe('PASS')
  const over = await summarize(1000, ['plugin:abele', 'plugin:scale-observer'], true, evidence, 51)
  expect(over.owner).toBe('ours during sync')
  expect(over.ownershipReason).toBe('sampled-plugin-frame')
  expect(over.ourSampledMs).toBe(51)
  expect(longTaskVerdict(over).status).toBe('FAIL')
})
