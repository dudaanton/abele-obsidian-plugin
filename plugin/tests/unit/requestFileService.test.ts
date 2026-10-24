import { expect, it, vi } from 'vitest'
const connection = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('missing node')
  })
)
vi.mock('@/node/NodeService', () => ({
  NodeService: { getInstance: () => ({ nodes: { value: [] }, connection }) },
}))
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: {
    getInstance: () => ({ app: { loadLocalStorage: () => undefined, saveLocalStorage: () => {} } }),
  },
}))
import { RequestsService } from '@/requests/RequestsService'

it('can restore a request tab whose node was removed without creating a file client', () => {
  try {
    expect(() =>
      RequestsService.instance().model({
        registrationId: 'missing-node',
        projectId: 'sample-project',
      })
    ).not.toThrow()
    expect(connection).not.toHaveBeenCalled()
  } finally {
    RequestsService.destroy()
  }
})

it('keeps file collections of different worktrees separate', () => {
  try {
    const service = RequestsService.instance()
    expect(
      service.model({
        registrationId: 'missing-node',
        projectId: 'sample-project',
        worktreeId: 'copy-a',
      })
    ).not.toBe(
      service.model({
        registrationId: 'missing-node',
        projectId: 'sample-project',
        worktreeId: 'copy-b',
      })
    )
  } finally {
    RequestsService.destroy()
  }
})

it('binds file reads and watches to the requested worktree rather than another copy', async () => {
  const { NodeRequestFiles } = await import('@/requests/nodeFiles')
  const client = {
    repository: {
      worktrees: async () => ({
        entries: [
          { kind: 'root', worktree_id: 'root-copy' },
          { kind: 'managed', worktree_id: 'managed-copy' },
        ],
        cursor: null,
      }),
    },
  }
  const files = new NodeRequestFiles(
    client as unknown as import('@abele/node-client').NodeClient,
    { nodeId: 'sample-node', registrationId: 'sample-registration', projectId: 'sample-project' },
    async () => {},
    'managed-copy'
  )
  expect((await files.ready()).id).toBe('managed-copy')
})

it('reads request files in plain project folders through the workspace API', async () => {
  const { NodeRequestFiles } = await import('@/requests/nodeFiles')
  const client = {
    repository: {
      worktrees: async () => {
        throw Object.assign(new Error('git_required'), { code: 'git_required' })
      },
    },
    listWorkspaces: async () => [{ kind: 'root', state: 'ready', workspace_id: 'plain-folder' }],
  }
  const files = new NodeRequestFiles(
    client as unknown as import('@abele/node-client').NodeClient,
    { nodeId: 'sample-node', registrationId: 'sample-registration', projectId: 'sample-project' },
    async () => {}
  )
  expect(await files.ready()).toMatchObject({ kind: 'workspace', id: 'plain-folder' })
})

it('re-observes a source read when the repository revision changes in flight', async () => {
  const { NodeRequestFiles } = await import('@/requests/nodeFiles')
  const blob = vi
    .fn()
    .mockRejectedValueOnce(Object.assign(new Error('stale_revision'), { code: 'stale_revision' }))
    .mockResolvedValue({
      content_id: 'sample-content',
      binary: false,
      requires_larger_load: false,
      too_large: false,
      size: 4,
    })
  const client = {
    repository: {
      worktrees: async () => ({
        entries: [{ kind: 'root', worktree_id: 'root-copy' }],
        cursor: null,
      }),
      observe: async () => ({ revision: {} }),
      blob,
      content: async () => ({ offset: 0, total: 4, base64: btoa('test') }),
    },
  }
  const files = new NodeRequestFiles(
    client as unknown as import('@abele/node-client').NodeClient,
    { nodeId: 'sample-node', registrationId: 'sample-registration', projectId: 'sample-project' },
    async () => {}
  )
  expect((await files.read('sample.http')).text).toBe('test')
  expect(blob).toHaveBeenCalledTimes(2)
})

it('connects once for a live collection instead of repeating connection recovery for every read', async () => {
  const { NodeRequestFiles } = await import('@/requests/nodeFiles')
  const connect = vi.fn(async () => {})
  const client = {
    connected: true,
    repository: {
      worktrees: async () => ({
        entries: [{ kind: 'root', worktree_id: 'root-copy' }],
        cursor: null,
      }),
    },
  }
  const files = new NodeRequestFiles(
    client as unknown as import('@abele/node-client').NodeClient,
    { nodeId: 'sample-node', registrationId: 'sample-registration', projectId: 'sample-project' },
    connect
  )
  await Promise.all([files.ready(), files.ready()])
  await files.ready()
  expect(connect).toHaveBeenCalledOnce()
})
