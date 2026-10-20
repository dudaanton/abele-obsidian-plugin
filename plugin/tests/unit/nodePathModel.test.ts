import { catalogs as testCatalogs } from '@/i18n/catalogs'
import { initializeLocale } from '@/i18n'
import { presentUiError, presentUiField } from '@/i18n/streamBErrors'
import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
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
  it('metadata refresh after a git write observes disk instead of reusing the pre-write revision', async () => {
    const { model, port } = fake()
    port.git = { discard: vi.fn(async () => {}) } as never
    const inspect = port.inspect
    port.inspect = vi.fn(async (...args) => ({
      ...(await inspect(...args)),
      revision: {
        kind: 'working' as const,
        observation_id: 'before-write',
        head: 'a'.repeat(40),
        observed_at: '2025-01-01T00:00:00Z',
      },
    }))
    await model.refresh()
    await model.select('one')
    await model.openFile(target(), 'sample.ts')
    await model.discard(['sample.ts'])
    expect(vi.mocked(port.inspect).mock.calls.at(-1)?.[2]).toBeUndefined()
    model.destroy()
  })
  it('refreshes an open working file when the changes are discarded', async () => {
    const { model, port } = fake()
    await model.refresh()
    await model.select('one')
    const file = new NodePathFileModel(model, target())
    await file.open('sample.ts')
    vi.mocked(port.file).mockResolvedValue({
      target: target(),
      path: 'sample.ts',
      text: 'restored',
    })
    await model.reloadTarget(target(), false)
    await flushPromises()
    expect(file.document.value?.text).toBe('restored')
    expect(file.document.value?.change).toBeUndefined()
    file.destroy()
    model.destroy()
  })
  it('remembers comparison bases per worktree across switching and snapshot restoration', async () => {
    const { model, port } = fake()
    await model.refresh()
    await model.select('one')
    model.panelBase.value = 'refs/heads/trunk'
    await model.select('two')
    expect(model.panelBase.value).toBe('')
    model.panelBase.value = 'refs/heads/release'
    await model.select('one')
    expect(model.panelBase.value).toBe('refs/heads/trunk')
    const restored = fake().model
    restored.restoreSnapshot(model.snapshot())
    expect(restored.panelBase.value).toBe('refs/heads/trunk')
    await restored.select('two')
    expect(restored.panelBase.value).toBe('refs/heads/release')
    model.destroy()
    restored.destroy()
    void port
  })
  it('coalesces repeated full listings into one in-flight read and one trailing refresh', async () => {
    const { model, port } = fake()
    let first!: (value: Awaited<ReturnType<NodePathPort['inspect']>>) => void
    let last!: (value: Awaited<ReturnType<NodePathPort['inspect']>>) => void
    vi.mocked(port.inspect).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          first = resolve
        })
    )
    vi.mocked(port.inspect).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          last = resolve
        })
    )
    const requests = Array.from({ length: 8 }, () => model.reloadTarget(target()))
    const initial = {
      entries: [{ path: 'first.ts', name: 'first.ts', kind: 'file' as const }],
      changes: [],
    }
    const latest = {
      entries: [{ path: 'latest.ts', name: 'latest.ts', kind: 'file' as const }],
      changes: [],
    }
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(port.inspect).toHaveBeenCalledTimes(1)
      first(initial)
      for (let i = 0; i < 20; i++) await Promise.resolve()
      expect(port.inspect).toHaveBeenCalledTimes(2)
      expect(
        model.inspections.value[JSON.stringify(['node-demo', 'worktree', 'one'])].entries[0].path
      ).toBe('first.ts')
    } finally {
      first(initial)
      last?.(latest)
    }
    await Promise.all(requests)
    expect(port.inspect).toHaveBeenCalledTimes(2)
    expect(
      model.inspections.value[JSON.stringify(['node-demo', 'worktree', 'one'])].entries[0].path
    ).toBe('latest.ts')
  })
  it('does not subscribe if connection admission finishes after owner disposal', async () => {
    const { model, port } = fake()
    model.destroy()
    await model.start()
    expect(port.subscribe).not.toHaveBeenCalled()
    expect(port.catalogue).not.toHaveBeenCalled()
  })
  it('does not lose an in-flight tree when a newer metadata-only refresh finishes first', async () => {
    const { model, port } = fake()
    let finishTree!: (inspection: any) => void
    vi.mocked(port.inspect).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishTree = resolve
        })
    )
    const listing = model.reloadTarget(target(), true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    vi.mocked(port.inspect).mockResolvedValueOnce({
      entries: [],
      changes: [change('newer-metadata')],
      lastCommit: 'Latest metadata',
    })
    const metadata = model.reloadTarget(target(), false)
    finishTree({
      entries: [{ path: 'nested/sample.ts', name: 'sample.ts', kind: 'file' }],
      changes: [change('older-tree')],
      lastCommit: 'Older metadata',
    })
    await Promise.all([listing, metadata])
    const inspection = model.inspections.value[JSON.stringify(['node-demo', 'worktree', 'one'])]
    expect(inspection.entries[0].path).toBe('nested/sample.ts')
    expect(inspection.changes[0].changeId).toBe('newer-metadata')
    expect(inspection.lastCommit).toBe('Latest metadata')
  })
  it('counts image bytes against the retained-document budget and reuses retained images offline', async () => {
    const { model, port } = fake()
    const image = { bytes: new Uint8Array(3 * 1024 * 1024), mime: 'image/png' }
    vi.mocked(port.file).mockImplementation(async (target, path) => ({
      target,
      path,
      text: '',
      contentId: 'c'.repeat(64),
      image,
    }))
    await model.openFile(target(), 'first-image.png')
    await model.openFile(target(), 'second-image.png')
    model.online.value = false
    expect(model.hasRetained(target(), 'first-image.png')).toBe(false)
    await expect(model.openFile(target(), 'first-image.png')).rejects.toThrow('not retained')
    expect((await model.openFile(target(), 'second-image.png')).image).toEqual(image)
    model.destroy()
  })
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
  it('does not resolve an owner refresh until the superseding catalogue has published', async () => {
    const { model, port } = fake()
    const catalogue = await port.catalogue()
    let first!: (value: Awaited<ReturnType<NodePathPort['catalogue']>>) => void
    let latest!: (value: Awaited<ReturnType<NodePathPort['catalogue']>>) => void
    vi.mocked(port.catalogue)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            first = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            latest = resolve
          })
      )
    let settled = false
    const owner = model.refresh().then(() => {
      settled = true
    })
    const superseding = model.refresh()
    first({ ...catalogue, targets: [], folders: [] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    latest(catalogue)
    await Promise.all([owner, superseding])
    expect(model.targets.value).toHaveLength(2)
    model.destroy()
  })
  it('restores device-local display state without claiming a live connection or running agent', async () => {
    const first = fake()
    await first.model.refresh()
    await first.model.select('one')
    const restored = fake()
    restored.model.online.value = false
    restored.model.restoreSnapshot(first.model.snapshot())
    expect(restored.model.selected.value).toBe('one')
    expect(restored.model.entries.value[0].path).toBe('sample.ts')
    expect(restored.model.receivedAt.value).toBe('2025-01-01T00:00:00.000Z')
    expect(restored.model.currentCopy.value?.running).toBe(false)
    expect(restored.model.capabilities.value).toEqual([])
    first.model.destroy()
    restored.model.destroy()
  })
  it('opens a worktree with changes on its changes and keeps history across another place', async () => {
    const { model } = fake()
    await model.refresh()
    await model.select('one')
    expect(model.panelMode.value).toBe('changes')
    model.panelMode.value = 'history'
    await model.select('two')
    expect(model.panelMode.value).toBe('history')
    model.destroy()
  })
  it('keeps the panel mode in the snapshot, and an older snapshot without one still loads', async () => {
    const first = fake()
    await first.model.refresh()
    await first.model.select('one')
    first.model.panelMode.value = 'history'
    const raw = first.model.snapshot() as Record<string, unknown>
    const restored = fake()
    restored.model.restoreSnapshot(raw)
    expect(restored.model.panelMode.value).toBe('history')
    const older = fake()
    const { panelMode: _dropped, ...withoutMode } = raw
    older.model.restoreSnapshot(withoutMode)
    expect(older.model.selected.value).toBe('one')
    expect(older.model.panelMode.value).toBe('files')
    first.model.destroy()
    restored.model.destroy()
    older.model.destroy()
  })
  it('reads the branch against its base, then against a chosen one, and forgets it on another place', async () => {
    const { model, port } = fake()
    const branch = vi.fn(async (_t: PathTarget, base?: string) => ({
      state: { base: base ?? 'trunk', ahead: 1, behind: 0, unpushed: 0 },
      committed: [],
      refs: ['refs/heads/trunk'],
    }))
    port.branch = branch
    await model.refresh()
    await model.select('one')
    await model.loadPanelBranch()
    expect(model.panelBranch.value?.state.base).toBe('trunk')
    model.panelBase.value = 'refs/heads/other'
    await model.loadPanelBranch()
    expect(branch).toHaveBeenLastCalledWith(target('one'), 'refs/heads/other')
    await model.select('two')
    expect(model.panelBase.value).toBe('')
    expect(model.panelBranch.value).toBeUndefined()
    model.destroy()
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
  it('can reopen retained bytes offline without reading or acknowledging a newer change', async () => {
    const { model, port } = fake()
    await model.refresh()
    await model.select('one')
    await model.openFile(target(), 'sample.ts')
    vi.mocked(port.inspect).mockResolvedValueOnce({ entries: [], changes: [change('newer')] })
    await model.reloadTarget(target())
    model.online.value = false
    const calls = vi.mocked(port.file).mock.calls.length
    const retained = await model.openFile(target(), 'sample.ts')
    expect(retained.text).toBe('new text')
    expect(retained.note).toContain('retained')
    expect(vi.mocked(port.file).mock.calls.length).toBe(calls)
    expect(model.changes.value[0].unseen).toBe(true)
    model.destroy()
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
    await new Promise((resolve) => setTimeout(resolve, 0))
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
    await new Promise((resolve) => setTimeout(resolve, 0))
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

it('localizes offline file errors without changing their original message', async () => {
  const { model } = fake()
  model.online.value = false
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  try {
    const error = await model.openFile(target(), 'sample-unretained.txt').catch((error) => error)
    expect(error.message).toBe('This file is not retained on this device. Reconnect to open it.')
    expect(presentUiError(error)).toBe(
      'Файл не сохранён на этом устройстве. Подключитесь заново, чтобы открыть его.'
    )
    model.report(error)
    expect(model.error.value).toBe(error.message)
    expect(presentUiField(model.error, 'value')).toBe(presentUiError(error))
  } finally {
    model.destroy()
    initializeLocale('en', testCatalogs['en' as keyof typeof testCatalogs])
  }
})
