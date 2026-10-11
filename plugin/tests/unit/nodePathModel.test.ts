import { describe, expect, it, vi } from 'vitest'
import { ProjectSchema, WorktreePageSchema, SessionSchema } from '@abele/node-protocol'
import {
  NodePathModel,
  NodePathFileModel,
  type NodePathPort,
  type PathTarget,
} from '@/node/NodePathModel'

const project = ProjectSchema.parse({
  project_id: 'project-demo',
  root_path: '/sample/repo',
  repository_path: '/sample/repo',
  git_common_dir: '/sample/repo/.git',
  trust: 'untrusted',
  use_repository_claude_permissions: false,
  created_at: '2025-01-01T00:00:00.000Z',
})
const worktrees = WorktreePageSchema.parse({
  entries: ['one', 'two'].map((id, i) => ({
    worktree_id: id,
    project_id: project.project_id,
    workspace_id: null,
    kind: i ? 'external' : 'root',
    path_label: `/sample/${id}`,
    branch: id,
    detached: false,
    head: 'a'.repeat(40),
    dirty: true,
    availability: 'available',
    locked: false,
    prunable: false,
  })),
  cursor: null,
  incomplete: false,
  omissions: [],
}).entries
const session = SessionSchema.parse({
  session_id: 'chat-demo',
  title: 'Sample chat',
  provider: 'fake',
  created_at: '2025-01-01T00:00:00.000Z',
  workspace_id: null,
})
const target = (id = 'one'): PathTarget => ({
  nodeId: 'node-demo',
  registrationId: 'registration-demo',
  projectId: project.project_id,
  kind: 'worktree',
  id,
})
const change = (stamp = 'first') => ({
  path: 'sample.ts',
  kind: 'modified' as const,
  stage: 'partly' as const,
  changeId: stamp,
  when: 'First observed',
  before: '',
  after: '',
  added: 0,
  removed: 0,
})
function fake() {
  let invalidated = () => {}
  const port: NodePathPort = {
    catalogue: vi.fn(async () => ({
      folders: [
        {
          id: project.project_id,
          name: 'repo',
          path: project.root_path,
          git: true,
          copies: worktrees.map((w) => ({
            id: w.worktree_id,
            kind: w.kind === 'root' ? ('project' as const) : ('worktree' as const),
            branch: w.branch!,
            path: w.path_label,
            changed: 0,
          })),
        },
      ],
      targets: worktrees.map((w) => target(w.worktree_id)),
      sessions: [{ session, target: target() }],
      capabilities: ['node_path_v2'],
    })),
    inspect: vi.fn(async () => ({
      changes: [change()],
      entries: [{ path: 'sample.ts', name: 'sample.ts', kind: 'file' as const }],
      ahead: 2,
      behind: 3,
      base: 'trunk',
    })),
    file: vi.fn(async (t, path, stage) => ({
      target: t,
      path,
      text: 'new text',
      contentId: 'b'.repeat(64),
      revision: {
        kind: 'working',
        observation_id: 'observation-demo',
        head: 'a'.repeat(40),
        observed_at: '2025-01-01T00:00:00.000Z',
      },
      change: { ...change(), stage, before: 'old text', after: 'new text' },
    })),
    history: vi.fn(async () => ({ entries: [], cursor: null })),
    commit: vi.fn(async () => {
      throw new Error('not requested')
    }),
    watch: vi.fn(async (_target, notify) => {
      invalidated = notify
      return () => {
        invalidated = () => {}
      }
    }),
    subscribe: vi.fn(async (notify) => {
      invalidated = notify
      return () => {
        invalidated = () => {}
      }
    }),
  }
  const seen = new Map<string, string>()
  const model = new NodePathModel(
    'node-demo',
    'registration-demo',
    port,
    {
      get: (key) => seen.get(key),
      set: (key, id) => {
        seen.set(key, id)
      },
    },
    () => '2025-01-01T00:00:00.000Z'
  )
  return { model, port, seen, invalidate: () => invalidated() }
}

