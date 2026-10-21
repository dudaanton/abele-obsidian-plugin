/**
 * Every agent's chat read from the one transcript vocabulary the node writes (`session.update`,
 * modelled on ACP): what an ACP, Codex or pi session says draws the same way as Claude's, a
 * record the node mapped is never drawn twice, and the agents a new session can run are listed
 * whether this node can start them or not.
 */
import { describe, expect, it } from 'vitest'
import type { JournalEvent } from '@abele/channel-protocol'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
import { agentChoices, nodeProviders } from '@/node/providers'
import { toolSummary } from '@/ai/toolLine'

const at = '2025-01-01T00:00:00.000Z'
const acp = { kind: 'provider', provider: 'acp', session_id: 'session' } as const
const event = (
  seq: number,
  type: string,
  data: unknown,
  actor: JournalEvent['actor'] = acp
): JournalEvent => ({
  kind: 'event',
  node_id: 'sample',
  stream_id: 'session',
  seq,
  type,
  data,
  actor,
  at,
})
const update = (seq: number, u: Record<string, unknown>, run = 'turn-1') =>
  event(seq, 'session.update', { run_id: run, update: u })

it('omits clean diagnostics while retaining diagnostic problems', () => {
  const p = reduceTranscript([
    update(1, { kind: 'notice', level: 'info', text: 'Diagnostics for sample.ts: no problems' }),
    update(2, {
      kind: 'notice',
      level: 'warning',
      text: 'Diagnostics for sample.ts: Missing type',
    }),
  ])
  expect(p.messages.map((m) => m.content)).toEqual(['Diagnostics for sample.ts: Missing type'])
})

it('clears historical failure attention after a later input completes successfully', () => {
  const p = reduceTranscript([
    event(1, 'input.accepted', { input_id: 'first', text: 'First' }),
    event(2, 'input.failed', { input_id: 'first' }),
    event(3, 'input.accepted', { input_id: 'second', text: 'Second' }),
    event(4, 'input.completed', { input_id: 'second' }),
  ])
  expect(p.state).toBe('idle')
})

describe('an agent speaking session updates', () => {
  const journal = [
    event(1, 'turn.started', { run_id: 'turn-1' }, { kind: 'node' }),
    update(2, { kind: 'agent_thought_chunk', message_id: 'm1', text: 'Looking at the ' }),
    update(3, { kind: 'agent_thought_chunk', message_id: 'm1', text: 'sample file' }),
    update(4, { kind: 'agent_message_chunk', message_id: 'm1', text: 'I will ' }),
    update(5, { kind: 'agent_message_chunk', message_id: 'm1', text: 'edit it.' }),
    update(6, {
      kind: 'plan',
      entries: [
        { content: 'Read the sample', priority: 'high', status: 'completed' },
        { content: 'Change the greeting', priority: 'medium', status: 'in_progress' },
      ],
    }),
    update(7, {
      kind: 'tool_call',
      tool_call_id: 'call-1',
      title: 'Edit sample.txt',
      tool_kind: 'edit',
      status: 'pending',
      locations: [{ path: 'sample.txt' }],
      content: [{ type: 'diff', path: 'sample.txt', old_text: 'hello', new_text: 'hi' }],
    }),
    update(8, { kind: 'tool_call_update', tool_call_id: 'call-1', status: 'in_progress' }),
    update(9, {
      kind: 'tool_call_update',
      tool_call_id: 'call-1',
      status: 'completed',
      content: [{ type: 'content', text: 'Wrote 1 line' }],
    }),
    update(10, {
      kind: 'tool_call',
      tool_call_id: 'call-2',
      title: 'npm test',
      tool_kind: 'execute',
      status: 'failed',
      content: [{ type: 'content', text: 'Exit 1' }],
    }),
    update(11, { kind: 'notice', level: 'warning', text: 'Rate limit close' }),
    update(12, { kind: 'usage_update', used_tokens: 41_000, max_tokens: 100_000 }),
    update(13, {
      kind: 'available_commands_update',
      commands: [{ name: 'review', description: 'Review the changes', input_hint: 'branch' }],
    }),
    update(14, { kind: 'agent_message', message_id: 'm1', text: 'I will edit it now.' }),
    update(15, { kind: 'agent_message_chunk', message_id: 'm1', text: ' late' }),
    event(16, 'turn.completed', { run_id: 'turn-1', outcome: 'success' }, { kind: 'node' }),
  ]

  it('draws its words, reasoning, plan, calls with their change, notices and context', () => {
    const p = reduceTranscript(journal)
    const answer = p.messages.find((m) => m.role === 'assistant')!
    // The whole message replaces what streamed; a chunk after it changes nothing.
    expect(answer.content).toBe('I will edit it now.')
    expect(answer.thinking).toBe('Looking at the sample file')
    expect(p.messages.find((m) => m.sessionPlan)?.sessionPlan?.map((e) => e.status)).toEqual([
      'completed',
      'in_progress',
    ])
    const [edit, run] = p.messages.filter((m) => m.role === 'tool-call')
    expect(edit).toMatchObject({
      toolName: 'Edit',
      toolTitle: 'Edit sample.txt',
      toolPath: 'sample.txt',
      toolStatus: 'approved',
      toolResult: 'Wrote 1 line',
      toolDiff: { old: 'hello', new: 'hi' },
    })
    expect(toolSummary(edit)).toBe('sample.txt')
    expect(run).toMatchObject({ toolName: 'Run', toolStatus: 'rejected', toolResult: 'Exit 1' })
    expect(run.toolDiff).toBeUndefined()
    expect(p.messages.find((m) => m.sessionMark?.kind === 'notice')).toMatchObject({
      sessionMark: { kind: 'notice', level: 'warning', text: 'Rate limit close' },
    })
    expect(p.live.context).toEqual({ used: 41_000, limit: 100_000 })
    expect(p.agent.commands?.list.map((c) => c.name)).toEqual(['review'])
    expect(p.state).toBe('idle')
    expect(p.unknown).toEqual([])
  })

  it('shows a change only once it was made, and a running call as running', () => {
    const p = reduceTranscript(journal.slice(0, 8))
    const edit = p.messages.find((m) => m.role === 'tool-call')!
    expect(edit.toolDiff).toBeUndefined()
    expect(edit.toolResult).toBeUndefined()
    expect(p.state).toBe('running')
  })

  it('marks the call a question waits on, and shows the question what it would change', () => {
    const prompt = {
      kind: 'permission',
      prompt_id: 'q1',
      session_id: 'session',
      run_id: 'turn-1',
      revision: 1,
      action_digest: 'a'.repeat(64),
      expires_at: Date.now() + 60_000,
      state: 'pending',
      choice: null,
      installation_id: null,
      delivered: false,
      tool_use_id: 'call-1',
      tool_name: 'edit',
      title: 'Edit sample.txt',
      options: ['Allow', 'Reject'],
      input: {},
    }
    const p = reduceTranscript([
      ...journal.slice(0, 7),
      event(8, 'prompt.opened', prompt, { kind: 'node' }),
    ])
    expect(p.messages.find((m) => m.role === 'tool-call')?.toolStatus).toBe('pending')
    expect(p.promptDiffs.q1).toEqual([{ path: 'sample.txt', old: 'hello', new: 'hi' }])
    expect(p.state).toBe('needs-attention')
  })

  it('says on the call itself that the session mode allowed it, not as a line of its own', () => {
    const p = reduceTranscript([
      ...journal.slice(0, 7),
      event(8, 'acp.permission', {
        run_id: 'turn-1',
        tool_call_id: 'call-1',
        title: 'Edit sample.txt',
        decision: 'allowed',
        by: 'session_mode',
      }),
    ])
    expect(p.messages.find((m) => m.role === 'tool-call')?.content).toBe(
      'Allowed by the session mode'
    )
    expect(p.messages.some((m) => m.sessionMark?.kind === 'notice')).toBe(false)
  })

  it('keeps a kind from a newer node in the details, never drawn', () => {
    const p = reduceTranscript([update(1, { kind: 'hologram', text: 'Sample' })])
    expect(p.messages).toEqual([])
    expect(p.unknown).toHaveLength(1)
  })

  it('draws a compaction the agent reports once, with what it kept', () => {
    const p = reduceTranscript([
      update(1, { kind: 'compaction_update', state: 'started' }),
      update(2, { kind: 'compaction_update', state: 'completed', pre_tokens: 9000 }),
      event(
        3,
        'compaction.completed',
        { result: 'success', pre_tokens: 9000, post_tokens: 1000 },
        {
          kind: 'node',
        }
      ),
      update(4, { kind: 'compaction_summary', text: 'Sample retelling' }),
    ])
    const lines = p.messages.filter((m) => m.sessionMark)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      sessionMark: { kind: 'compacted', before: 9000, after: 1000 },
      content: 'Sample retelling',
    })
  })
})

