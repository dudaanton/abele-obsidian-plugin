import { ref } from 'vue'
import type { AttentionRow } from '@/agents/attention'

export type AgentsFixtureState = 'empty' | 'waiting' | 'many' | 'working' | 'error' | 'mixed'
/** Invented states exercise the real list without opening conversations or providers. */
export function agentsFixture(state: AgentsFixtureState = 'mixed') {
  const at = Date.now() - 15 * 60_000
  const waiting: AttentionRow = {
    key: 'sample-question',
    reference: { kind: 'local', path: 'Chats/sample-question.abchat' },
    title: 'Choose a folder for sample notes',
    agent: 'Sample researcher',
    model: 'Sample model',
    folder: 'Sample work',
    source: 'Chat',
    reasons: [
      {
        kind: 'question',
        id: 'sample-question',
        at,
        text: 'Which folder should I use for the sample notes?',
      },
    ],
  }
  const approval: AttentionRow = {
    ...waiting,
    key: 'sample-approvals',
    reference: { kind: 'local', path: 'Chats/sample-approvals.abchat' },
    title:
      'A long sample conversation about a garden, seasonal plants and plans for future observations',
    agent: 'Sample helper with a long name',
    folder: 'Sample work/An intentionally long invented folder name',
    reasons: ['one', 'two', 'three'].map((id) => ({
      kind: 'approval',
      id,
      at,
      text: 'Edit a sample file',
    })),
  }
  const error: AttentionRow = {
    ...waiting,
    key: 'sample-discussion',
    reference: { kind: 'local', path: 'Comments/sample.abchat', commentId: 'sample' },
    title: 'Sample chapter discussion',
    agent: 'Sample editor',
    source: 'Discussion · Notes/sample-chapter.md',
    quote:
      'An invented passage long enough to wrap over several lines on a narrow screen without being cut off.',
    reasons: [
      {
        kind: 'error',
        id: 'sample-error',
        at,
        text: 'Could not read the sample file. The run stopped.',
      },
    ],
  }
  const working: AttentionRow = {
    ...waiting,
    key: 'sample-working',
    reference: { kind: 'local', path: 'Chats/working.abchat' },
    title: 'Review sample notes',
    agent: 'Sample reviewer',
    reasons: [{ kind: 'running', id: 'sample-run', at }],
  }
  const node: AttentionRow = {
    key: 'sample-node',
    reference: {
      kind: 'node',
      nodeId: 'sample-node',
      registrationId: 'sample-registration',
      sessionId: '',
    },
    title: 'Sample node',
    agent: 'Node',
    source: 'Node · Sample node',
    reasons: [
      {
        kind: 'delivery',
        id: 'sample-connection',
        at: 0,
        text: "Can't load this node's sessions right now",
      },
    ],
  }
  const rows =
    state === 'empty'
      ? []
      : state === 'waiting'
        ? [waiting]
        : state === 'working'
          ? [working]
          : state === 'error'
            ? [error]
            : state === 'many'
              ? [
                  approval,
                  {
                    ...waiting,
                    title:
                      'A long sample question about choosing a folder for drafts and continuing the chapter discussion',
                    agent: 'Sample researcher with a very long name',
                  },
                  error,
                  working,
                ]
              : [waiting, working, node]
  return {
    rows: ref(rows),
    incomplete: ref(state === 'mixed'),
    status: ref(''),
    open: async () => false,
    markSeen: async () => {},
    reconnect: async () => {},
  }
}
