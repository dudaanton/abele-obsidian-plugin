import { expect, it, vi } from 'vitest'
import { ChannelError } from '@abele/channel-protocol'
import { NodePathClientPort } from '@/node/NodePathClientPort'
import {
  NodePathModel,
  pathTargetKey,
  type NodePathPort,
  type PathTarget,
} from '@/node/NodePathModel'
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
it('keeps the loaded tree when its metadata revision expires during recording writes', async () => {
  const { model, port } = fixture()
  await model.refresh()
  port.inspect.mockRejectedValueOnce(new ChannelError('stale_revision'))
  await model.selectTarget(target)
  expect(port.tree).toHaveBeenCalledTimes(1)
  expect(port.inspect).toHaveBeenLastCalledWith(target, false, undefined)
  expect(model.inspections.value[pathTargetKey(target)].entries).toEqual([folder])
  model.destroy()
})

it('clears a prior listing error after an explicit successful folder refresh', async () => {
  const { model } = fixture()
  await model.refresh()
  await model.selectTarget(target)
  model.report(new ChannelError('resource_busy'))
  await model.reloadTarget(target)
  expect(model.error.value).toBe('')
  model.destroy()
})
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
it('joins repeated selection of the same target without scheduling another observation', async () => {
  const { model, port } = fixture()
  await model.refresh()
  let finish!: (value: any) => void
  port.tree.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const first = model.select(target.id),
    second = model.select(target.id)
  await ticks()
  finish({ entries: [folder], cursor: null, revision })
  await Promise.all([first, second])
  expect(port.tree).toHaveBeenCalledTimes(1)
  model.destroy()
})

it('retries the selected root independently of a stalled catalogue refresh', async () => {
  const { model, port } = fixture()
  await model.refresh()
  await model.select(target.id)
  port.catalogue.mockReturnValueOnce(new Promise(() => {}))
  void model.refreshCurrent()
  await ticks()
  expect(port.tree).toHaveBeenCalledTimes(2)
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
it('keeps opened folders filled through a refresh and reads them again at the new observation', async () => {
  const { model, port } = fixture()
  let watched!: () => void
  port.watch.mockImplementation(async (_target: PathTarget, notify: () => void) => {
    watched = notify
    return () => {}
  })
  const inner = (name: string) => ({ path: `src/${name}`, name, kind: 'file' as const })
  let children = [inner('a.ts')]
  port.tree.mockImplementation(async (_target: PathTarget, path: string) => ({
    entries: path === 'src' ? children : [folder],
    cursor: null,
    revision,
  }))
  await model.refresh()
  await model.select(target.id)
  await model.loadFolder('src')
  const childrenOf = () => model.entries.value[0].children?.map((entry) => entry.path)
  expect(childrenOf()).toEqual(['src/a.ts'])
  let finish!: () => void
  port.tree.mockImplementationOnce(async () => {
    // The root page has arrived; the opened folder must not have emptied meanwhile.
    await new Promise<void>((resolve) => (finish = resolve))
    return { entries: [folder], cursor: null, revision }
  })
  children = [inner('a.ts'), inner('b.ts')]
  watched()
  await ticks()
  expect(childrenOf()).toEqual(['src/a.ts'])
  finish()
  for (let i = 0; i < 5; i++) {
    await ticks()
    expect(childrenOf()).not.toBeUndefined()
  }
  expect(childrenOf()).toEqual(['src/a.ts', 'src/b.ts'])
  model.destroy()
})
it('keeps the extra pages of the root and of an opened folder through a refresh', async () => {
  const { model, port } = fixture()
  let watched!: () => void
  port.watch.mockImplementation(async (_target: PathTarget, notify: () => void) => {
    watched = notify
    return () => {}
  })
  const file = (path: string) => ({
    path,
    name: path.split('/').at(-1)!,
    kind: 'file' as const,
  })
  // Two pages in the root and in `src`; the cursor names the page after it.
  const pages: Record<string, { entries: any[]; cursor: string | null }[]> = {
    '': [
      { entries: [folder, file('one.ts')], cursor: 'root-2' },
      { entries: [file('two.ts')], cursor: null },
    ],
    src: [
      { entries: [file('src/a.ts')], cursor: 'src-2' },
      { entries: [file('src/b.ts')], cursor: null },
    ],
  }
  port.tree.mockImplementation(async (_target: PathTarget, path: string, cursor?: string) => {
    const list = pages[path]!
    return { ...list[cursor ? 1 : 0]!, revision }
  })
  await model.refresh()
  await model.select(target.id)
  await model.loadMore('')
  await model.loadFolder('src')
  await model.loadMore('src')
  const shown = () =>
    model.entries.value.map((entry) => [entry.path, entry.children?.map((child) => child.path)])
  const before = [
    ['src', ['src/a.ts', 'src/b.ts']],
    ['one.ts', undefined],
    ['two.ts', undefined],
  ]
  expect(shown()).toEqual(before)
  watched()
  for (let i = 0; i < 10; i++) {
    await ticks()
    // Never fewer rows while it is read again.
    expect(shown()).toEqual(before)
  }
  expect(model.treeCursors.value).toMatchObject({ '': null, src: null })
  model.destroy()
})
it('says a failed background read only in the tree, not in a notice over it', async () => {
  const { model, port } = fixture()
  let watched!: () => void
  port.watch.mockImplementation(async (_target: PathTarget, notify: () => void) => {
    watched = notify
    return () => {}
  })
  await model.refresh()
  await model.select(target.id)
  port.tree.mockRejectedValueOnce(new Error('Sample read error'))
  watched()
  for (let i = 0; i < 5; i++) await ticks()
  expect(model.treeProgress.value).toMatchObject({ state: 'failed', error: 'Sample read error' })
  expect(model.error.value).toBe('')
  model.destroy()
})
