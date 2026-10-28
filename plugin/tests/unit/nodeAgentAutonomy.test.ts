import { expect, it, vi } from 'vitest'
import { setup, setupGit, digest } from '../helpers/nodeAgentFixture'
import { createNodeTools, NodeRepositoryToolsHost } from '@/ai/tools/node'

it('normalizes a directory slash and explains a node refusal for ignored sources', async () => {
  const f = setupGit()
  const tree = vi.fn(async () => {
    throw Object.assign(new Error('unsafe_path'), { code: 'unsafe_path' })
  })
  Object.assign(f.repository, { tree })
  await expect(f.call('node_ls', { path: 'src/generated/' })).rejects.toThrow(/ignored|excluded/i)
  expect(tree).toHaveBeenCalledWith(expect.objectContaining({ path: 'src/generated' }))
})

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

it('infers the only plain folder from a project grant', async () => {
  const f = setup()
  await f.call('node_read', {
    node: undefined,
    project: undefined,
    workspace: undefined,
    target_kind: undefined,
    path: 'sample.txt',
  })
  expect(f.client.readFile).toHaveBeenCalledWith('sample-workspace', 'sample.txt')
  expect((await f.call('node_folders', { node: undefined })).content[0].text).toContain(
    'sample-project'
  )
})
it('honors offset and limit as one-based line bounds', async () => {
  const f = setup()
  const text = 'first\nsecond\nthird'
  f.client.readFile.mockResolvedValue({
    ...(await f.client.readFile()),
    content_id: digest(text),
    size: text.length,
  })
  f.client.readContent.mockResolvedValue({ offset: 0, total: text.length, base64: btoa(text) })
  const result = await f.call('node_read', { path: 'sample.txt', offset: 2, limit: 1 })
  expect(JSON.parse(result.content[0].text).text).toBe('second')
})

it('infers a sole available worktree for a project grant', async () => {
  const f = setupGit()
  const page = await f.repository.worktrees()
  f.repository.worktrees.mockResolvedValue({ ...page, entries: [page.entries[0]] })
  const result = await f.call('node_read', {
    node: undefined,
    project: undefined,
    workspace: undefined,
    target_kind: undefined,
    path: 'sample.txt',
  })
  expect(JSON.parse(result.content[0].text).text).toBe('old')
})

it('keeps a project with multiple available worktrees ambiguous', async () => {
  const f = setupGit()
  await expect(
    f.call('node_read', {
      node: undefined,
      project: undefined,
      workspace: undefined,
      target_kind: undefined,
      path: 'sample.txt',
    })
  ).rejects.toThrow('Choose a worktree or folder')
})

it('searches a sole granted project without target arguments', async () => {
  const search = vi.fn(async () => ({
    entries: [],
    cursor: null,
    incomplete: false,
    omissions: [],
  }))
  const f = setupGit(),
    page = await f.repository.worktrees()
  f.repository.worktrees.mockResolvedValue({ ...page, entries: [page.entries[0]] })
  Object.assign(f.repository, { search })
  await f.call('node_search', {
    node: undefined,
    project: undefined,
    workspace: undefined,
    target_kind: undefined,
    query: 'sample',
  })
  expect(search).toHaveBeenCalledWith(expect.objectContaining({ worktree_id: 'sample-tree' }))
})
