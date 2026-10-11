import { describe, expect, it } from 'vitest'
import { NodeEventSchema } from '@abele/node-protocol'
import { EventSchema } from '@abele/channel-protocol'
import { nodeChatSwitches, nodeChatSegments, wirePathTarget } from '@/node/nodePathChat'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
const target = {
  nodeId: 'node-demo',
  registrationId: 'registration-demo',
  projectId: 'project-demo',
  kind: 'worktree' as const,
  id: 'tree-a',
}
const event = (seq: number, type: string, data: unknown) =>
  NodeEventSchema.parse({
    kind: 'event',
    node_id: target.nodeId,
    stream_id: 'chat-demo',
    seq,
    type,
    actor: { kind: 'node' },
    at: '2025-01-01T00:00:00.000Z',
    data,
  })
describe('journal-bound worktree transitions', () => {
  it('deduplicates replayed switch evidence and binds each resource to its message target even at equal timestamps', () => {
    const events = [
      event(1, 'input.accepted', { input_id: 'before', text: 'First task' }),
      event(2, 'session.worktree.changed', {
        session_id: 'chat-demo',
        project_id: target.projectId,
        from: { kind: 'worktree', worktree_id: 'tree-a' },
        to: { kind: 'worktree', worktree_id: 'tree-b' },
        by: 'agent',
      }),
      event(3, 'input.accepted', { input_id: 'after', text: 'Second task' }),
    ]
    const projection = reduceTranscript([...events, events[1]])
    const switches = nodeChatSwitches([...events, events[1]], target, 'chat-demo', (id) => id)
    expect(switches).toHaveLength(1)
    const segments = nodeChatSegments(projection.messages, projection.messageSequences, switches, {
      ...target,
      id: 'tree-b',
    })
    expect(segments[0].target?.id).toBe('tree-a')
    expect(segments[0].messages[0].content).toBe('First task')
    expect(segments[1].target?.id).toBe('tree-b')
    expect(segments[1].messages[0].content).toBe('Second task')
    expect(segments[1].switch?.by).toBe('agent')
  })
  it('ignores malformed or other-session switches; owner switches are not fabricated from selection', () => {
    const switches = nodeChatSwitches(
      [
        event(1, 'session.worktree.changed', {
          session_id: 'other-chat',
          project_id: target.projectId,
          from: { kind: 'worktree', worktree_id: 'tree-a' },
          to: { kind: 'worktree', worktree_id: 'tree-b' },
          by: 'owner',
        }),
        EventSchema.parse({
          ...event(2, 'unknown.retained', {}),
          type: 'session.worktree.changed',
          data: { to: 'a branch name' },
        }),
      ],
      target,
      'chat-demo',
      (id) => id
    )
    expect(switches).toEqual([])
    expect(wirePathTarget(target)).toEqual({ kind: 'worktree', worktree_id: 'tree-a' })
  })
})
