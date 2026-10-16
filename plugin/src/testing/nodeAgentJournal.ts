import type { JournalEvent } from '@abele/channel-protocol'

/**
 * The invented journals of an agent other than Claude in its node chat: pi working through a
 * plan with tool calls and a change, and an ACP agent (Gemini) asking before it edits a file.
 * Written the way the node writes them: the shared `session.update` vocabulary beside its own
 * turn and input records.
 */
export function agentJournal(
  state: 'agent' | 'agent-asking',
  node: string,
  session: string
): JournalEvent[] {
  let seq = 0
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()
  const provider = state === 'agent' ? 'pi' : 'acp'
  const by = { kind: 'provider', provider, session_id: session } as const
  const e = (
    type: string,
    data: Record<string, unknown>,
    minutesAgo: number,
    actor: JournalEvent['actor'] = { kind: 'node' }
  ): JournalEvent => ({
    kind: 'event',
    node_id: node,
    stream_id: session,
    seq: ++seq,
    type,
    data,
    actor,
    at: at(minutesAgo),
  })
  const u = (update: Record<string, unknown>, minutesAgo: number, run = 'sample-turn-2') =>
    e('session.update', { run_id: run, update }, minutesAgo, by)
  const events: JournalEvent[] = [
    e(
      'session.created',
      {
        session_id: session,
        title: state === 'agent' ? 'Rank exact titles first' : 'Tidy the parser',
        provider,
        ...(provider === 'acp' ? { agent: 'gemini' } : {}),
        created_at: at(40),
        settings: { permission_mode: 'manual' },
      },
      40
    ),
    e('session.process', { run_id: 'sample-process', state: 'running' }, 40),
    u(
      {
        kind: 'available_commands_update',
        commands: [
          {
            name: 'review',
            description: 'Review the working changes',
            input_hint: 'what to look at',
          },
          { name: 'explain', description: 'Explain a file or a symbol', input_hint: 'path' },
          {
            name: 'release-notes',
            description: 'Write release notes from the log',
            source: 'skill',
          },
        ],
      },
      40,
      'sample-turn-1'
    ),
    e(
      'input.accepted',
      { input_id: 'a1', text: 'Make the search rank exact title matches first.' },
      30
    ),
    e('turn.started', { run_id: 'sample-turn-2', turn_id: 'sample-turn-2', trigger: 'input' }, 30),
    u(
      {
        kind: 'agent_thought',
        message_id: 'm1',
        text: 'The ranking lives in the scorer; an exact title match should outweigh body hits.',
      },
      30
    ),
    u(
      {
        kind: 'agent_message',
        message_id: 'm1',
        text: 'I will put exact title matches first and cover it with a test.',
      },
      30
    ),
    u(
      {
        kind: 'plan',
        entries: [
          { content: 'Find where results are scored', priority: 'high', status: 'completed' },
          {
            content: 'Rank exact title matches first',
            priority: 'high',
            status: state === 'agent' ? 'completed' : 'in_progress',
          },
          {
            content: 'Add a test for the ranking',
            priority: 'medium',
            status: state === 'agent' ? 'in_progress' : 'pending',
          },
          { content: 'Run the whole test suite', priority: 'low', status: 'pending' },
        ],
      },
      29
    ),
    u(
      {
        kind: 'tool_call',
        tool_call_id: 'c1',
        title: 'Search for score(',
        tool_kind: 'search',
        status: 'completed',
        raw_input: { pattern: 'score(' },
      },
      29
    ),
    u(
      {
        kind: 'tool_call',
        tool_call_id: 'c2',
        title: 'Read src/search/rank.ts',
        tool_kind: 'read',
        status: 'completed',
        locations: [{ path: 'src/search/rank.ts' }],
      },
      28
    ),
  ]
  const diff = {
    type: 'diff',
    path: 'src/search/rank.ts',
    old_text: 'export const score = (hit: Hit) => hit.bodyMatches',
    new_text: 'export const score = (hit: Hit) =>\n  (hit.exactTitle ? 1000 : 0) + hit.bodyMatches',
  }
  if (state === 'agent') {
    events.push(
      u(
        {
          kind: 'tool_call',
          tool_call_id: 'c3',
          title: 'Edit src/search/rank.ts',
          tool_kind: 'edit',
          status: 'pending',
          locations: [{ path: 'src/search/rank.ts' }],
          content: [diff],
        },
        27
      ),
      u(
        {
          kind: 'tool_call_update',
          tool_call_id: 'c3',
          status: 'completed',
          content: [{ type: 'content', text: 'Edited src/search/rank.ts' }],
        },
        27
      ),
      u(
        {
          kind: 'tool_call',
          tool_call_id: 'c4',
          title: 'npm test -- rank',
          tool_kind: 'execute',
          status: 'failed',
          raw_input: { command: 'npm test -- rank' },
          content: [{ type: 'content', text: '1 failed: exact title ranks second' }],
        },
        26
      ),
      u(
        {
          kind: 'agent_message',
          message_id: 'm2',
          text: 'One test still puts the exact title second: the tie-break sorts by date first. Fixing that next.',
        },
        25
      ),
      u(
        {
          kind: 'tool_call',
          tool_call_id: 'c5',
          title: 'npm test',
          tool_kind: 'execute',
          status: 'in_progress',
          raw_input: { command: 'npm test' },
        },
        1
      ),
      u({ kind: 'usage_update', used_tokens: 58_000, max_tokens: 200_000 }, 1)
    )
  } else {
    events.push(
      u(
        {
          kind: 'tool_call',
          tool_call_id: 'c3',
          title: 'Edit src/search/rank.ts',
          tool_kind: 'edit',
          status: 'pending',
          locations: [{ path: 'src/search/rank.ts' }],
          content: [diff],
        },
        1
      ),
      u({ kind: 'notice', level: 'warning', text: 'Usage limit close, resets at 21:00' }, 1),
      e(
        'prompt.requested',
        {
          kind: 'permission',
          session_id: session,
          prompt_id: 'sample-agent-question',
          run_id: 'sample-turn-2',
          revision: 1,
          action_digest: 'b'.repeat(64),
          expires_at: Date.now() + 3_600_000,
          state: 'pending',
          choice: null,
          installation_id: null,
          delivered: false,
          tool_use_id: 'c3',
          tool_name: 'edit',
          input: { path: 'src/search/rank.ts' },
          title: 'Edit src/search/rank.ts',
          options: ['Allow', 'Reject'],
        },
        1
      )
    )
  }
  return events
}
