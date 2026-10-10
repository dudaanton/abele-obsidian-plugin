import { afterEach, expect, it, vi } from 'vitest'
import { AttentionReader } from '@/agents/AttentionReader'

const host = vi.hoisted(() => ({
  worker: undefined as
    | undefined
    | {
        onmessage: ((event: { data: unknown }) => void) | null
        onerror: (() => void) | null
        terminate: ReturnType<typeof vi.fn>
        postMessage: ReturnType<typeof vi.fn>
      },
}))
vi.mock('@/ai/chatAttention.worker?worker&inline', () => ({
  default: class {
    onmessage = null
    onerror = null
    terminate = vi.fn()
    postMessage = vi.fn()
    constructor() {
      host.worker = this
    }
  },
}))
afterEach(() => vi.unstubAllGlobals())

it('uses one worker for large records and rejects outstanding reads on unload', async () => {
  vi.stubGlobal('Worker', class {})
  const reader = new AttentionReader()
  const reading = reader.read('x'.repeat(300000), async () => {})
  const second = reader.read('y'.repeat(300000), async () => {})
  const worker = host.worker!
  expect(worker.postMessage).toHaveBeenCalledTimes(2)
  const snapshot = { metadata: null, records: 0, damaged: 0, torn: false, version: 1 }
  worker.onmessage!({ data: { id: 1, snapshot } })
  expect(await reading).toEqual(snapshot)
  const rejected = expect(second).rejects.toThrow('could not be checked')
  reader.destroy()
  await rejected
  expect(worker.terminate).toHaveBeenCalledOnce()
})

it('falls back cooperatively after a worker failure instead of leaking a reader', async () => {
  vi.stubGlobal('Worker', class {})
  const reader = new AttentionReader()
  const reading = reader.read('x'.repeat(300000), async () => {})
  const rejected = expect(reading).rejects.toThrow('could not be checked')
  host.worker!.onerror!()
  await rejected
  const yieldControl = vi.fn().mockResolvedValue(undefined)
  expect((await reader.read('x'.repeat(300000), yieldControl)).metadata).toBeNull()
  expect(yieldControl).toHaveBeenCalled()
  reader.destroy()
})
