import { expect, it, vi } from 'vitest'
import { ChannelError } from '@abele/channel-protocol'
import { NodePathClientPort } from '@/node/NodePathClientPort'
import { NodePathModel, type NodePathPort, type PathTarget } from '@/node/NodePathModel'
import { nodeRepositoryFixture, identity } from '../helpers/nodeRepositoryFixture'

const target: PathTarget = {
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  projectId: 'sample-project',
  kind: 'worktree',
  id: 'sample-target',
}
const revision = {
  kind: 'working' as const,
  observation_id: 'sample-observation',
  head: 'a'.repeat(40),
  observed_at: '2025-01-01T00:00:00Z',
}
const folder = { path: 'src', name: 'src', kind: 'folder' as const }
function fixture() {
  const port = {
    catalogue: vi.fn(async () => ({
      folders: [
        {
          id: target.projectId,
          name: 'Sample',
          path: '/sample',
          git: true,
          copies: [
            { id: target.id, kind: 'project', branch: 'trunk', path: '/sample', changed: 0 },
          ],
        },
      ],
      targets: [target],
      sessions: [],
      capabilities: [],
    })),
    tree: vi.fn(async () => ({ entries: [folder], cursor: null, revision })),
    inspect: vi.fn(async () => ({ entries: [], changes: [], revision })),
    file: vi.fn(async (_target, path) => ({
      target,
      path,
      text: 'sample',
      contentId: 'sample-content',
      revision,
    })),
    history: vi.fn(),
    commit: vi.fn(),
    subscribe: vi.fn(async () => () => {}),
    watch: vi.fn(async () => () => {}),
  }
  const model = new NodePathModel(
    target.nodeId,
    target.registrationId,
    port as unknown as NodePathPort,
    { get: () => undefined, set: () => {} }
  )
  return { model, port }
}
const ticks = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

it('reads one root page without descending or fetching its continuation', async () => {
  const f = nodeRepositoryFixture()
  const port = new NodePathClientPort(
    { ...f.client, describe: async () => ({}), listFiles: vi.fn() } as any,
    { nodeId: identity.node, registrationId: identity.installation }
  )
  vi.spyOn(f.client.repository, 'tree').mockResolvedValue({
    entries: [{ name: 'src', path: 'src', kind: 'directory', oid: null, size: null }],
    cursor: 'sample-next',
    incomplete: false,
    omissions: [],
  })
  const page = await port.tree(target, '')
  expect(page).toMatchObject({ entries: [folder], cursor: 'sample-next' })
  expect(f.client.repository.tree).toHaveBeenCalledTimes(1)
  expect(page.entries[0].children).toBeUndefined()
})
it('opens known unchanged bytes with only blob and content requests', async () => {
  const f = nodeRepositoryFixture()
  const port = new NodePathClientPort({ ...f.client, describe: async () => ({}) } as any, {
    nodeId: identity.node,
    registrationId: identity.installation,
  })
  await port.file(target, 'README.md', undefined, undefined, { revision, changes: [] })
  expect(f.calls.map((call) => call.method)).toEqual([
    'repository.v1.blob',
    'repository.v1.content',
  ])
})

it('serializes metadata-only inspection behind a root inspection of the same target', async () => {
  const { model, port } = fixture()
  await model.refresh()
  let finish!: (value: any) => void
  port.tree.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const full = model.reloadTarget(target, true)
  const metadata = model.reloadTarget(target, false)
  await ticks()
  expect(port.tree).toHaveBeenCalledTimes(1)
  expect(port.inspect).not.toHaveBeenCalled()
  finish({ entries: [folder], cursor: null, revision })
  await Promise.all([full, metadata])
  expect(port.inspect).toHaveBeenCalledTimes(2)
  model.destroy()
})

it('publishes the root before metadata completes and does not inspect unrelated targets on catalogue refresh', async () => {
  const { model, port } = fixture()
  await model.refresh()
  expect(port.inspect).not.toHaveBeenCalled()
  let finish!: (value: any) => void
  port.inspect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const selected = model.select(target.id)
  await ticks()
  expect(model.entries.value).toEqual([folder])
  expect(model.treeProgress.value).toEqual({ state: 'reading', count: 1, error: '' })
  finish({ entries: [], changes: [], revision })
  await selected
  expect(port.tree).toHaveBeenCalledTimes(1)
  expect(model.treeProgress.value).toBeUndefined()
  model.destroy()
})
it('loads only an expanded folder, joins duplicate expansion, and appends one continuation page', async () => {
  const { model, port } = fixture()
  await model.refresh()
  await model.select(target.id)
  let finish!: (value: any) => void
  port.tree.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const one = model.loadFolder('src'),
    duplicate = model.loadFolder('src')
  await ticks()
  expect(port.tree).toHaveBeenCalledTimes(2)
  finish({
    entries: [{ path: 'src/one.ts', name: 'one.ts', kind: 'file' }],
    cursor: 'sample-next',
    revision,
  })
  await Promise.all([one, duplicate])
  port.tree.mockResolvedValueOnce({
    entries: [{ path: 'src/two.ts', name: 'two.ts', kind: 'file' }],
    cursor: null,
    revision,
  } as any)
  await model.loadMore('src')
  expect(model.entries.value[0].children?.map((entry) => entry.path)).toEqual([
    'src/one.ts',
    'src/two.ts',
  ])
  expect(port.tree.mock.lastCall).toEqual([target, 'src', 'sample-next', revision])
  model.destroy()
})
it('retains loaded rows and reports failed progress after a folder-page failure', async () => {
  const { model, port } = fixture()
  await model.refresh()
  await model.select(target.id)
  port.tree.mockRejectedValueOnce(new Error('Sample read failed'))
  await expect(model.loadFolder('src')).rejects.toThrow('Sample read failed')
  expect(model.entries.value).toEqual([folder])
  expect(model.treeProgress.value).toEqual({
    state: 'failed',
    count: 1,
    error: 'Sample read failed',
  })
  model.destroy()
})
it('passes a fresh observed revision and changes to file reads, retrying only an explicitly stale revision', async () => {
  const { model, port } = fixture()
  await model.refresh()
  await model.select(target.id)
  port.file.mockRejectedValueOnce(new ChannelError('stale_revision'))
  await model.openFile(target, 'sample.ts')
  expect(port.file.mock.calls[0][4]).toEqual({ revision, changes: [] })
  expect(port.file.mock.calls[1][4]).toBeUndefined()
  expect(port.tree).toHaveBeenCalledTimes(1)
  model.destroy()
})
