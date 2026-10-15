import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import {
  chooseNodePathChat,
  createNodePathObsidianActions,
  revokeNodePathChatApprovals,
} from '@/node/NodePathObsidianActions'
const f = vi.hoisted(() => ({
  picker: undefined as any,
  items: [] as any[],
  sessions: [] as any[],
  revoke: vi.fn(),
}))
vi.mock('@/components/nodeWork/NodeSuggestModal', () => ({
  NodeSuggestModal: class {
    constructor(
      _app: unknown,
      items: any[],
      _placeholder: string,
      readonly choose: (item: { id: string }) => void
    ) {
      f.picker = this
      f.items = items
    }
    open() {}
    onClose() {}
  },
}))
vi.mock('@/ai/ChatService', () => ({
  ChatService: { getInstance: () => ({ getAllSessions: () => f.sessions }) },
}))
vi.mock('@/stores/GlobalStore', () => ({ GlobalStore: { getInstance: () => ({ app: {} }) } }))
vi.mock('@/ai/tools/node/owner', () => ({
  revokeObsidianNodeScopeApprovals: f.revoke,
  giveObsidianChatAccess: vi.fn(),
  nodeAgentHost: async () => ({
    nodes: () => [{ id: 'sample-registration', node_id: 'sample-node', label: 'Sample node' }],
    nodeId: (id: string) => (id === 'sample-registration' ? 'sample-node' : id),
    connection: () => ({ client: { connected: false } }),
  }),
}))

describe('node row scope integration', () => {
  it('retains the explicit chosen chat when the native prompt closes before delivering its choice', async () => {
    const session = { id: 'sample-chat', chatTitle: ref('Sample chat') }
    f.sessions = [session]
    const pending = chooseNodePathChat()
    await vi.waitFor(() => expect(f.picker).toBeDefined())
    f.picker.onClose()
    f.picker.choose({ id: session.id })
    expect(await pending).toBe(session)
  })
  it('uses the public scope revoker, not a prompt or a metadata-only removal', async () => {
    await revokeNodePathChatApprovals('sample-node')
    expect(f.revoke).toHaveBeenCalledWith('sample-node')
  })
  it('marks a chat that already reaches the place, its access kept under the node’s own id', async () => {
    const session = {
      id: 'sample-chat',
      chatTitle: ref('Sample chat'),
      overrides: ref({
        nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'edit' }],
      }),
    }
    f.sessions = [session]
    f.picker = undefined
    void createNodePathObsidianActions().grant({
      target: {
        registrationId: 'sample-registration',
        nodeId: 'sample-node',
        projectId: 'sample-project',
        kind: 'worktree',
        id: 'sample-tree',
      },
    } as never)
    await vi.waitFor(() => expect(f.picker).toBeDefined())
    expect(f.items[0].kind).toMatch(/^Already has access to /)
  })
})
