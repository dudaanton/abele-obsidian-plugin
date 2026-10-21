import { ref } from 'vue'
import type { JournalEvent } from '@abele/channel-protocol'
import type { LiveSessionState } from '@abele/node-protocol'
import { ChatService } from '@/ai/ChatService'
import { NodeService, type NodeConnection } from '@/node/NodeService'
import { NodeSuggestModal } from '@/components/nodeWork/NodeSuggestModal'
import { agentSuggestions } from '@/node/NodePathController'
import { agentChoices, nodeProviders } from '@/node/providers'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
import { GlobalStore } from '@/stores/GlobalStore'
import { agentJournal } from './nodeAgentJournal'
import type { NodeClientState } from '@/node/NodeClientStore'

/**
 * A long-lived node session in a real chat tab on invented data, for layout probes that run no
 * node: the registered chat view, presenter and reducer, with only the connection supplied. The
 * client answers `session.state` and records what the owner's levers send, so a probe can check
 * that a press reached the node. Nothing is persisted: the registry and keys are left as found.
 */
export const NODE_SESSION_SCREENS = [
  'idle',
  'working',
  'compacting',
  'asking',
  'empty',
  'long',
  'error',
  'rate-limit',
  // Another agent than Claude: pi at work on a plan, and Gemini over ACP asking before an edit.
  'agent',
  'agent-asking',
  'letter',
  'obsidian-tools',
] as const
export type NodeSessionScreen = (typeof NODE_SESSION_SCREENS)[number]

const NODE = 'sample-session-node'
const SESSION = 'sample-live-session'
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()

let restore = async () => {}
/** What the chat sent to the node while the fixture was open, in order. */
export const nodeSessionCalls: { method: string; params: unknown }[] = []

export async function closeNodeSessionFixture() {
  await restore()
  restore = async () => {}
}

