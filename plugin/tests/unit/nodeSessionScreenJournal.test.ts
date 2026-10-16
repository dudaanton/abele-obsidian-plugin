/** The session screens' invented journals are events the node could have written. */
import { expect, it, vi } from 'vitest'
import { NodeEventSchema } from '@abele/node-protocol'

vi.mock('@/ai/ChatService', () => ({ ChatService: {} }))
vi.mock('@/node/NodeService', () => ({ NodeService: {} }))

it.each(['idle', 'working', 'compacting', 'asking', 'empty', 'long', 'error'] as const)(
  'the %s screen holds only events the node schema accepts',
  async (state) => {
    const { journal } = await import('@/testing/nodeSessionScreen')
    for (const event of journal(state)) expect(() => NodeEventSchema.parse(event)).not.toThrow()
  }
)