describe('a record the node mapped', () => {
  it('is read through its update only, so nothing is drawn twice', () => {
    const claude = { kind: 'provider', provider: 'claude', session_id: 'session' } as const
    const p = reduceTranscript([
      event(
        1,
        'claude.message.final',
        {
          run_id: 'r',
          message_id: 'm',
          role: 'assistant',
          content: [{ type: 'text', text: 'Sample answer' }],
          mapped: true,
        },
        claude
      ),
      event(
        2,
        'session.update',
        {
          run_id: 'r',
          update: { kind: 'agent_message', message_id: 'm', block: 0, text: 'Sample answer' },
        },
        claude
      ),
    ])
    expect(p.messages.map((m) => m.content)).toEqual(['Sample answer'])
    expect(p.unknown).toEqual([])
  })
})

describe('the agents a new session can run', () => {
  it('lists Claude Code, Codex and pi first, then the ACP agents, unavailable ones with why', () => {
    const providers = nodeProviders({
      providers: [
        { provider: 'fake', available: false, capabilities: {} },
        { provider: 'claude', available: true, capabilities: {} },
        { provider: 'pi', available: false, diagnostic: 'pi_sdk_missing', capabilities: {} },
        {
          provider: 'acp',
          available: true,
          agents: [
            {
              id: 'gemini',
              name: 'Gemini CLI',
              available: false,
              diagnostic: 'acp_agent_not_installed',
            },
            { id: 'opencode', name: 'OpenCode', available: true, diagnostic: null },
          ],
          capabilities: {},
        },
      ],
    })
    expect(agentChoices(providers)).toEqual([
      { provider: 'claude', label: 'Claude Code', unavailable: '' },
      { provider: 'codex', label: 'Codex', unavailable: 'This node does not offer it yet' },
      { provider: 'pi', label: 'pi', unavailable: 'pi sdk missing' },
      {
        provider: 'acp',
        agent: 'gemini',
        label: 'Gemini CLI',
        unavailable: 'Not installed on the node',
      },
      { provider: 'acp', agent: 'opencode', label: 'OpenCode', unavailable: '' },
    ])
  })
})