/** The invented journal of each screen; exported so a unit test checks it against the node schema. */
export function journal(state: NodeSessionScreen): JournalEvent[] {
  if (state === 'agent' || state === 'agent-asking') return agentJournal(state, NODE, SESSION)
  let seq = 0
  const e = (type: string, data: Record<string, unknown>, minutesAgo: number): JournalEvent => ({
    kind: 'event',
    node_id: NODE,
    stream_id: SESSION,
    seq: ++seq,
    type,
    // The session's own record is the node's, with nothing beside it; the rest carry the process.
    data: type === 'session.created' ? data : { run_id: 'sample-process', ...data },
    actor: { kind: 'node' },
    at: at(minutesAgo),
  })
  const say = (id: string, text: string, minutesAgo: number) =>
    e(
      'claude.message.final',
      { message_id: id, role: 'assistant', content: [{ type: 'text', text }] },
      minutesAgo
    )
  const created = e(
    'session.created',
    {
      session_id: SESSION,
      title: state === 'letter' ? 'Sample node chat' : 'Search by words',
      provider: state === 'letter' ? 'fake' : 'claude',
      created_at: at(90),
      settings: { permission_mode: 'bypassPermissions' },
    },
    900
  )
  if (state === 'letter') return [created]
  if (state === 'obsidian-tools') {
    const create = {
      invocation_id: 'sample-create',
      session_id: SESSION,
      tool_name: 'create',
      arguments: { path: 'sample-note.md', content: 'A sample note created through Obsidian.' },
      preview: {
        path: 'sample-note.md',
        device: 'Sample desktop',
        diff: { old: '', new: 'A sample note created through Obsidian.' },
      },
    }
    const edit = {
      invocation_id: 'sample-edit',
      session_id: SESSION,
      tool_name: 'edit',
      arguments: {
        path: 'sample-note.md',
        old_string: 'A sample note',
        new_string: 'An updated sample note',
      },
      preview: {
        path: 'sample-note.md',
        device: 'Sample desktop',
        diff: {
          old: 'A sample note created through Obsidian.',
          new: 'An updated sample note created through Obsidian.',
        },
      },
    }
    const pending = {
      invocation_id: 'sample-pending',
      session_id: SESSION,
      tool_name: 'create',
      arguments: { path: 'another-sample.md', content: 'Text waiting for approval.' },
      preview: {
        path: 'another-sample.md',
        device: 'Sample desktop',
        content: 'Text waiting for approval.',
        diff: { old: '', new: 'Text waiting for approval.' },
      },
    }
    return [
      created,
      e(
        'input.accepted',
        { input_id: 'sample-input', text: 'Create a note and update its text.' },
        5
      ),
      e(
        'obsidian.tools.updated',
        {
          ...create,
          state: 'succeeded',
          result: {
            content: [{ type: 'text', text: 'Created: sample-note.md' }],
            details: { path: 'sample-note.md', diff: create.preview.diff },
          },
        },
        4
      ),
      e(
        'obsidian.tools.updated',
        {
          ...edit,
          state: 'succeeded',
          result: {
            content: [{ type: 'text', text: 'Edited: sample-note.md' }],
            details: { path: 'sample-note.md', diff: edit.preview.diff },
          },
        },
        3
      ),
      e('obsidian.tools.updated', { ...pending, state: 'awaiting_approval' }, 1),
      e(
        'prompt.requested',
        {
          kind: 'permission',
          prompt_id: 'sample-obsidian-prompt',
          session_id: SESSION,
          run_id: 'obsidian:sample-pending',
          revision: 1,
          action_digest: 'a'.repeat(64),
          expires_at: Number.MAX_SAFE_INTEGER,
          state: 'pending',
          choice: null,
          installation_id: null,
          delivered: false,
          tool_name: 'create',
          input: { ...pending, vault_id: 'sample-vault', revision: 'sample-revision' },
        },
        1
      ),
      e(
        'obsidian.tools.updated',
        {
          invocation_id: 'sample-delegate',
          session_id: SESSION,
          tool_name: 'delegate',
          arguments: { agent: 'Sample researcher', task: 'Read a sample reference.' },
          state: 'succeeded',
          result: { content: [{ type: 'text', text: 'The sample reference is ready.' }] },
        },
        1
      ),
      e(
        'prompt.opened',
        {
          kind: 'questionnaire',
          prompt_id: 'sample-questionnaire',
          session_id: SESSION,
          run_id: 'obsidian:sample-questions',
          revision: 1,
          action_digest: 'b'.repeat(64),
          expires_at: Number.MAX_SAFE_INTEGER,
          state: 'pending',
          choice: null,
          installation_id: null,
          delivered: false,
          input: { invocation_id: 'sample-questions', vault_id: 'sample-vault' },
          questions: [
            { question: 'Choose a sample destination', options: ['Reference', 'Draft'] },
            { question: 'Add a sample label', type: 'input', options: [] },
          ],
        },
        1
      ),
    ]
  }
  // Records as the node writes them, every field present: earlier pages are checked against
  // the node's schemas when they arrive.
  const done = (turn: string, inputs: string[], ago: number) =>
    e(
      'turn.completed',
      {
        turn_id: turn,
        outcome: 'success',
        input_ids: inputs,
        subtype: 'success',
        num_turns: 1,
        duration_ms: 1000,
        total_cost_usd: 0.01,
        terminal_reason: null,
      },
      ago
    )
  const compacted = (result: 'success' | 'failed', ago: number) =>
    e(
      'compaction.completed',
      {
        result,
        trigger: result === 'success' ? 'auto' : 'manual',
        pre_tokens: result === 'success' ? 860_000 : null,
        post_tokens: result === 'success' ? 58_000 : null,
        duration_ms: result === 'success' ? 20_000 : null,
        error: result === 'success' ? null : 'the context could not be shortened',
      },
      ago
    )
  if (state === 'empty') return [created, e('session.process', { state: 'running' }, 1)]
  if (state === 'rate-limit') {
    const events = [created, e('session.process', { state: 'running' }, 5)]
    for (let turn = 1; turn <= 3; turn++) {
      events.push(
        e('input.accepted', { input_id: `limit-${turn}`, text: `Check sample ${turn}.` }, 4 - turn),
        e('turn.started', { turn_id: `limit-turn-${turn}`, trigger: 'input' }, 4 - turn),
        e(
          'session.update',
          {
            update: {
              kind: 'notice',
              code: 'rate_limit',
              level: 'warning',
              text: 'Usage limit close, resets 2025-01-01T18:00:00.000Z',
            },
          },
          4 - turn
        ),
        say(`limit-reply-${turn}`, `Sample ${turn} checked.`, 4 - turn),
        done(`limit-turn-${turn}`, [`limit-${turn}`], 4 - turn)
      )
    }
    return events
  }
  if (state === 'long' || state === 'error') {
    // A long session: days of turns, each a question, a run of calls with output and an answer;
    // this device holds only the latest window, the node gives earlier pages as asked.
    const long = [created, e('session.process', { state: 'running' }, 899)]
    for (let t = 1; t <= 120; t++) {
      const ago = 899 - t * 7
      long.push(
        e(
          'input.accepted',
          { input_id: `l${t}`, text: `Question ${t}: check the parser on case ${t}.` },
          ago
        ),
        e('turn.started', { turn_id: `lt${t}`, trigger: 'input' }, ago),
        e(
          'claude.tool.call',
          { tool_use_id: `lc${t}`, name: 'Bash', input: { command: `npm test -- case-${t}` } },
          ago
        ),
        e(
          'claude.tool.result',
          { tool_use_id: `lc${t}`, content: `case-${t}: 14 passed\nDone in ${t % 9}.2s` },
          ago
        ),
        say(`la${t}`, `Answer ${t}. Case ${t} parses as expected; the tests pass.`, ago),
        done(`lt${t}`, [`l${t}`], ago)
      )
      if (t % 40 === 0) long.push(compacted('success', ago))
    }
    if (state === 'error') long.push(e('compaction.started', {}, 2), compacted('failed', 1))
    return long
  }
  const events = [
    created,
    e('session.process', { state: 'running' }, 80),
    e(
      'input.accepted',
      { input_id: 'i1', text: 'Make the search find words in note titles too.' },
      80
    ),
    e('turn.started', { turn_id: 't1', trigger: 'input' }, 80),
    say('m1', 'The search reads titles now. I started the tests in the background.', 78),
    done('t1', ['i1'], 78),
    e('compaction.started', {}, 60),
    e(
      'compaction.completed',
      {
        result: 'success',
        trigger: 'manual',
        pre_tokens: 812_000,
        post_tokens: 64_000,
        duration_ms: 20_000,
        error: null,
      },
      59
    ),
    e(
      'compaction.summary',
      { text: 'The search now matches note titles. The tests were started and are still running.' },
      59
    ),
    e(
      'claude.task',
      { subtype: 'task_notification', task_id: 'k0', summary: 'npm test finished · 12 passed' },
      40
    ),
    e('turn.started', { turn_id: 't2', trigger: 'task' }, 40),
    say('m2', 'All twelve tests passed.', 39),
    done('t2', [], 39),
    e(
      'input.accepted',
      {
        input_id: 'i2',
        text: 'The review found one thing: titles with dashes are not matched.',
        from_session: { session_id: 'sample-review-session', title: 'Review the search diff' },
      },
      20
    ),
    e('turn.started', { turn_id: 't3', trigger: 'command' }, 20),
    say('m3', 'Fixed: dashes in titles are matched as spaces.', 19),
    done('t3', ['i2'], 19),
    e(
      'session.context',
      {
        total_tokens: state === 'working' ? 862_000 : 412_000,
        max_tokens: 1_000_000,
        percentage: null,
        auto_compact_threshold: null,
        auto_compact_enabled: true,
        model: 'opus',
        categories: [],
      },
      19
    ),
  ]
  if (state === 'working' || state === 'compacting' || state === 'asking') {
    events.push(
      e(
        'input.accepted',
        { input_id: 'i3', text: 'Now make it rank exact title matches first.' },
        6
      ),
      e('turn.started', { turn_id: 't4', trigger: 'input' }, 6),
      e('input.delivered', { input_id: 'i3', state: 'delivered' }, 6)
    )
    events.push(
      e(
        'session.tasks',
        {
          tasks: [
            { task_id: 'k1', task_type: 'local_bash', description: 'npm test -- --watch' },
            {
              task_id: 'k2',
              task_type: 'local_agent',
              description: 'Check the ranking on a big vault',
            },
            { task_id: 'k3', task_type: 'monitor_mcp', description: 'Watch the build log' },
          ],
        },
        5
      )
    )
  }
  if (state === 'compacting') events.push(e('compaction.started', {}, 1))
  if (state === 'asking')
    events.push(
      e(
        'prompt.requested',
        {
          kind: 'permission',
          session_id: SESSION,
          prompt_id: 'sample-question',
          run_id: 'sample-process',
          revision: 1,
          action_digest: 'a'.repeat(64),
          expires_at: Date.now() + 3_600_000,
          state: 'pending',
          choice: null,
          installation_id: null,
          delivered: false,
          tool_name: 'Bash',
          input: { command: 'git push' },
          title: 'Run git push',
        },
        1
      )
    )
  return events
}

