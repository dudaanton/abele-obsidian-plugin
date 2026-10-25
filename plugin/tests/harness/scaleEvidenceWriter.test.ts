// @vitest-environment node
import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

it('batches asynchronous evidence in order and acknowledges only after persistence', async () => {
  const { createEvidenceWriter } = require('../scale/evidence-writer.cjs')
  const chunks: string[] = []
  let release!: () => void
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  const writer = createEvidenceWriter(async (text: string) => {
    await barrier
    chunks.push(text)
  })
  for (let i = 0; i < 1000; i++) writer.enqueue(JSON.stringify({ index: i }) + '\n')
  let done = false
  const flush = writer.flush().then(() => {
    done = true
  })
  await Promise.resolve()
  expect(chunks).toEqual([])
  expect(done).toBe(false)
  release()
  await flush
  expect(chunks.length).toBeLessThan(10)
  expect(
    chunks
      .join('')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).index)
  ).toEqual(Array.from({ length: 1000 }, (_, i) => i))
})

it('fails evidence closed on storage failure or bounded-queue overflow', async () => {
  const { createEvidenceWriter } = require('../scale/evidence-writer.cjs')
  const failed = createEvidenceWriter(async () => {
    throw new Error('sample disk failure')
  })
  failed.enqueue('sample\n')
  await expect(failed.flush()).rejects.toThrow('sample disk failure')
  const full = createEvidenceWriter(async () => {}, { maximumBytes: 4 })
  full.enqueue('oversized\n')
  await expect(full.flush()).rejects.toThrow('Evidence queue exceeded')
})
