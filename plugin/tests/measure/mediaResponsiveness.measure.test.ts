/** Work-slice diagnostics, not a substitute for a live UI or phone measurement. */
import { expect, it } from 'vitest'
import { RepoIndex } from '@/github/search/repoIndex'
import { hashMediaBytes } from '@/media/contentHash'

function yieldProbe() {
  let segmentStart = performance.now()
  let maxSegmentMs = 0
  let yields = 0
  return {
    yieldWork: async () => {
      maxSegmentMs = Math.max(maxSegmentMs, performance.now() - segmentStart)
      yields++
      await new Promise((resolve) => setTimeout(resolve, 0))
      segmentStart = performance.now()
    },
    finish: () => ({ yields, maxSegmentMs: +Math.max(maxSegmentMs, performance.now() - segmentStart).toFixed(2) }),
  }
}

it('records synchronous and cooperative index slices with identical input', async () => {
  const count = 2048, size = 4096, block = 512 + size
  const tar = new Uint8Array(count * block + 1024)
  const encoder = new TextEncoder()
  for (let i = 0; i < count; i++) {
    const at = i * block
    tar.set(encoder.encode(`root/sample-${i}.ts`), at)
    tar.set(encoder.encode(size.toString(8).padStart(11, '0')), at + 124)
    tar[at + 156] = 48
    tar.fill(97, at + 512, at + block)
  }
  let start = performance.now()
  const sync = RepoIndex.fromTar(tar)
  const syncMs = performance.now() - start
  const probe = yieldProbe()
  start = performance.now()
  const sliced = await RepoIndex.fromTarAsync(tar, { yieldWork: probe.yieldWork })
  console.log(JSON.stringify({ operation: 'index', files: count, inputBytes: tar.length,
    syncMs: +syncMs.toFixed(2), cooperativeMs: +(performance.now() - start).toFixed(2), ...probe.finish() }))
  expect(sliced.files).toEqual(sync.files)
  expect(sliced.bytes).toBe(sync.bytes)
})

it('records synchronous and cooperative media fingerprint slices', async () => {
  const data = new Uint8Array(8 * 1024 * 1024)
  for (let i = 0; i < data.length; i++) data[i] = i % 251
  let hash = 0x811c9dc5
  let start = performance.now()
  for (const byte of data) hash = Math.imul(hash ^ byte, 0x01000193)
  const syncMs = performance.now() - start
  const probe = yieldProbe()
  start = performance.now()
  const sliced = await hashMediaBytes(data.buffer, probe.yieldWork)
  console.log(JSON.stringify({ operation: 'fingerprint', inputBytes: data.length,
    syncMs: +syncMs.toFixed(2), cooperativeMs: +(performance.now() - start).toFixed(2), ...probe.finish() }))
  expect(sliced).toBe((hash >>> 0).toString(36))
})
