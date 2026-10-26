import { expect, it } from 'vitest'
import probe from '../scale/heap.cjs'
import { EventEmitter } from 'node:events'

it('does not replay a settled snapshot request after renderer reload', () => {
  expect(probe.freshRequest({ startedAt: 100 }, 200)).toBe(false)
  expect(probe.freshRequest({ startedAt: 199, requestedAt: 201 }, 200)).toBe(true)
  expect(probe.freshRequest({}, 200)).toBe(false)
})

it('captures host state before a blocked renderer probe times out', async () => {
  const events: any[] = []
  const pending = probe.probeRenderer({
    command: () => new Promise(() => {}),
    state: () => ({ mainPid: 42 }),
    emit: (event: any) => events.push(event),
    timeoutMs: 5,
  })
  expect(events[0]).toMatchObject({ event: 'renderer-probe-start', mainPid: 42 })
  await pending
  expect(events.at(-1)).toMatchObject({ event: 'renderer-probe-end', responsive: false })
})

it('streams snapshot chunks in order and removes its listener after failure', async () => {
  const transport = Object.assign(new EventEmitter(), {
    sendCommand: async () => {
      transport.emit('message', {}, 'HeapProfiler.addHeapSnapshotChunk', { chunk: 'first' })
      transport.emit('message', {}, 'HeapProfiler.addHeapSnapshotChunk', { chunk: 'second' })
    },
  })
  const chunks: string[] = []
  await probe.streamSnapshot(transport, (chunk: string) => chunks.push(chunk))
  expect(chunks).toEqual(['first', 'second'])
  expect(transport.listenerCount('message')).toBe(0)
  await expect(
    probe.streamSnapshot(transport, () => {
      throw Error('disk full')
    })
  ).rejects.toThrow('disk full')
  expect(transport.listenerCount('message')).toBe(0)
})

it('records heap usage and responsiveness independently', async () => {
  const events: any[] = []
  await probe.probeRenderer({
    command: async (name: string) => {
      if (name === 'Runtime.getHeapUsage') return { usedSize: 123, totalSize: 456 }
      return { result: { value: 2 } }
    },
    state: () => ({ mainPid: 42 }),
    emit: (event: any) => events.push(event),
  })
  expect(events.at(-1)).toMatchObject({ responsive: true, heap: { usedSize: 123 } })
})
