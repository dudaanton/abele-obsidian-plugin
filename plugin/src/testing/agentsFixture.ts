import { ref } from 'vue'
import type { AttentionRow } from '@/agents/attention'

/** Invented states exercise narrow rows without opening conversations or providers. */
export function agentsFixture() {
  const rows: AttentionRow[] = [
    {
      key: 'sample-chat',
      reference: { kind: 'local', path: 'Chats/sample.abchat' },
      title: 'A long invented conversation title about a sample garden and its seasonal plants',
      agent: 'Sample agent',
      source: 'Чат',
      reasons: ['one', 'two', 'three'].map((id) => ({
        kind: 'approval',
        id,
        at: 1,
        text: 'edit',
        uncertain: true,
      })),
    },
    {
      key: 'sample-discussion',
      reference: { kind: 'local', path: 'Comments/sample.abchat', commentId: 'sample' },
      title: 'A sample discussion about an invented chapter',
      agent: 'Sample editor',
      source: 'Обсуждение · Notes/sample-chapter.md',
      quote:
        'An invented passage long enough to wrap onto several lines on a narrow screen without truncation.',
      reasons: [
        {
          kind: 'error',
          id: 'sample-error',
          at: 2,
          text: 'An invented failure description for a stopped run.',
        },
      ],
    },
    {
      key: 'sample-working',
      reference: { kind: 'local', path: 'Chats/working.abchat' },
      title: 'Sample ongoing work',
      agent: 'Sample worker',
      source: 'Чат',
      reasons: [{ kind: 'running', id: 'sample-run', at: 3 }],
    },
    {
      key: 'sample-node',
      reference: {
        kind: 'node',
        nodeId: 'sample-node',
        registrationId: 'sample-registration',
        sessionId: 'sample-session',
      },
      title: 'Sample disconnected node',
      agent: 'Sample provider',
      source: 'Node · Sample node · Sample project',
      reasons: [
        {
          kind: 'delivery',
          id: 'sample-connection',
          at: 4,
          text: 'Обновляется · Последнее состояние недоступно',
        },
      ],
    },
  ]
  return {
    rows: ref(rows),
    incomplete: ref(true),
    status: ref('Обновляется'),
    open: async () => false,
    markSeen: async () => {},
  }
}
