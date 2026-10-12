import { afterEach, expect, it, vi } from 'vitest'
import { ChannelError } from '@abele/channel-protocol'
import {
  NodePathModel,
  NodePathFileModel,
  type NodePathPort,
  type PathDocument,
  type PathTarget,
} from '@/node/NodePathModel'

const target: PathTarget = {
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  projectId: 'sample-project',
  kind: 'worktree',
  id: 'sample-target',
}
const origin = Date.parse('2025-01-01T00:00:00Z')
const observation = (id: string, seconds = 0) => ({
  kind: 'working' as const,
  observation_id: id,
  head: 'a'.repeat(40),
  observed_at: new Date(origin + seconds * 1000).toISOString(),
})
const a = observation('sample-a'),
  b = observation('sample-b', 10)
function fixture() {
  let latest = a
  const port: NodePathPort = {
    catalogue: vi.fn(async () => ({
      folders: [],
      targets: [target],
      sessions: [],
      capabilities: [],
    })),
    tree: vi.fn(async (_target, path) => ({
      entries: path ? [] : [{ name: 'src', path: 'src', kind: 'folder' }],
      cursor: null,
      revision: latest,
    })),
    inspect: vi.fn(async (_target, _files, revision) => ({
      entries: [],
      changes: [],
      revision: revision ?? latest,
    })),
    file: vi.fn(async (bound, path, _stage, frozen, known) => {
      const revision = frozen ?? known?.revision ?? latest
      return {
        target: bound,
        path,
        text: revision.kind === 'working' ? revision.observation_id : 'frozen',
        contentId: 'sample-content',
        revision,
      }
    }),
    history: vi.fn(),
    commit: vi.fn(),
    subscribe: vi.fn(async () => () => {}),
    watch: vi.fn(async () => () => {}),
  }
  const model = new NodePathModel(target.nodeId, target.registrationId, port, {
    get: () => undefined,
    set: () => {},
  })
  return {
    model,
    port,
    latest: (revision: typeof a) => {
      latest = revision
    },
  }
}
const models: NodePathModel[] = []
afterEach(() => {
  for (const model of models.splice(0)) model.destroy()
  vi.useRealTimers()
})
async function selected() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(origin)
  const f = fixture()
  models.push(f.model)
  await f.model.refresh()
  await f.model.select(target.id)
  return f
}
const document = (revision = a): PathDocument => ({
  target,
  path: 'sample.ts',
  text: revision.observation_id,
  contentId: 'sample-content',
  revision,
})

it('does not let a late file result roll a refreshed shared observation backwards', async () => {
  const f = await selected()
  let finish!: (file: PathDocument) => void
  vi.mocked(f.port.file).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const old = f.model.openFile(target, 'sample.ts')
  vi.setSystemTime(origin + 10000)
  f.latest(b)
  await f.model.reloadTarget(target)
  finish(document(a))
  await old
  expect(f.model.hasRetained(target, 'sample.ts')).toBe(true)
  expect((await f.model.openFile(target, 'next.ts')).text).toBe('sample-b')
})
it('does not seed the shared revision cache from a rejected view publication', async () => {
  const f = await selected()
  vi.setSystemTime(origin + 31000)
  f.latest(b)
  await f.model.openFile(target, 'sample.ts', undefined, undefined, () => false)
  expect(f.model.hasRetained(target, 'sample.ts')).toBe(false)
  await f.model.openFile(target, 'next.ts')
  expect(vi.mocked(f.port.file).mock.calls[1][4]).toBeUndefined()
})
it('does not invalidate a newer shared observation when an old read returns stale_revision', async () => {
  const f = await selected()
  let reject!: (error: Error) => void
  vi.mocked(f.port.file).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      })
  )
  const old = f.model.openFile(target, 'sample.ts')
  vi.setSystemTime(origin + 10000)
  f.latest(b)
  await f.model.reloadTarget(target)
  reject(new ChannelError('stale_revision'))
  await old
  const retried = vi.mocked(f.port.file).mock.calls[1][4]
  expect(retried?.revision).toEqual(b)
})
it('keeps the requested target binding immutable during an in-flight file read', async () => {
  const f = await selected(),
    mutable = { ...target }
  let finish!: (file: PathDocument) => void
  vi.mocked(f.port.file).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const pending = f.model.openFile(mutable, 'sample.ts')
  mutable.id = 'other-target'
  finish(document(b))
  await pending
  await f.model.openFile(mutable, 'next.ts')
  expect(vi.mocked(f.port.file).mock.lastCall?.[4]).toBeUndefined()
})

