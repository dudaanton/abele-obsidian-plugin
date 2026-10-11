import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { chooseNodePathChat, revokeNodePathChatApprovals } from '@/node/NodePathObsidianActions'
const f = vi.hoisted(() => ({ picker: undefined as any, sessions: [] as any[], revoke: vi.fn() }))
vi.mock('@/components/nodeWork/NodeSuggestModal', () => ({
  NodeSuggestModal: class {
    constructor(
      _app: unknown,
      _items: unknown,
      _placeholder: string,
      readonly choose: (item: { id: string }) => void
    ) {
      f.picker = this
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
})
