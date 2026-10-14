/**
 * A reply in a node chat: the node — Claude Code, pi, any agent it runs — is sent the links over
 * the words, never the agent's words again, and keeps only that text; the chat reads it back as
 * the words with their places.
 */
import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { NodeClient, MemoryClientStore } from '@abele/node-client'
import type { JournalEvent } from '@abele/channel-protocol'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
import { nodeQueueView } from '@/node/presentation'
import type { NodeConnection } from '@/node/NodeService'
import { agentReplyText } from '@/ai/replyLinks'

const reference = {
  kind: 'node-session' as const,
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  sessionId: 'sample-session',
  title: 'Sample session',
}
const places = [
  { messageId: 'run:r1', quote: 'keep the lamp low', start: 5, at: 0 },
  { messageId: 'run:r2', quote: 'Wait for the light', at: 9 },
]

afterEach(() => vi.restoreAllMocks())

it('sends the node links over the words, and clears the draft that held them', async () => {
  const store = new MemoryClientStore()
  await store.transaction((s) => {
    s.node_id = reference.nodeId
  })
  const client = new NodeClient(
    { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
    store
  )
  vi.spyOn(client, 'subscribe').mockResolvedValue(undefined)
  const connection = { client, state: ref('connected') } as unknown as NodeConnection
  vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
  vi.spyOn(client, 'cursor').mockResolvedValue(0)
  vi.spyOn(client, 'flush').mockResolvedValue(undefined)
  vi.spyOn(client, 'operationResult').mockResolvedValue({ result: {} })
  const presenter = new NodeChatPresenter(reference, connection)
  vi.spyOn(presenter, 'refresh').mockResolvedValue(undefined)
  presenter.draft.value.text = '[↩1] How low? [↩2] Then?'

  await presenter.send('How low? Then?', undefined, undefined, {
    replyTo: places,
    draft: presenter.draft.value.text,
  })

  const sent = await store.transaction((s) => s.outbox[0]?.params as { text: string } | undefined)
  expect(sent?.text).toBe(agentReplyText('How low? Then?', places))
  expect(sent?.text).toContain('[reply 1] message run:r1, characters 5-22')
  expect(presenter.draft.value.text).toBe('')
  presenter.destroy()
})

const event = (seq: number, type: string, data: unknown): JournalEvent => ({
  kind: 'event',
  node_id: 'sample-node',
  stream_id: 'sample-session',
  seq,
  type,
  actor: { kind: 'node' },
  at: '2025-01-01T00:00:00.000Z',
  data,
})

it('shows a reply the node kept as the words with their places', () => {
  const text = agentReplyText('How low? Then?', places)
  const projected = reduceTranscript([event(1, 'input.accepted', { input_id: 'i', text })])
  const question = projected.messages[0]
  expect(question.content).toBe('How low? Then?')
  expect(question.replyTo?.map((to) => [to.messageId, to.at])).toEqual([
    ['run:r1', 0],
    ['run:r2', 9],
  ])
})

it('shows a queued reply as the words with their places', () => {
  const text = agentReplyText('How low?', [places[0]])
  const view = nodeQueueView([], [{ id: 'op', text }], [], {})
  expect(view.messages[0]).toMatchObject({
    content: 'How low?',
    replyTo: [{ messageId: 'run:r1', quote: 'keep the lamp low', start: 5, at: 0 }],
  })
})
