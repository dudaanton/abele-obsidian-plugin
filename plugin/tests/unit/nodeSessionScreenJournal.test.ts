/** The session screens' invented journals are events the node could have written. */
import { expect, it, vi } from 'vitest'
import { NodeEventSchema } from '@abele/node-protocol'
import { journal } from '@/testing/nodeSessionScreen'

vi.mock('@/ai/ChatService', () => ({ ChatService: {} }))
vi.mock('@/node/NodeService', () => ({ NodeService: {} }))

it.each([
  'idle',
  'working',
  'compacting',
  'asking',
  'empty',
  'long',
  'error',
  'rate-limit',
  'letter',
] as const)('the %s screen holds only events the node schema accepts', async (state) => {
  const events = journal(state)
  for (const event of events) expect(() => NodeEventSchema.parse(event)).not.toThrow()
  // A complete fixture has no missing first page for the chat to keep requesting.
  expect(events.map((event) => event.seq)).toEqual(events.map((_, i) => i + 1))
})
