import { expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { newNodePathChat, attachNodePathWorktree } from '@/node/NodePathController'
import type { NodePathModel } from '@/node/NodePathModel'

const fixture = vi.hoisted(() => ({
  open: vi.fn(),
  editing: vi.fn(async () => ({ enabled: true })),
  project: vi.fn(async () => ({ trust: 'trusted', root_path: '/sample/project' })),
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
      connection: () => ({
        state: { value: 'connected' },
        client: {
          describe: async () => ({}),
          getProject: fixture.project,
          repository: { editing: fixture.editing },
        },
      }),
    }),
  },
}))
vi.mock('@/node/providers', () => ({
  nodeProviders: () => [{ provider: 'fake' }],
  providerAvailable: () => true,
  providerLabel: () => 'Fake',
  agentChoices: () => [{ provider: 'fake', label: 'Fake', unavailable: '' }],
}))
vi.mock('@/components/obsidian/dialogs', () => ({ confirmDialog: async () => true }))
vi.mock('@/node/NodePathMutations', () => ({
  NodePathMutations: class {
    async selection() {}
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

it('selects an attached worktree without waiting for the catalogue refresh', async () => {
  const model = {
    registrationId: 'sample-registration',
    selectTarget: vi.fn(async () => {}),
    refresh: vi.fn(() => new Promise<void>(() => {})),
    report: vi.fn(),
  }
  const target = {
    nodeId: 'sample-node',
    registrationId: 'sample-registration',
    projectId: 'sample-project',
    kind: 'worktree' as const,
    id: 'sample-root',
  }
  await attachNodePathWorktree(model as unknown as NodePathModel, target, {
    worktree_id: 'sample-external',
    project_id: 'sample-project',
    kind: 'external',
    branch: 'refs/heads/topic',
    detached: false,
    path_label: '/sample/copy',
    availability: 'available',
  } as any)
  expect(model.selectTarget).toHaveBeenCalledWith(
    { ...target, id: 'sample-external' },
    expect.objectContaining({ id: 'sample-external', branch: 'topic' })
  )
  expect(fixture.editing).toHaveBeenCalledWith({ worktree_id: 'sample-external', enabled: true })
})

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
  expect(fixture.project).toHaveBeenCalledWith(target.projectId)
})
