import { expect, it, vi } from 'vitest'
import type { JournalEvent } from '@abele/channel-protocol'
import { restoredTranscript } from '@/node/restoredTranscript'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
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