export async function openNodeSessionFixture(
  state: NodeSessionScreen = 'idle',
  bypass = true,
  reveal = true
) {
  if (!NODE_SESSION_SCREENS.includes(state)) throw new Error('Unknown node session state')
  await closeNodeSessionFixture()
  nodeSessionCalls.length = 0
  const full = journal(state)
  const agent = state === 'agent' || state === 'agent-asking'
  const head = full.length
  /** What this device holds: a long session's latest window, all of a short one. */
  const events = state === 'long' || state === 'error' ? full.slice(-400) : full
  const store: NodeClientState = {
    events: { [SESSION]: events },
    cursors: { [SESSION]: head },
    results: {},
    outbox: [],
  }
  const record =
    (method: string, answer: unknown = {}) =>
    async (...params: unknown[]) => {
      nodeSessionCalls.push({ method, params })
      return answer
    }
  const settings = {
    model: 'opus',
    effort: 'high',
    account: 'default',
    permission_mode: bypass ? 'bypassPermissions' : 'acceptEdits',
    continue_after_compaction: true,
    continuation_text: 'Continue from where you stopped.',
    messaging: true,
  }
  const client = {
    connected: true,
    target: { expected_node_id: NODE },
    describe: async () => ({
      capabilities: { capabilities: {} },
      providers: [
        ...AGENT_PROVIDERS,
        {
          provider: 'claude',
          available: true,
          configuration: {
            profile: 'inherited',
            live_sessions: true,
            accounts: ['default', 'second'],
            efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
            permission_modes: [
              'manual',
              'acceptEdits',
              'auto',
              'plan',
              'dontAsk',
              ...(bypass ? ['bypassPermissions'] : []),
            ],
          },
          capabilities: {},
        },
      ],
    }),
    sessionState: async (): Promise<LiveSessionState> => ({
      session_id: SESSION,
      live: true,
      process: ['idle', 'long', 'error', 'empty', 'letter'].includes(state) ? 'idle' : 'running',
      // The agent screens are mid-turn.
      run_id: 'sample-process',
      turn: null,
      background_tasks: [],
      context: null,
      compacting: state === 'compacting',
      settings: agent ? { ...settings, model: 'default', permission_mode: 'manual' } : settings,
      process_settings: null,
      restart_pending: false,
      watchers: 1,
      idle_since: null,
    }),
    sessionCommands: async () => {
      const latest = [...full]
        .reverse()
        .find(
          (x) =>
            x.type === 'session.update' &&
            (x.data as { update?: { kind?: string } }).update?.kind === 'available_commands_update'
        )
      return {
        session_id: SESSION,
        seq: latest?.seq ?? 0,
        commands:
          (latest?.data as { update?: { commands?: unknown[] } } | undefined)?.update?.commands ??
          [],
      }
    },
    configureSession: record('session.configure'),
    compactSession: record('session.compact', { input_id: 'c', accepted_seq: 1 }),
    stopSession: record('session.stop'),
    renameSession: record('session.rename'),
    interrupt: record('session.interrupt'),
    cancelInput: record('input.cancel'),
    cursor: async () => head,
    head: async () => head,
    getSession: async () => full[0].data,
    flush: async () => {
      if (state !== 'letter') return
      for (const entry of store.outbox.splice(0)) {
        if (entry.method !== 'session.send') throw new Error('Unexpected letter fixture operation')
        nodeSessionCalls.push({ method: entry.method, params: entry.params })
        const inputId = `sample-letter-${entry.operation_id}`
        const turnId = `sample-turn-${entry.operation_id}`
        const append = (type: string, data: Record<string, unknown>) => {
          const event: JournalEvent = {
            kind: 'event',
            node_id: NODE,
            stream_id: SESSION,
            seq: full.length + 1,
            type,
            data: { run_id: 'sample-process', ...data },
            actor: { kind: 'node' },
            at: new Date().toISOString(),
          }
          full.push(event)
          if (events !== full) events.push(event)
          store.cursors[SESSION] = event.seq
        }
        append('input.accepted', {
          input_id: inputId,
          text: (entry.params as { text: string }).text,
        })
        append('turn.started', { turn_id: turnId, trigger: 'input' })
        append('claude.message.final', {
          message_id: `sample-answer-${entry.operation_id}`,
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'The sample node checked the request. This answer belongs only to the sending chat.',
            },
          ],
        })
        append('turn.completed', {
          turn_id: turnId,
          outcome: 'success',
          input_ids: [inputId],
          subtype: 'success',
          num_turns: 1,
          duration_ms: 10,
          total_cost_usd: 0,
          terminal_reason: null,
        })
        store.results[entry.operation_id] = {
          result: { input_id: inputId, accepted_seq: full.length - 3 },
        }
      }
    },
    operationResult: async (id: string) => store.results[id] ?? { result: {} },
    onEvent: () => () => {},
    subscribe: async () => ({}),
    answerQuestionnaire: async (prompt: { prompt_id: string }, answers: unknown) => {
      nodeSessionCalls.push({ method: 'questionnaire.answer', params: { prompt, answers } })
      const event = full.find(
        (event) => (event.data as { prompt_id?: string }).prompt_id === prompt.prompt_id
      )
      if (!event) throw new Error('Unknown sample questionnaire')
      event.data = {
        ...(event.data as object),
        state: 'resolved',
        choice: answers === null ? 'deny' : 'allow',
        answers,
      }
      return event.data
    },
    request: async (method: string, params?: { after_seq?: number; limit?: number }) => {
      if (method === 'obsidian.tools.v1.delegate.get')
        return {
          runs: [{ run_id: 'sample-host-run' }],
          branches: [{ branch_id: 'sample-host-branch', item: 'Sample reference', state: 'done' }],
        }
      if (method === 'obsidian.tools.v1.delegate.history')
        return {
          entries: [
            {
              seq: 1,
              message: {
                id: 'sample-host-answer',
                version: 1,
                part: 0,
                parts: 1,
                text: JSON.stringify({
                  id: 'sample-host-answer',
                  role: 'assistant',
                  timestamp: 1,
                  content: 'A retained sample answer from the delegated agent.',
                }),
              },
            },
          ],
          next_seq: 1,
          has_more: false,
        }
      if (method === 'stream.read') {
        nodeSessionCalls.push({ method, params: [params] })
        // The node cannot be reached for earlier pages in the error state.
        if (state === 'error') throw new Error('The node did not answer in time')
        const after = params?.after_seq ?? 0
        return full.filter((x) => x.seq > after).slice(0, params?.limit ?? 256)
      }
      throw new Error('Unsupported fixture call: ' + method)
    },
    store: { transaction: async (fn: (state: unknown) => unknown) => fn(store) },
  }
  const connection = {
    client,
    state: ref('connected'),
    error: ref(''),
    authorizationGeneration: 0,
    delegationCards: ref({}),
    connect: async () => {},
    start: () => {},
    destroy: () => {},
    refreshDelegations: async () => {},
  } as unknown as NodeConnection
  const service = NodeService.getInstance(),
    previousNodes = service.nodes.value,
    previousConnection = service.connection
  service.nodes.value = [
    ...previousNodes,
    { id: NODE, expectedNodeId: NODE, label: 'Sample node', url: 'http://127.0.0.1:1' },
  ]
  service.connection = (id) => (id === NODE ? connection : previousConnection.call(service, id))
  const chats = ChatService.getInstance()
  await chats.openNodeSession({
    kind: 'node-session',
    nodeId: NODE,
    registrationId: NODE,
    sessionId: SESSION,
    title: String((full[0].data as { title?: unknown }).title ?? 'Search by words'),
  })
  if (reveal) await chats.revealSidebar({ focus: false })
  restore = async () => {
    for (const id of [...chats.tabOrder.value])
      if (id.startsWith(`node:${NODE}:`)) await chats.closeTab(id)
    service.nodes.value = previousNodes
    service.connection = previousConnection
  }
  return { state, ready: true }
}