it('retains an accepted plain-workspace file displayed after a target refresh for offline reopening', async () => {
  const f = fixture()
  models.push(f.model)
  const plain: PathTarget = { ...target, kind: 'workspace', id: 'sample-workspace' }
  vi.mocked(f.port.tree!).mockResolvedValue({
    entries: [{ name: 'sample.txt', path: 'sample.txt', kind: 'file' }],
    cursor: null,
  })
  vi.mocked(f.port.inspect).mockResolvedValue({ entries: [], changes: [] })
  await f.model.refresh()
  await f.model.selectTarget(plain)
  let finish!: (file: PathDocument) => void
  vi.mocked(f.port.file).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const leaf = new NodePathFileModel(f.model, plain)
  const opened = leaf.open('sample.txt')
  await f.model.reloadTarget(plain)
  finish({
    target: plain,
    path: 'sample.txt',
    text: 'Displayed sample content',
    contentId: 'sample-plain-content',
  })
  await opened
  expect(leaf.document.value?.text).toBe('Displayed sample content')
  expect(f.model.hasRetained(plain, 'sample.txt')).toBe(true)
  f.model.online.value = false
  await leaf.open('sample.txt')
  expect(leaf.document.value?.text).toBe('Displayed sample content')
  expect(leaf.document.value?.note).toContain('Offline')
  expect(f.port.file).toHaveBeenCalledTimes(1)
  leaf.destroy()
})

it('expires a reused observation after the original freshness bound', async () => {
  const f = await selected()
  for (const seconds of [10, 20]) {
    vi.setSystemTime(origin + seconds * 1000)
    await f.model.openFile(target, 'sample.ts')
  }
  vi.setSystemTime(origin + 31000)
  f.latest(b)
  await f.model.openFile(target, 'next.ts')
  expect(vi.mocked(f.port.file).mock.lastCall?.[4]).toBeUndefined()
})
it('does not renew freshness through folder pages or metadata-only inspection', async () => {
  const f = await selected()
  vi.setSystemTime(origin + 10000)
  await f.model.loadFolder('src')
  vi.setSystemTime(origin + 20000)
  await f.model.reloadTarget(target, false)
  vi.setSystemTime(origin + 31000)
  f.latest(b)
  await f.model.openFile(target, 'sample.ts')
  expect(vi.mocked(f.port.file).mock.lastCall?.[4]).toBeUndefined()
})
it('retains a child continuation and its page revision when the root is appended', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(origin)
  const first = fixture()
  models.push(first.model)
  vi.mocked(first.port.tree!).mockResolvedValueOnce({
    entries: [{ name: 'src', path: 'src', kind: 'folder' }],
    cursor: 'sample-root-next',
    revision: a,
  })
  await first.model.refresh()
  await first.model.select(target.id)
  vi.mocked(first.port.tree!).mockResolvedValueOnce({
    entries: [{ name: 'one.ts', path: 'src/one.ts', kind: 'file' }],
    cursor: 'sample-child-next',
    revision: a,
  })
  await first.model.loadFolder('src')
  vi.mocked(first.port.tree!).mockResolvedValueOnce({
    entries: [{ name: 'other', path: 'other', kind: 'folder' }],
    cursor: null,
    revision: a,
  })
  await first.model.loadMore('')
  expect(first.model.treeCursors.value.src).toBe('sample-child-next')
  vi.mocked(first.port.tree!).mockResolvedValueOnce({
    entries: [{ name: 'two.ts', path: 'src/two.ts', kind: 'file' }],
    cursor: null,
    revision: a,
  })
  await first.model.loadMore('src')
  expect(vi.mocked(first.port.tree!).mock.lastCall).toEqual([target, 'src', 'sample-child-next', a])
  expect(first.model.entries.value[0].children?.map((entry) => entry.path)).toEqual([
    'src/one.ts',
    'src/two.ts',
  ])
})
