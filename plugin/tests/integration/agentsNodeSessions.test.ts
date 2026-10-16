import 'fake-indexeddb/auto'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import AgentsListDialog from '@/components/AgentsListDialog.vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentsService } from '@/agents/AgentsService'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { CommentService } from '@/ai/CommentService'
import { NodeService } from '@/node/NodeService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useAttentionVault as useVault } from '../helpers/attentionVault'

const NODE = { id: 'sample-registration', expectedNodeId: 'sample-node', label: 'Sample node' }
const session = (id: string, title = `Sample ${id}`) => ({
  session_id: id,
  title,
  created_at: '2026-01-01T00:00:00.000Z',
  provider: 'claude' as const,
})
const idle = (id: string) => ({
  session_id: id,
  live: false,
  process: 'none',
  turn: null,
  compacting: false,
})
const working = (id: string) => ({
  session_id: id,
  live: true,
  process: 'running',
  turn: { turn_id: `turn-${id}`, started_at: '2026-01-01T10:00:00.000Z', trigger: 'message' },
  compacting: false,
})
const permission = (id: string) => ({
  kind: 'permission',
  prompt_id: `prompt-${id}`,
  session_id: id,
  state: 'pending',
  tool_name: 'Bash',
})

function fakeConnection(client: Record<string, unknown>, state = 'connected') {
  const connection = { state: ref(state), error: ref(''), connect: vi.fn(), client }
  vi.spyOn(NodeService.prototype, 'connection').mockReturnValue(connection as never)
  return connection
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

beforeEach(() => {
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  CommentService.getInstance().destroy()
  ChatService.getInstance().destroy()
  AgentsService.destroyCurrent()
  NodeService.getInstance().destroy()
  ChatStorage.destroy()
})

describe("a node's sessions in the agents list", () => {
  it('publishes an input turn arriving after the initial idle catalogue read', async () => {
    useVault([])
    let busy = false
    let event: ((event: { type: string; stream_id: string }) => void) | undefined
    fakeConnection({
      onEvent: vi.fn((listener: (event: { type: string; stream_id: string }) => void) => {
        event = listener
        return vi.fn()
      }),
      listSessions: vi.fn(async (after?: string) =>
        after
          ? []
          : [
              {
                ...session('busy'),
                workspace_id: 'sample-workspace',
                native_session_id: '11111111-1111-4111-8111-111111111111',
              },
            ]
      ),
      sessionState: vi.fn(async (id: string) =>
        busy
          ? {
              ...working(id),
              run_id: 'sample-run',
              turn: {
                turn_id: 'sample-turn',
                trigger: 'input',
                started_at: '2026-01-01T10:00:00.000Z',
              },
              background_tasks: [],
              context: null,
              watchers: 1,
              idle_since: null,
              restart_pending: false,
              settings: {
                model: 'sample-model',
                effort: 'high',
                account: 'default',
                permission_mode: 'manual',
                continue_after_compaction: true,
                continuation_text: 'Continue',
                messaging: true,
              },
              process_settings: {
                model: 'sample-model',
                effort: 'high',
                account: 'default',
                permission_mode: 'manual',
              },
            }
          : idle(id)
      ),
      prompts: vi.fn(async () => []),
    })
    const agents = AgentsService.getInstance()
    agents.setNodes([NODE])
    await agents.start()
    await settle()
    expect(agents.rows.value).toEqual([])
    busy = true
    event?.({ type: 'turn.started', stream_id: 'busy' })
    await settle()
    expect(agents.rows.value).toHaveLength(1)
    expect(agents.rows.value[0]).toMatchObject({
      title: 'Sample busy',
      reasons: [{ kind: 'running', id: 'sample-turn' }],
    })
  })

  it('refreshes a previously idle node when the real agents dialog opens', async () => {
    useVault([])
    let busy = false
    fakeConnection({
      listSessions: vi.fn(async (after?: string) => (after ? [] : [session('busy')])),
      sessionState: vi.fn(async (id: string) => (busy ? working(id) : idle(id))),
      prompts: vi.fn(async () => []),
    })
    const agents = AgentsService.getInstance()
    agents.setNodes([NODE])
    await agents.start()
    await settle()
    expect(agents.rows.value).toEqual([])
    busy = true
    const wrapper = mount(AgentsListDialog, { attachTo: document.body })
    try {
      await flushPromises()
      expect(document.querySelector('.abele-agents')?.textContent).toContain('Sample busy')
      expect(document.querySelector('.abele-agents')?.textContent).toContain('Working')
    } finally {
      wrapper.unmount()
    }
  })

  it('lists what a connected node is doing instead of calling it offline', async () => {
    useVault([])
    fakeConnection({
      listSessions: vi.fn(async (after?: string) =>
        after ? [] : [session('busy'), session('asking'), session('quiet')]
      ),
      sessionState: vi.fn(async (id: string) => (id === 'quiet' ? idle(id) : working(id))),
      prompts: vi.fn(async (id: string, after?: string) =>
        id === 'asking' && !after ? [permission(id)] : []
      ),
    })
    const agents = AgentsService.getInstance()
    agents.setNodes([NODE])
    await agents.start()
    await settle()
    const rows = agents.rows.value
    expect(rows.map((r) => r.title).sort()).toEqual(['Sample asking', 'Sample busy'])
    expect(rows.some((r) => r.offline)).toBe(false)
    expect(rows.find((r) => r.title === 'Sample busy')?.reasons[0].kind).toBe('running')
    expect(rows.find((r) => r.title === 'Sample asking')?.reasons[0]).toMatchObject({
      kind: 'approval',
      text: 'Bash',
    })
    expect(rows.find((r) => r.title === 'Sample busy')?.reference).toEqual({
      kind: 'node',
      registrationId: NODE.id,
      nodeId: NODE.expectedNodeId,
      sessionId: 'busy',
    })
    expect(agents.incomplete.value).toBe(false)
  })

  it('keeps the readable sessions when one of them cannot be read', async () => {
    useVault([])
    fakeConnection({
      listSessions: vi.fn(async (after?: string) =>
        after ? [] : [session('broken'), session('busy')]
      ),
      sessionState: vi.fn(async (id: string) => {
        if (id === 'broken') throw new Error('invalid_result')
        return working(id)
      }),
      prompts: vi.fn(async () => []),
    })
    const agents = AgentsService.getInstance()
    agents.setNodes([NODE])
    await agents.start()
    await settle()
    expect(agents.rows.value.map((r) => r.title).sort()).toEqual(['Sample busy', 'Sample node'])
    const node = agents.rows.value.find((r) => r.title === 'Sample node')!
    expect(node.offline).toBeFalsy()
    expect(node.reasons[0].text).toBe('1 session could not be read')
    expect(agents.incomplete.value).toBe(true)
  })

  it('says a connected node could not be listed without calling it offline', async () => {
    useVault([])
    fakeConnection({
      listSessions: vi.fn().mockRejectedValue(new Error('invalid_result')),
      sessionState: vi.fn(),
      prompts: vi.fn(),
    })
    const agents = AgentsService.getInstance()
    agents.setNodes([NODE])
    await agents.start()
    await settle()
    expect(agents.rows.value).toHaveLength(1)
    expect(agents.rows.value[0].offline).toBeFalsy()
    expect(agents.rows.value[0].reasons[0].text).toBe("Can't load this node's sessions right now")
  })

  it('calls a node offline only while its connection is down, and lists it once it connects', async () => {
    useVault([])
    const connection = fakeConnection(
      {
        listSessions: vi.fn(async (after?: string) => (after ? [] : [session('busy')])),
        sessionState: vi.fn(async (id: string) => working(id)),
        prompts: vi.fn(async () => []),
      },
      'offline'
    )
    const agents = AgentsService.getInstance()
    agents.setNodes([NODE])
    await agents.start()
    await settle()
    expect(agents.rows.value).toHaveLength(1)
    expect(agents.rows.value[0]).toMatchObject({ offline: true, title: 'Sample node' })
    connection.state.value = 'connected'
    await settle()
    expect(agents.rows.value.map((r) => r.title)).toEqual(['Sample busy'])
  })

  it('reads later pages of pending prompts as well as sessions', async () => {
    useVault([])
    const prompts = vi.fn(async (_id: string, after?: string) =>
      after === 'prompt-second' ? [] : [permission(after ? 'second' : 'first')]
    )
    fakeConnection({
      listSessions: vi.fn(async (after?: string) => (after ? [] : [session('busy')])),
      sessionState: vi.fn(async (id: string) => working(id)),
      prompts,
    })
    const agents = AgentsService.getInstance()
    agents.setNodes([NODE])
    await agents.start()
    await settle()
    expect(
      agents.rows.value[0].reasons.filter((r) => r.kind === 'approval').map((r) => r.id)
    ).toEqual(['prompt-first', 'prompt-second'])
    expect(prompts).toHaveBeenLastCalledWith('busy', 'prompt-second', 'pending')
  })

  it('opens a node session row in its chat tab', async () => {
    useVault([])
    fakeConnection({
      listSessions: vi.fn(async (after?: string) => (after ? [] : [session('busy')])),
      sessionState: vi.fn(async (id: string) => working(id)),
      prompts: vi.fn(async () => []),
    })
    const chats = ChatService.getInstance()
    const open = vi.spyOn(chats, 'openNodeSession').mockResolvedValue(undefined)
    vi.spyOn(chats, 'revealSidebar').mockResolvedValue(undefined)
    const agents = AgentsService.getInstance()
    agents.setNodes([NODE])
    await agents.start()
    await settle()
    const row = agents.rows.value[0]
    expect(await agents.open(row, row.reasons[0])).toBe(true)
    expect(open).toHaveBeenCalledWith({
      kind: 'node-session',
      nodeId: NODE.expectedNodeId,
      registrationId: NODE.id,
      sessionId: 'busy',
      title: 'Sample busy',
    })
  })
})