/** What the invented node runs besides Claude Code: pi, and two agents over ACP, one missing. */
const AGENT_PROVIDERS = [
  {
    provider: 'pi',
    available: true,
    configuration: { live_sessions: true, permission_modes: ['manual', 'bypassPermissions'] },
    capabilities: {},
  },
  {
    provider: 'acp',
    available: true,
    permission_modes: ['manual', 'bypassPermissions'],
    agents: [
      { id: 'gemini', name: 'Gemini CLI', available: true, diagnostic: null },
      { id: 'opencode', name: 'OpenCode', available: false, diagnostic: 'acp_agent_not_installed' },
    ],
    capabilities: {},
  },
]

let picker: NodeSuggestModal | undefined
/** The agent chooser of a new node chat, on the invented node's agents; nothing is created. */
export function openAgentPickerFixture(): { rows: number } {
  picker?.close()
  const items = agentSuggestions(
    agentChoices(
      nodeProviders({
        providers: [{ provider: 'claude', available: true, capabilities: {} }, ...AGENT_PROVIDERS],
      })
    )
  )
  picker = new NodeSuggestModal(GlobalStore.getInstance().app, items, 'Choose the agent', () => {})
  picker.open()
  return { rows: items.length }
}
export function closeAgentPickerFixture(): void {
  picker?.close()
  picker = undefined
}

let regularTab: string | undefined
/**
 * A regular chat holding the same conversation as the pi screen, for a side-by-side look: the
 * node chat's messages put into a new local tab, never saved.
 */
export async function openRegularChatFixture(): Promise<string> {
  await closeRegularChatFixture()
  const chats = ChatService.getInstance()
  const id = (regularTab = chats.createTab())
  const session = chats.getSession(id)
  if (!session) throw new Error('No room for another chat tab')
  const messages = reduceTranscript(agentJournal('agent', NODE, SESSION)).messages
  session.messages.value = messages
  session.allMessages.value = messages
  await chats.revealSidebar({ focus: false })
  return id
}
export async function closeRegularChatFixture(): Promise<void> {
  if (regularTab) await ChatService.getInstance().closeTab(regularTab)
  regularTab = undefined
}
