import { expect, it, vi } from 'vitest'
import type { JournalEvent } from '@abele/channel-protocol'
import { restoredTranscript } from '@/node/restoredTranscript'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
import { nodeChatSegments, nodeChatSwitches } from '@/node/nodePathChat'
const e = (session: string, seq: number, type: string, data: unknown): JournalEvent => ({
  kind: 'event',
  node_id: 'sample',
  stream_id: session,
  seq,
  type,
  data,
  actor: { kind: 'node' },
  at: new Date(seq * 1000).toISOString(),
})
const input = (session: string, seq: number, id: string, text: string) =>
  e(session, seq, 'input.accepted', { input_id: id, text })
it('projects only the retained prefix and new inputs after a rewind, preserving raw evidence', async () => {
  const raw = [
    input('source', 1, 'first', 'First question'),
    input('source', 2, 'queued', 'Queued revision'),
    input('source', 3, 'later', 'Later question'),
  ]
  const marker = e('source', 4, 'chat.restored', {
    source_session_id: 'source',
    before_seq: 2,
    exclude_input_ids: ['queued'],
    action: 'rewind',
  })
  const active = await restoredTranscript(
    [...raw, marker, input('source', 5, 'new', 'New question')],
    async () => raw.slice(0, 2)
  )
  expect(
    reduceTranscript(active)
      .messages.filter((m) => m.role === 'user')
      .map((m) => m.content)
  ).toEqual(['First question', 'New question'])
  expect(raw).toHaveLength(3)
})
it('follows nested branch references without sequence collisions between sessions', async () => {
  const source = [input('source', 1, 'first', 'First question')]
  const branch = [
    e('branch', 1, 'chat.restored', {
      source_session_id: 'source',
      before_seq: 1,
      exclude_input_ids: [],
      action: 'branch',
    }),
    input('branch', 2, 'second', 'Second question'),
  ]
  const destination = [
    e('destination', 1, 'chat.restored', {
      source_session_id: 'branch',
      before_seq: 2,
      exclude_input_ids: [],
      action: 'branch',
    }),
    input('destination', 2, 'third', 'Third question'),
  ]
  const read = vi.fn(async (session: string, before: number) =>
    (session === 'source' ? source : branch).filter((event) => event.seq <= before)
  )
  expect(
    reduceTranscript(await restoredTranscript(destination, read))
      .messages.filter((m) => m.role === 'user')
      .map((m) => m.content)
  ).toEqual(['First question', 'Second question', 'Third question'])
  expect(read).toHaveBeenCalledTimes(2)
})
it('retains inherited worktree resource boundaries in the projected sequence order', async () => {
  const source = [
    input('source', 1, 'first', 'Read the first folder.'),
    e('source', 2, 'session.worktree.changed', {
      session_id: 'source',
      project_id: 'project',
      from: { kind: 'worktree', worktree_id: 'first' },
      to: { kind: 'worktree', worktree_id: 'second' },
      by: 'owner',
    }),
    input('source', 3, 'second', 'Read the second folder.'),
  ]
  const active = await restoredTranscript(
    [
      e('branch', 1, 'chat.restored', {
        source_session_id: 'source',
        before_seq: 3,
        exclude_input_ids: [],
        action: 'branch',
      }),
    ],
    async () => source
  )
  const projection = reduceTranscript(active)
  const target = {
    nodeId: 'sample',
    registrationId: 'sample-registration',
    projectId: 'project',
    kind: 'worktree' as const,
    id: 'second',
  }
  const switches = nodeChatSwitches(projection.unknown, target, 'branch', (id) => id, true)
  expect(switches).toHaveLength(1)
  const segments = nodeChatSegments(
    projection.messages,
    projection.messageSequences,
    switches,
    target
  )
  expect(
    segments.map((segment) => [
      segment.target?.id,
      segment.messages.filter((m) => m.role === 'user').map((m) => m.content),
    ])
  ).toEqual([
    ['first', ['Read the first folder.']],
    ['second', ['Read the second folder.']],
  ])
})
