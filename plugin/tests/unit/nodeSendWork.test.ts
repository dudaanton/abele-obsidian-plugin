import { describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { NodeClientStore } from '@/node/NodeClientStore'

/** Count visited entries, including native map copies and payloads handed to IndexedDB. */
function countWork() {
  let entries = 0
  let written = 0
  const keys = Object.keys
  const ownKeys = Reflect.ownKeys
  const descriptors = Object.getOwnPropertyDescriptors
  const values = Object.values
  const objectEntries = Object.entries
  const spies: { mockRestore(): void }[] = [
    vi.spyOn(Object, 'keys').mockImplementation((value) => {
      const result = keys(value)
      entries += result.length
      return result
    }),
    vi.spyOn(Object, 'entries').mockImplementation((value) => {
      const result = objectEntries(value)
      entries += result.length
      return result
    }),
    vi.spyOn(Object, 'values').mockImplementation((value) => {
      const result = values(value)
      entries += result.length
      return result
    }),
    vi.spyOn(Object, 'getOwnPropertyDescriptors').mockImplementation((value) => {
      const result = descriptors(value)
      entries += keys(result).length
      return result
    }),
    vi.spyOn(Reflect, 'ownKeys').mockImplementation((value) => {
      const result = ownKeys(value)
      entries += result.length
      return result
    }),
  ]
  for (const method of [Symbol.iterator, 'keys', 'values'] as const) {
    const original = Map.prototype[method]
    spies.push(
      vi.spyOn(Map.prototype, method).mockImplementation(function () {
        const iterator = original.call(this)
        const next = iterator.next.bind(iterator)
        iterator.next = () => {
          const result = next()
          if (!result.done) entries++
          return result
        }
        return iterator
      })
    )
  }
  const put = IDBObjectStore.prototype.put
  spies.push(
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      const size = (item: unknown): number =>
        item && typeof item === 'object'
          ? objectEntries(item).reduce((n, [, child]) => n + 1 + size(child), 0)
          : 0
      written += size(value)
      return put.call(this, value, key)
    })
  )
  return () => {
    for (const spy of spies) spy.mockRestore()
    return { entries, written }
  }
}

describe.sequential('draft saves and send admission with retained approval history', () => {
  const baseline: Partial<Record<'draft' | 'send', { entries: number; written: number }>> = {}
  it.each([1000, 10000, 5000, 20000])(
    'keeps work constant at %i retained turns',
    async (turns) => {
      const store = new NodeClientStore('sample-send-work-' + turns, new IDBFactory())
      try {
        await store.transaction((s) => {
          s.operationRequests = {}
          for (let i = 0; i < turns; i++) {
            const id = 'sample-answer-' + i
            s.results[id] = {
              answer: {
                sessionId: 'sample-session',
                promptId: 'sample-prompt-' + i,
                choice: 'allow',
              },
            }
            s.operationRequests[id] = {
              method: 'prompt.answer',
              params: {
                session_id: 'sample-session',
                prompt_id: 'sample-prompt-' + i,
                run_id: 'sample-process',
                revision: 1,
                action_digest: 'a'.repeat(64),
                choice: 'allow',
              },
            }
          }
        })
        // Warm schema compilation and row access equally at every history size.
        await store.transaction((s) => {
          s.chatDrafts!['sample-session'] = { text: 'Sample initial draft', notice: '' }
          s.operationRequests!['sample-warm-send'] = {
            method: 'session.send',
            params: { session_id: 'sample-session', text: 'Sample warmup', observed_seq: 0 },
          }
        })
        await store.transaction((s) => {
          delete s.operationRequests!['sample-warm-send']
        })
        const stopDraft = countWork()
        const draftStart = performance.now()
        await store.transaction((s) => {
          s.chatDrafts!['sample-session'] = { text: 'Sample next question', notice: '' }
        })
        const draftMs = performance.now() - draftStart
        const draft = stopDraft()
        const stopSend = countWork()
        const sendStart = performance.now()
        await store.transaction((s) => {
          const request = {
            method: 'session.send',
            params: {
              session_id: 'sample-session',
              text: 'Sample next question',
              observed_seq: turns * 12,
            },
          }
          s.operationRequests!['sample-next-send'] = request
          s.outbox.push({ operation_id: 'sample-next-send', ...request })
          delete s.chatDrafts!['sample-session']
        })
        // Catch work deferred until the transaction after the save, too.
        await store.transaction((s) => {
          void s.operationRequests!['sample-next-send']
        })
        const sendMs = performance.now() - sendStart
        const send = stopSend()
        const sample = { turns, draftMs, sendMs, draft, send }
        console.log('SEND_WORK', JSON.stringify(sample))
        for (const kind of ['draft', 'send'] as const) {
          baseline[kind] ??= sample[kind]
          expect(sample[kind].entries).toBeLessThanOrEqual(baseline[kind]!.entries * 1.25)
          expect(sample[kind].entries).toBeGreaterThanOrEqual(baseline[kind]!.entries / 1.25)
          expect(sample[kind].written).toBeLessThanOrEqual(baseline[kind]!.written * 1.25)
          expect(sample[kind].written).toBeGreaterThanOrEqual(baseline[kind]!.written / 1.25)
        }
      } finally {
        vi.restoreAllMocks()
        store.close()
      }
    },
    60000
  )
})
