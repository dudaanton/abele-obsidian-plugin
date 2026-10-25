import { expect, it, vi } from 'vitest'
import { nodeFolderChoices } from '@/components/nodeFolderPicker'
it('lists every branch across pages, including a project with just one branch, at Read', async () => {
  const worktrees = vi.fn(
    async ({ project_id, cursor }: { project_id: string; cursor?: string }) => ({
      entries: [
        {
          worktree_id: cursor ? 'sample-second' : 'sample-first',
          branch: cursor ? 'feature/sample' : 'main',
          path_label: '/sample',
        },
      ],
      cursor: project_id === 'sample-many' && !cursor ? 'sample-next' : null,
    })
  )
  const host = {
    nodes: () => [{ id: 'sample-registration', label: 'Sample node' }],
    connection: () => ({
      client: {
        connected: true,
        listProjects: async () => [
          {
            project_id: 'sample-single',
            root_path: '/samples/single',
            repository_path: '/samples/single',
          },
          {
            project_id: 'sample-many',
            root_path: '/samples/many',
            repository_path: '/samples/many',
          },
        ],
        repository: { worktrees },
      },
    }),
  }
  const choices = await nodeFolderChoices(host as never)
  expect(choices.filter((c) => c.entry.kind === 'target')).toHaveLength(3)
  expect(choices.every((c) => c.entry.access === 'read')).toBe(true)
  expect(worktrees).toHaveBeenCalledWith({ project_id: 'sample-many', cursor: 'sample-next' })
})
