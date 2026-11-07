// @vitest-environment node
import { expect, it } from 'vitest'
import { profileSummary } from './diagnostics.mjs'
import { longTaskVerdict } from './oracles.mjs'

const host = { functionName: 'reconcileFileInternal', url: 'app://obsidian.md/app.js' }
const native = { functionName: 'lstat', url: 'node:internal/original-fs/promises' }
const program = { functionName: '(program)', url: '' }
const gc = { functionName: '(garbage collector)', url: '' }
async function classify(frames: typeof host[], complete = true, sampled = true, extra: Record<string, unknown>[] = [], pluginMs = 50) {
  const task = { event: 'long-task', device: '0', startedAt: 1000, durationMs: 100 }
  return (await profileSummary([task], [
    { event: 'cpu-profile-ready', device: '0', at: 0 },
    { event: 'plugin-load-mark', device: '0', name: 'abele:onload-end', at: 100 },
    { event: 'cpu-profile', device: '0', path: 'fixture', startedAt: 0, endedAt: 2000,
      clock: { beforeAt: 0, afterAt: 0, timestampMs: 0 } },
    ...extra,
  ], async () => ({
    startTime: complete ? 0 : 1020000, endTime: 2000000,
    nodes: frames.map((callFrame, index) => ({ id: index + 1, callFrame,
      children: index + 1 < frames.length ? [index + 2] : [] })),
    samples: sampled ? [frames.length] : [],
    timeDeltas: sampled ? [complete ? (1000 + pluginMs) * 1000 : 30000] : [],
  })))[0]
}

it.each([[host], [native], [program], [gc], [host, native, program, gc]])(
  'assigns complete sampled tasks without plugin frames to the host: %j', async (...frames) => {
    const row = await classify(frames)
    expect(row.owner).toBe('host-only')
    expect(row.ownershipReason).toBe('complete-coverage-no-plugin-frames')
    expect(longTaskVerdict(row).status).toBe('PASS')
  })

it.each(['plugin:abele', '/sample/vault/.obsidian/plugins/abele/main.js'])
  ('keeps a plugin ancestor decisive even beneath native/VM frames: %s', async url => {
    const row = await classify([{ functionName: 'syncStep', url }, host, native, program, gc])
    // Owner decision 2026-11-07: only our sampled time counts; exactly 50 ms is within budget.
    expect(row.owner).toBe('host task with our code ≤ budget')
    expect(row.ownershipReason).toBe('sampled-plugin-frame')
    expect(row.ourSampledMs).toBe(50)
    expect(longTaskVerdict(row).status).toBe('PASS')
  })

it('keeps incomplete coverage without plugin frames unattributed', async () => {
  const row = await classify([host, native, program, gc], false)
  expect(row.owner).toBe('unattributed')
  expect(row.ownershipReason).toBe('incomplete-profile-coverage')
  expect(longTaskVerdict(row).status).toBe('FAIL')
})

it('does not infer host ownership from complete coverage with zero samples', async () => {
  const row = await classify([host], true, false)
  expect(row.owner).toBe('unattributed')
  expect(row.ownershipReason).toBe('no-correlated-samples')
  expect(longTaskVerdict(row).status).toBe('FAIL')
})

it('does not waive missing samples on external shared-stop evidence', async () => {
  const evidence = [900, 1000, 1100, 1200].map(at => ({ event: 'host-process-sample', at,
    processes: [{ pid: 12, parentPid: 1, state: 'T', cpuMs: 20 },
      { pid: 13, parentPid: 12, state: 'T', cpuMs: 30 }] }))
  const row = await classify([host], true, false, evidence)
  expect(row.hostSchedulingEvidence).toMatchObject({ complete: true,
    reason: 'shared-observed-process-stop', ownershipProof: false })
  expect(row.owner).toBe('unattributed')
  expect(longTaskVerdict(row).status).toBe('FAIL')
  const plugin = await classify([{ functionName: 'syncStep', url: 'plugin:abele' }], true, true, evidence)
  // Owner decision 2026-11-07: shared-stop evidence cannot erase our 50 ms, which is within budget.
  expect(plugin.owner).toBe('host task with our code ≤ budget')
  expect(plugin.ownershipReason).toBe('sampled-plugin-frame')
  expect(plugin.ourSampledMs).toBe(50)
  expect(longTaskVerdict(plugin).status).toBe('PASS')
  const over = await classify([{ functionName: 'syncStep', url: 'plugin:abele' }, host, native, program, gc], true, true, evidence, 51)
  expect(over.owner).toBe('ours during sync')
  expect(over.ownershipReason).toBe('sampled-plugin-frame')
  expect(over.ourSampledMs).toBe(51)
  expect(longTaskVerdict(over).status).toBe('FAIL')
})
