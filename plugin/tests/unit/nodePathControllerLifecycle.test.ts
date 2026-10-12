import { expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { newNodePathChat } from '@/node/NodePathController'
import type { NodePathModel } from '@/node/NodePathModel'

const fixture = vi.hoisted(() => ({
  open: vi.fn(),
  choose: undefined as unknown as (item: { id: string }) => void,
}))
vi.mock('@/components/nodeWork/NodeSuggestModal', () => ({
  NodeSuggestModal: class {
    constructor(_app: unknown, _rows: unknown, _title: string, choose: typeof fixture.choose) {
      fixture.choose = choose
    }
    open() {}
  },
}))
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: { getInstance: () => ({ app: { workspace: {} } }) },
}))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      connection: () => ({ state: { value: 'connected' }, client: { describe: async () => ({}) } }),
    }),
  },
}))
vi.mock('@/node/providers', () => ({
  nodeProviders: () => [{ provider: 'fake' }],
  providerAvailable: () => true,
  providerLabel: () => 'Fake',
}))
vi.mock('@/modal/confirm', () => ({ confirmAction: async () => true }))
vi.mock('@/node/NodePathMutations', () => ({
  NodePathMutations: class {
    async trust() {}
    async execution() {}
    async session() {
      return { session_id: 'sample-session', title: 'Sample chat' }
    }
  },
}))
vi.mock('@/node/nodePathNavigation', () => ({ openNodePathTab: fixture.open }))
vi.mock('@/node/NodePathDialogs', () => ({}))
vi.mock('@/node/NodePairingDialogHost', () => ({}))
vi.mock('@/node/NodePathOwnerActions', () => ({}))

it('opens a newly created chat without waiting for the catalogue and recursive tree refresh', async () => {
  const refresh = vi.fn(() => new Promise<void>(() => {}))
  const model = {
    registrationId: 'sample-registration',
    capabilities: shallowRef(['node_path_execution']),
    folders: shallowRef([]),
    copy: () => undefined,
    refresh,
    report: vi.fn(),
    selectedChat: shallowRef(''),
  }
  const target = {
    nodeId: 'sample-node',
    registrationId: 'sample-registration',
    projectId: 'sample-project',
    kind: 'worktree' as const,
    id: 'sample-worktree',
  }
  await newNodePathChat(model as unknown as NodePathModel, target)
  fixture.choose({ id: 'fake' })
  for (let i = 0; i < 30; i++) await Promise.resolve()
  expect(fixture.open).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ sessionId: 'sample-session', target }),
    false
  )
  expect(model.selectedChat.value).toBe('sample-session')
})
