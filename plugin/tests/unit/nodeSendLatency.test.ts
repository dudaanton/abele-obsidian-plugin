import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { NodeClient } from '@abele/node-client'
import { NodeClientStore } from '@/node/NodeClientStore'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import type { NodeConnection } from '@/node/NodeService'
import { giantJournal } from '../fixtures/giantJournal.mjs'

it('sends without waiting for retained tool history after many compactions', async () => {
  const samples = []
  for (const turns of [10, 5000]) {
    const store = new NodeClientStore('sample-send-' + turns, new IDBFactory())
    const client = new NodeClient(
      { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
      store
    )
    vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
    const presenter = new NodeChatPresenter(
      {
        kind: 'node-session',
        nodeId: 'sample-node',
        registrationId: 'sample-registration',
        sessionId: 'sample-giant-session',
        title: 'Sample long session',
      },
      { client, state: ref('connected'), error: ref('') } as unknown as NodeConnection
    )
    try {
      const events = giantJournal({ turns, outputBytes: 40, compactEvery: 50 })
      await store.transaction((state) => {
        state.events['sample-giant-session'] = events
        state.cursors['sample-giant-session'] = events.at(-1)!.seq
        state.operationRequests = {}
        // Approval evidence survives compaction and remains available after sending.
        for (let i = 0; i < turns; i++) {
          state.results['sample-answer-' + i] = {
            answer: {
              sessionId: 'sample-giant-session',
              promptId: 'sample-prompt-' + i,
              choice: 'allow',
            },
          }
          state.operationRequests['sample-answer-' + i] = {
            method: 'prompt.answer',
            params: {
              session_id: 'sample-giant-session',
              prompt_id: 'sample-prompt-' + i,
              run_id: 'sample-process',
              revision: 1,
              action_digest: 'a'.repeat(64),
              choice: 'allow',
            },
          }
        }
      })
      await presenter.refresh()
      let requestMs = 0
      let shownMs = 0
      let started = 0
      const put = vi.spyOn(IDBObjectStore.prototype, 'put')
      vi.spyOn(client, 'flush').mockImplementation(async () => {
        requestMs = performance.now() - started
        expect(put.mock.calls.some(([, key]) => key === 'record-revisions')).toBe(false)
        await presenter.refresh()
        expect(presenter.presentation.value.messages.at(-1)?.content).toBe('Sample next question')
        shownMs = performance.now() - started
      })
      started = performance.now()
      await presenter.send('Sample next question')
      expect(presenter.error.value).toBe('')
      expect(requestMs).toBeGreaterThan(0)
      samples.push({ turns, requestMs, shownMs })
      expect(await store.read((s) => s.results['sample-answer-0'].answer?.choice)).toBe('allow')
    } finally {
      presenter.destroy()
      store.close()
      vi.restoreAllMocks()
    }
  }
  console.log('SEND_LATENCY', JSON.stringify(samples))
  expect(samples[1].requestMs).toBeLessThan(Math.max(80, samples[0].requestMs * 4))
  expect(samples[1].shownMs).toBeLessThan(Math.max(120, samples[0].shownMs * 4))
}, 30000)

it('persists composer edits without enumerating receipts or rewriting their manifest', async () => {
  const factory = new IDBFactory()
  const store = new NodeClientStore('sample-composer-receipts', factory)
  try {
    await store.transaction((s) => {
      for (let i = 0; i < 1100; i++)
        s.results['sample-answer-' + i] = {
          answer: { sessionId: 'sample-session', promptId: 'sample-prompt-' + i, choice: 'allow' },
        }
    })
    const originalKeys = Object.keys
    let receiptEnumerations = 0
    const keys = vi.spyOn(Object, 'keys').mockImplementation((value) => {
      const result = originalKeys(value)
      if (result.includes('sample-answer-0')) receiptEnumerations++
      return result
    })
    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    try {
      await store.transaction((s) => {
        s.chatDrafts = { 'sample-session': { text: 'Sample draft', notice: '' } }
      })
      expect(receiptEnumerations).toBe(0)
      expect(put.mock.calls.some(([, key]) => key === 'record-revisions')).toBe(false)
    } finally {
      keys.mockRestore()
      put.mockRestore()
    }
    const reader = new NodeClientStore('sample-composer-receipts', factory)
    try {
      expect(await reader.read((s) => s.chatDrafts?.['sample-session'].text)).toBe('Sample draft')
      expect(await reader.read((s) => Object.keys(s.results).length)).toBe(1100)
    } finally {
      reader.close()
    }
  } finally {
    store.close()
  }
})
