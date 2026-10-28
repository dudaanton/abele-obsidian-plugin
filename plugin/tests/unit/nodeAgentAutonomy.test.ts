import { expect, it, vi } from 'vitest'
import { setup, setupGit } from '../helpers/nodeAgentFixture'
import { createNodeTools, NodeRepositoryToolsHost } from '@/ai/tools/node'

it.each(['', undefined, 'Sample node'])('infers or resolves node: %s', async (node) => {
  const f = setupGit()
  expect((await f.call('list_node_worktrees', { node })).content[0].text).toContain('sample-tree')
})
it('reads an absolute path inside the granted folder', async () => {
  const f = setup()
  await f.call('node_read', { path: '/sample/sample.txt' })
  expect(f.client.readFile).toHaveBeenCalledWith('sample-workspace', 'sample.txt')
})
it('reads an absolute path inside an exact granted worktree', async () => {
  const f = setupGit()
  f.session.overrides.value.nodeScope = [
    {
      kind: 'target',
      node_id: 'sample-node',
      project_id: 'sample-project',
      target: { kind: 'worktree', worktree_id: 'sample-tree' },
      access: 'read',
    },
  ]
  await f.call('node_read', { path: '/sample/sample.txt' })
  expect(f.repository.blob).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'sample.txt', worktree_id: 'sample-tree' })
  )
})
it.each(['/sample-other/sample.txt', '/sample/../outside.txt', '/sample/.git/config'])(
  'rejects escape: %s',
  async (path) => {
    const f = setup()
    await expect(f.call('node_read', { path })).rejects.toThrow()
    expect(f.client.readFile).not.toHaveBeenCalled()
  }
)
it('opens an in-memory source without a repository tab', async () => {
  const f = setupGit()
  const open = createNodeTools(new NodeRepositoryToolsHost(), undefined, f.factory).find(
    (t) => t.name === 'node_open'
  )!
  const onNodeFileTarget = vi.fn()
  const result = await open.execute(
    'sample-open',
    {
      node: 'sample-node',
      project: 'sample-project',
      workspace: 'sample-tree',
      path: 'sample.txt',
    },
    undefined,
    { session: f.session, scope: {} as never, interactive: false, onNodeFileTarget }
  )
  expect(result.content[0].text).toContain('old')
  expect(f.repository.blob).toHaveBeenCalled()
  expect(onNodeFileTarget).toHaveBeenCalledWith({
    node_id: 'sample-node',
    project_id: 'sample-project',
    target: { kind: 'worktree', worktree_id: 'sample-tree' },
  })
})
