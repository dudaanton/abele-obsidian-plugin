import { ref } from 'vue'
import type { JournalEvent } from '@abele/channel-protocol'
import type { LiveSessionState } from '@abele/node-protocol'
import { ChatService } from '@/ai/ChatService'
import { NodeService, type NodeConnection } from '@/node/NodeService'

/**
 * A long-lived node session in a real chat tab on invented data, for layout probes that run no
 * node: the registered chat view, presenter and reducer, with only the connection supplied. The
 * client answers `session.state` and records what the owner's levers send, so a probe can check
 * that a press reached the node. Nothing is persisted: the registry and keys are left as found.
 */
export const NODE_SESSION_SCREENS = ['idle', 'working', 'compacting', 'asking'] as const
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

function journal(state: NodeSessionScreen): JournalEvent[] {
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
  const events = [
    e(
      'session.created',
      {
        session_id: SESSION,
        title: 'Search by words',
        provider: 'claude',
        created_at: at(90),
        settings: { permission_mode: 'bypassPermissions' },
      },
      90
    ),
    e('session.process', { state: 'running' }, 80),
    e(
      'input.accepted',
      { input_id: 'i1', text: 'Make the search find words in note titles too.' },
      80
    ),
    e('turn.started', { turn_id: 't1', trigger: 'input' }, 80),
    say('m1', 'The search reads titles now. I started the tests in the background.', 78),
    e('turn.completed', { turn_id: 't1', outcome: 'success', input_ids: ['i1'] }, 78),
    e('compaction.started', {}, 60),
    e(
      'compaction.completed',
      { result: 'success', trigger: 'manual', pre_tokens: 812_000, post_tokens: 64_000 },
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
    e('turn.completed', { turn_id: 't2', outcome: 'success', input_ids: [] }, 39),
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
    e('turn.completed', { turn_id: 't3', outcome: 'success', input_ids: ['i2'] }, 19),
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

export async function openNodeSessionFixture(state: NodeSessionScreen = 'idle', bypass = true) {
  if (!NODE_SESSION_SCREENS.includes(state)) throw new Error('Unknown node session state')
  await closeNodeSessionFixture()
  nodeSessionCalls.length = 0
  const events = journal(state)
  const store = { events: { [SESSION]: events }, results: {}, outbox: [] as unknown[] }
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
      process: state === 'idle' ? 'idle' : 'running',
      run_id: 'sample-process',
      turn: null,
      background_tasks: [],
      context: null,
      compacting: state === 'compacting',
      settings,
      process_settings: null,
      restart_pending: false,
      watchers: 1,
      idle_since: null,
    }),
    configureSession: record('session.configure'),
    compactSession: record('session.compact', { input_id: 'c', accepted_seq: 1 }),
    stopSession: record('session.stop'),
    renameSession: record('session.rename'),
    interrupt: record('session.interrupt'),
    cancelInput: record('input.cancel'),
    cursor: async () => events.length,
    flush: async () => {},
    operationResult: async () => ({ result: {} }),
    onEvent: () => () => {},
    subscribe: async () => ({}),
    request: async (method: string) => {
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
    title: 'Search by words',
  })
  await chats.revealSidebar({ focus: false })
  restore = async () => {
    for (const id of [...chats.tabOrder.value])
      if (id.startsWith(`node:${NODE}:`)) await chats.closeTab(id)
    service.nodes.value = previousNodes
    service.connection = previousConnection
  }
  return { state, ready: true }
}
