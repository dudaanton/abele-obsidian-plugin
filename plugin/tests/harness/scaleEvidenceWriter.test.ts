// @vitest-environment node
import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
const require = createRequire(import.meta.url)

it('keeps the host alive until asynchronous ledger batches survive renderer quit', async () => {
  const { createEvidenceWriter, drainOnQuit } = require('../scale/evidence-writer.cjs')
  const app = new EventEmitter() as any
  let quit = 0, persisted = false, release!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  const writer = createEvidenceWriter(async () => { await barrier; persisted = true })
  const state = drainOnQuit(app, writer)
  app.quit = () => { quit++; expect(persisted).toBe(true) }
  writer.enqueue('final ledger batch\n')
  let prevented = false
  app.emit('will-quit', { preventDefault() { prevented = true } })
  expect(prevented).toBe(true)
  expect(quit).toBe(0)
  release()
  await state.done
  expect(quit).toBe(1)
})

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