describe('node path model', () => {
  it('selects a plain folder by its displayed project row while reads use the opaque root workspace', async () => {
    const { model, port } = fake()
    vi.mocked(port.catalogue).mockResolvedValueOnce({
      folders: [
        {
          id: 'plain-project',
          name: 'Plain folder',
          path: '/sample/plain',
          git: false,
          copies: [],
        },
      ],
      targets: [{ ...target('root-workspace'), projectId: 'plain-project', kind: 'workspace' }],
      sessions: [],
      capabilities: [],
    })
    await model.refresh()
    await model.select('plain-project')
    expect(model.current.value?.id).toBe('root-workspace')
    expect(vi.mocked(port.inspect).mock.lastCall?.[0].id).toBe('root-workspace')
    expect(model.selected.value).toBe('plain-project')
    model.destroy()
  })
  it('groups schema-parsed chats under the backend target and counts partly-staged files once', async () => {
    const { model } = fake()
    await model.refresh()
    await model.select('one')
    expect(model.folders.value[0].copies[0]).toMatchObject({
      changed: 1,
      unseen: 1,
      ahead: 2,
      behind: 3,
      chats: [{ id: session.session_id }],
    })
    expect(model.folders.value[0].copies[1].chats).toEqual([])
    expect(model.changes.value).toHaveLength(1)
  })
  it('retains the last known catalogue and files when a read fails; never labels it refreshed', async () => {
    const { model, port } = fake()
    await model.refresh()
    await model.select('one')
    const received = model.receivedAt.value
    vi.mocked(port.catalogue).mockRejectedValueOnce(new Error('offline'))
    await expect(model.refresh()).rejects.toThrow('offline')
    expect(model.folders.value).toHaveLength(1)
    expect(model.entries.value).toHaveLength(1)
    expect(model.receivedAt.value).toBe(received)
  })
  it('does not mark a newer change seen when it arrives during a file load', async () => {
    const { model, port } = fake()
    await model.refresh()
    await model.select('one')
    let finish!: (file: Awaited<ReturnType<NodePathPort['file']>>) => void
    vi.mocked(port.file).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const opened = model.openFile(target(), 'sample.ts')
    vi.mocked(port.inspect).mockResolvedValueOnce({ entries: [], changes: [change('second')] })
    await model.reloadTarget(target())
    finish({
      target: target(),
      path: 'sample.ts',
      text: 'old observation',
      contentId: 'c'.repeat(64),
      change: change('first'),
    })
    await opened
    expect(model.changes.value[0].unseen).toBe(true)
  })
  it('clears only a successfully loaded exact change and keeps failed loads unseen', async () => {
    const { model, port, seen } = fake()
    await model.refresh()
    await model.select('one')
    vi.mocked(port.file).mockRejectedValueOnce(new Error('missing'))
    await expect(model.openFile(target(), 'sample.ts')).rejects.toThrow('missing')
    expect(seen.size).toBe(0)
    await model.openFile(target(), 'sample.ts')
    expect(model.changes.value[0].unseen).toBe(false)
    expect(seen.size).toBe(1)
  })
  it('does not let an old selection response overwrite the new target', async () => {
    const { model, port } = fake()
    await model.refresh()
    let finish!: (value: Awaited<ReturnType<NodePathPort['inspect']>>) => void
    vi.mocked(port.inspect).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const one = model.select('one')
    await model.select('two')
    finish({ changes: [], entries: [{ path: 'old.ts', name: 'old.ts', kind: 'file' }] })
    await one
    expect(model.selected.value).toBe('two')
    expect(model.entries.value[0].path).toBe('sample.ts')
    model.destroy()
  })
  it('moves a chat only after catalogue binding changes, not after choosing another row', async () => {
    const { model, port } = fake()
    await model.refresh()
    await model.select('two')
    expect(model.folders.value[0].copies[0].chats?.[0].id).toBe(session.session_id)
    const catalogue = await port.catalogue()
    catalogue.sessions[0].target = target('two')
    vi.mocked(port.catalogue).mockResolvedValueOnce(catalogue)
    await model.refresh()
    expect(model.folders.value[0].copies[0].chats).toEqual([])
    expect(model.folders.value[0].copies[1].chats?.[0].id).toBe(session.session_id)
    model.destroy()
  })
  it('releases watches and does not publish late responses after disposal', async () => {
    const { model, port } = fake()
    const stop = vi.fn()
    vi.mocked(port.watch).mockResolvedValueOnce(stop)
    await model.refresh()
    await model.select('one')
    let finish!: (value: Awaited<ReturnType<NodePathPort['inspect']>>) => void
    vi.mocked(port.inspect).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const reload = model.reloadTarget(target())
    model.destroy()
    finish({ changes: [], entries: [] })
    await reload
    expect(stop).toHaveBeenCalledOnce()
    expect(model.entries.value).toHaveLength(1)
  })
})

describe('bound node file tabs', () => {
  it('defaults changed files to diff, walks the tab target rather than the sidebar selection', async () => {
    const { model, port } = fake()
    await model.refresh()
    vi.mocked(port.inspect).mockResolvedValue({
      entries: [],
      changes: [change(), { ...change('other'), path: 'other.ts' }],
    })
    await model.select('one')
    const tab = new NodePathFileModel(model, target())
    await tab.open('sample.ts', 'staged')
    expect(tab.mode.value).toBe('diff')
    await model.select('two')
    await tab.step(1)
    expect(vi.mocked(port.file).mock.lastCall?.[0]).toEqual(target('one'))
    expect(tab.document.value?.path).toBe('other.ts')
    model.destroy()
  })
  it('ignores a superseded file request and defaults unchanged files to whole', async () => {
    const { model, port } = fake()
    let finish!: (file: Awaited<ReturnType<NodePathPort['file']>>) => void
    vi.mocked(port.file).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const tab = new NodePathFileModel(model, target())
    const old = tab.open('sample.ts')
    vi.mocked(port.file).mockResolvedValueOnce({
      target: target(),
      path: 'other.ts',
      text: 'unchanged',
      contentId: 'd'.repeat(64),
    })
    await tab.open('other.ts')
    finish({
      target: target(),
      path: 'sample.ts',
      text: 'old',
      contentId: 'e'.repeat(64),
      change: change(),
    })
    await old
    expect(tab.document.value?.path).toBe('other.ts')
    expect(tab.mode.value).toBe('file')
  })
})
