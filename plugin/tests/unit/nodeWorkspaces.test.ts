import { expect, it, vi } from 'vitest'
import { NodeWorkspaceModel } from '@/node/NodeWorkspaceModel'

it('reads bounded pages until empty, never mistakes a short page for the end', async () => {
  const client = {
    listProjects: vi.fn(async (after?: string) => (after ? [] : [{ project_id: 'p' }])),
    listSessions: vi.fn(async () => []),
    listWorkspaces: vi.fn(async () => []),
    listJobs: vi.fn(async () => []),
    describe: vi.fn(async () => ({})),
  }
  const model = new NodeWorkspaceModel(client as never)
  await model.load()
  expect(client.listProjects.mock.calls).toEqual([[undefined], ['p']])
  expect(model.projects.value).toHaveLength(1)
})

it('reserves a job without attaching a provider, and starts only in an unused ready managed workspace', async () => {
  const client = {
    createWorkspace: vi.fn(async () => ({ workspace_id: 'w', job_id: 'j' })),
    listProjects: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
    listWorkspaces: vi.fn(async () => []),
    listJobs: vi.fn(async () => []),
    describe: vi.fn(async () => ({})),
    createSession: vi.fn(async () => ({ session_id: 's' })),
  }
  const model = new NodeWorkspaceModel(client as never)
  model.projectId.value = 'p'
  await model.createWorkspace('HEAD')
  expect(model.reservation.value).toEqual({ workspace_id: 'w', job_id: 'j' })
  expect(client.createSession).not.toHaveBeenCalled()
  model.workspaces.value = [{ workspace_id: 'w', kind: 'managed', state: 'provisioning' }] as never
  await expect(model.startSession('Task', 'claude')).rejects.toThrow('ready')
  model.workspaces.value = [{ workspace_id: 'w', kind: 'managed', state: 'ready' }] as never
  model.workspaceId.value = 'w'
  await model.startSession('Task', 'claude')
  expect(client.createSession).toHaveBeenCalledWith('Task', 'w', 'claude')
  model.sessions.value = [{ session_id: 's', workspace_id: 'w' }] as never
  await expect(model.startSession('Other', 'claude')).rejects.toThrow('session')
})

it.each([
  {
    entries: [
      { workspace_id: 'removed', kind: 'managed', state: 'removed' },
      { workspace_id: 'root', kind: 'root', state: 'ready' },
      { workspace_id: 'live', kind: 'managed', state: 'ready' },
    ],
    expected: 'live',
  },
  { entries: [{ workspace_id: 'removed', kind: 'managed', state: 'removed' }], expected: '' },
])(
  'moves a removed selection to a present workspace or none ($expected)',
  async ({ entries, expected }) => {
    const client = {
      listWorkspaces: vi.fn(async (_id, after) => (after ? [] : entries)),
      listJobs: vi.fn(async () => []),
    }
    const model = new NodeWorkspaceModel(client as never)
    model.workspaceId.value = 'removed'
    await model.selectProject('project')
    expect(model.workspaceId.value).toBe(expected)
  }
)

it('does not choose a removed first entry as the fallback for a missing selection', async () => {
  const entries = [
    { workspace_id: 'removed', kind: 'managed', state: 'removed' },
    { workspace_id: 'root', kind: 'root', state: 'ready' },
  ]
  const model = new NodeWorkspaceModel({
    listWorkspaces: async (_id: string, after?: string) => (after ? [] : entries),
    listJobs: async () => [],
  } as never)
  await model.selectProject('project')
  expect(model.workspaceId.value).toBe('root')
})

it('pages status and reads unified diff over the client seam', async () => {
  const client = {
    workspaceStatus: vi.fn(async (_id, offset) => ({
      entries: [{ path: offset ? 'second.txt' : 'first.txt' }],
      next_offset: offset ? null : 1,
    })),
    workspaceDiff: vi.fn(async () => ({
      diff: '--- a/first.txt\n+++ b/first.txt',
      head_commit: 'a'.repeat(40),
      base_commit: 'b'.repeat(40),
    })),
  }
  const model = new NodeWorkspaceModel(client as never)
  model.workspaceId.value = 'w'
  await model.preview()
  expect(model.status.value).toHaveLength(2)
  expect(client.workspaceStatus.mock.calls).toEqual([
    ['w', 0],
    ['w', 1],
  ])
  expect(model.diff.value?.diff).toContain('+++ b/first.txt')
})
