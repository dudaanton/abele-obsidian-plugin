import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { Menu, Notice } from 'obsidian'
import { showNodePathPlaceMenu } from '@/node/NodePathController'

const f = vi.hoisted(() => ({
  remove: vi.fn(async () => ({ job_id: 'sample-job' })),
  job: vi.fn(async () => ({ state: 'succeeded' })),
}))
vi.mock('@/stores/GlobalStore', () => ({ GlobalStore: { getInstance: () => ({ app: {} }) } }))
vi.mock('@/debugger/folderActions', () => ({ addFolderDebugMenu: async () => {} }))
vi.mock('@/components/obsidian/dialogs', () => ({ confirmDialog: async () => true }))
vi.mock('@/node/NodePathOwnerActions', () => ({ nodePathOwnerActions: () => undefined }))
vi.mock('@/node/NodePathMutations', () => ({
  NodePathMutations: class {
    removeManaged = f.remove
  },
}))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      nodes: ref([]),
      connection: () => ({
        state: ref('connected'),
        client: {
          getProject: async () => ({}),
          getRepositorySettings: async () => ({}),
          request: async () => ({}),
          getJob: f.job,
          repository: {
            worktrees: async () => ({
              entries: [
                {
                  worktree_id: 'sample-copy',
                  kind: 'managed',
                  workspace_id: 'sample-workspace',
                  path_label: 'topic',
                  branch: 'topic',
                },
              ],
              cursor: null,
            }),
            observe: async () => ({
              revision: { kind: 'working', observation_id: 'sample-observation' },
            }),
          },
        },
      }),
    }),
  },
}))

it('returns a deleted selected worktree to its project before refreshing, without showing a job id', async () => {
  const selected = ref('sample-copy')
  const select = vi.fn(async (id: string) => {
    selected.value = id
  })
  const refresh = vi.fn(async () => {
    expect(selected.value).toBe('sample-root')
  })
  const model = {
    registrationId: 'sample-registration',
    folders: ref([
      {
        id: 'sample-project',
        git: true,
        path: '/sample/project',
        copies: [
          { id: 'sample-root', kind: 'project' },
          { id: 'sample-copy', kind: 'worktree' },
        ],
      },
    ]),
    target: () => ({ projectId: 'sample-project', id: 'sample-copy', kind: 'worktree' }),
    current: ref({ id: 'sample-copy' }),
    currentFolder: ref({ id: 'sample-project', git: true }),
    sessions: ref([]),
    port: {},
    capabilities: ref(['node_path_worktrees']),
    selected,
    select,
    refresh,
  }
  let menu!: Menu
  const before = Notice.shown.length
  const show = vi.spyOn(Menu.prototype, 'showAtPosition')
  showNodePathPlaceMenu(model as never, new MouseEvent('click'), () => {})
  await vi.waitFor(() => expect(show).toHaveBeenCalled())
  menu = show.mock.instances[0] as unknown as Menu
  await vi.waitFor(() => expect(menu).toBeDefined())
  const items = (menu as unknown as { items: { title: string; handler: () => void }[] }).items
  items.find((i) => i.title === 'Delete the worktree…')!.handler()
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(select).toHaveBeenCalledWith('sample-root')
  expect(Notice.shown.slice(before).join(' ')).not.toContain('sample-job')
})
