// @vitest-environment node
import { expect, it } from 'vitest'
import { profileSummary } from './diagnostics.mjs'
import { longTaskVerdict } from './oracles.mjs'

const host = { functionName: 'reconcileFileInternal', url: 'app://obsidian.md/app.js' }
const native = { functionName: 'lstat', url: 'node:internal/original-fs/promises' }
const program = { functionName: '(program)', url: '' }
const gc = { functionName: '(garbage collector)', url: '' }
async function classify(frames: typeof host[], complete = true, sampled = true) {
  const task = { event: 'long-task', device: '0', startedAt: 1000, durationMs: 100 }
  return (await profileSummary([task], [
    { event: 'cpu-profile-ready', device: '0', at: 0 },
    { event: 'plugin-load-mark', device: '0', name: 'abele:onload-end', at: 100 },
    { event: 'cpu-profile', device: '0', path: 'fixture', startedAt: 0, endedAt: 2000,
      clock: { beforeAt: 0, afterAt: 0, timestampMs: 0 } },
  ], async () => ({
    startTime: complete ? 0 : 1020000, endTime: 2000000,
    nodes: frames.map((callFrame, index) => ({ id: index + 1, callFrame,
      children: index + 1 < frames.length ? [index + 2] : [] })),
    samples: sampled ? [frames.length] : [],
    timeDeltas: sampled ? [complete ? 1050000 : 30000] : [],
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
    expect(row.owner).toBe('ours during sync')
    expect(row.ownershipReason).toBe('sampled-plugin-frame')
    expect(longTaskVerdict(row).status).toBe('FAIL')
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
