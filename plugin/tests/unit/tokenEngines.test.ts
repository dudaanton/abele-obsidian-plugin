import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryStateStore, sha256, type EngineStatus, type SyncReport } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { TokenEngines } from '@/sync/tokenEngines'
import { TokenUi, connectionError } from '@/sync/tokenUi'
import { TokenConnectionRegistry, TOKEN_REGISTRY_KEY } from '@/sync/tokenConnectionRegistry'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { buildFakeVault } from '../helpers/fakeVault'
import * as safety from '@/sync/external/pluginSafety'
import { JOURNAL_KEY, RECOVERED_WRITES_KEY, WriteJournal } from '@/sync/writeJournal'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { connectionPrivateRoot } from '@/sync/connectionPaths'
import { TokenSettingsPort } from '@/sync/tokenSettingsPort'
import { promises as nativeFs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopFsPort } from '../helpers/desktopRequire'

it.each([
  'sample recovery record is unreadable',
  'External files: sample recovery record is unreadable',
])('shows the actual local recovery failure in startup status: %s', async (reason) => {
  const fixture = inspectionFixture(false, 'Notes')
  const recover = vi
    .spyOn(ObsidianFileSystem.prototype, 'recover')
    .mockRejectedValueOnce(new Error(reason))
  try {
    fixture.release()
    await fixture.ui.connect(fixture.encoded)
    const id = fixture.registry.records()[0].id
    await vi.waitFor(() => expect(fixture.registry.records()[0].status).toBe('error'))
    expect(fixture.ui.activity.value[id].error).toContain(reason)
    expect(fixture.ui.activity.value[id].startup?.stage).toBe('Recovering local files')
  } finally {
    recover.mockRestore()
    fixture.probe.mockRestore()
    await fixture.host.close()
  }
})

it('retains the original startup failure before an engine exists', async () => {
  const failure = vi
    .spyOn(safety, 'recoverExternalState')
    .mockRejectedValueOnce(new Error('Native prefix reader failed'))
  const { ui, host, registry, encoded, release, probe } = inspectionFixture()
  try {
    await ui.connect(encoded)
    const id = registry.records()[0].id
    await vi.waitFor(() =>
      expect(ui.activity.value[id]?.failure?.reason).toContain('Native prefix reader failed')
    )
    expect(ui.activity.value[id].failure?.stage).toBe('Checking saved sync state')
    expect(host.live.has(id)).toBe(false)
  } finally {
    release()
    await host.close()
    probe.mockRestore()
    failure.mockRestore()
  }
})

it('surfaces a server size refusal by path and reason, keeps bytes pending and avoids repeated rejected uploads', async () => {
  const app = buildFakeVault([{ path: 'oversized.bin', content: 'too many bytes' }])
  const registry = TokenConnectionRegistry.open(app),
    keys = new Map<string, string>(),
    metadata = new MemoryStateStore()
  const secrets = {
    get: (id: string) => keys.get(id) ?? null,
    set: (id: string, key: string) => {
      keys.set(id, key)
    },
    remove: (id: string) => {
      keys.delete(id)
    },
  }
  const scope = { kind: 'folder' as const, id: 'root', path: '/' }
  const transport = vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname
    if (path === '/v2/connection')
      return Response.json({
        protocol: 2,
        token_id: 'token',
        space_id: 'space',
        scope,
        status: 'active',
        limits: { max_file_bytes: 4, quota_bytes: null },
      })
    if (path === '/v2/manifest' || path === '/v2/changes')
      return Response.json({ items: [], cursor: 0, next: null })
    if (path.startsWith('/v2/uploads/'))
      return Response.json(
        { error: { code: 'too_large', message: 'File exceeds the server size limit' } },
        { status: 413 }
      )
    throw new Error('Unexpected upload or commit: ' + path)
  })
  const ui = new TokenUi(registry, secrets, transport, {
    executables: new ExecutableReview(metadata),
    attachments: new AttachmentConsent(metadata),
    close: () => {},
  })
  const host = new TokenEngines(app as unknown as App, ui, secrets.get, {
    fetch: transport,
    indexedDB: new IDBFactory(),
    WebSocket: class {
      constructor() {
        throw new Error('No test socket')
      }
    } as unknown as typeof WebSocket,
  })
  try {
    await ui.connect(
      encodeAccessToken({ v: 1, address: 'https://size.example', key: 'a'.repeat(43), scope })
    )
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
    await ui.sync(id)
    expect(ui.activity.value[id].refused).toContainEqual({
      path: 'oversized.bin',
      reason: 'This file is too large for the server. It stays on this device.',
    })
    expect(ui.activity.value[id].pending).toBeGreaterThan(0)
    expect(await app.vault.adapter.read('oversized.bin')).toBe('too many bytes')
    const uploads = () =>
      transport.mock.calls.filter(([input]) =>
        new URL(String(input)).pathname.startsWith('/v2/uploads/')
      ).length
    expect(uploads()).toBe(1)
    const approval = { at: Date.now(), text: 'Installed code from Whole vault: Scripts/sample.js' }
    ui.publish(id, { events: [approval] })
    await ui.sync(id)
    expect(ui.activity.value[id].events).toContainEqual(approval)
    expect(uploads()).toBe(1)
    expect(ui.activity.value[id].refused).toContainEqual({
      path: 'oversized.bin',
      reason: 'This file is too large for the server. It stays on this device.',
    })
    expect(
      transport.mock.calls.some(([input]) => new URL(String(input)).pathname === '/v2/commit')
    ).toBe(false)
  } finally {
    await host.close()
  }
})

it('recovers interrupted installations before inspecting their bytes', async () => {
  const fixture = inspectionFixture()
  const { app, ui, host, registry, encoded, release, probe } = fixture
  const socket = vi.spyOn(window, 'WebSocket')
  const recover = vi.spyOn(ObsidianFileSystem.prototype, 'recover')
  try {
    await ui.connect(encoded)
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.activity.value[id]?.inspection?.total).toBe(1))
    release()
    // Finish the initial automatic exchange before staging an interrupted installation.
    await ui.sync(id)
    await host.close()
    await app.vault.adapter.write('Notes/inflight.tmp', '{"format":"abele.external", broken')
    app.saveLocalStorage(JOURNAL_KEY, [
      { owner: id, target: 'Notes/slow.txt', temp: 'Notes/inflight.tmp' },
    ])
    const next = fixture.makeHost()
    recover.mockClear()
    try {
      next.start()
      await ui.sync(id)
      // Recovery must retire the old entry before inspection can accept this vault.
      expect(
        new WriteJournal(app).entries().filter((entry) => entry.temp === 'Notes/inflight.tmp')
      ).toEqual([])
      expect(recover).toHaveBeenCalled()
      expect(probe.mock.calls.some(([path]) => path === 'Notes/inflight.tmp')).toBe(false)
      expect(ui.runtimes.has(id)).toBe(true)
    } finally {
      await next.close()
      expect(socket).not.toHaveBeenCalled()
    }
  } finally {
    release()
    await host.close()
    probe.mockRestore()
    recover.mockRestore()
    socket.mockRestore()
  }
})

it('retries a failed inspection with fresh ownership', async () => {
  const { app, ui, host, registry, encoded, release, probe } = inspectionFixture(true)
  try {
    await ui.connect(encoded)
    const id = registry.records()[0].id
    release()
    await vi.waitFor(() => expect(registry.records()[0].status).toBe('error'))
    await app.vault.adapter.write('Notes/slow.txt', 'ordinary replacement note')
    await ui.sync(id)
    expect(ui.runtimes.has(id)).toBe(true)
    expect(ui.activity.value[id].error).toBeUndefined()
  } finally {
    release()
    await host.close()
    probe.mockRestore()
  }
})

it('leaves inspection running when disconnect is refused', async () => {
  const { app, ui, host, registry, encoded, release, probe } = inspectionFixture()
  try {
    await ui.connect(encoded)
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.activity.value[id]?.inspection?.total).toBe(1))
    const activity = ui.activity.value[id]
    app.saveLocalStorage('abele-sync-external-connection-switch-v1', {})
    await expect(ui.disconnect(id)).rejects.toThrow()
    expect(ui.activity.value[id]).toEqual(activity)
    app.saveLocalStorage('abele-sync-external-connection-switch-v1', null)
    release()
    await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
  } finally {
    release()
    await host.close()
    probe.mockRestore()
  }
})

it('cancels a joining inspection before manager reset drains the host', async () => {
  const { host, ui, registry, encoded, release, probe } = inspectionFixture()
  try {
    await ui.connect(encoded)
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.activity.value[id]?.inspection?.total).toBe(1))
    host.cancelStartup()
    expect(ui.activity.value[id]?.startupTimings?.at(-1)?.outcome).toBe('cancelled')
    expect(registry.records()).toHaveLength(1)
    await host.close()
  } finally {
    release()
    probe.mockRestore()
    await host.close()
  }
})

function inspectionFixture(
  marker = false,
  folder = '/',
  extraOrKind: Array<{ path: string; content: string }> | 'folder' | 'group' = []
) {
  const kind = typeof extraOrKind === 'string' ? extraOrKind : 'folder'
  const extra = typeof extraOrKind === 'string' ? [] : extraOrKind
  const app = buildFakeVault([
    {
      path: kind === 'group' ? 'Notes/group.md' : 'Notes/slow.txt',
      content: marker ? '{"format":"abele.external", broken' : 'ordinary note',
    },
    ...extra,
  ])
  const registry = TokenConnectionRegistry.open(app)
  const keys = new Map<string, string>()
  const secrets = {
    get: (id: string) => keys.get(id) ?? null,
    set: (id: string, key: string) => {
      keys.set(id, key)
    },
    remove: (id: string) => {
      keys.delete(id)
    },
  }
  const metadata = new MemoryStateStore()
  const scope = { kind, id: 'root', path: folder }
  let cursor = 1
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path === '/v2/connection')
      return Response.json({
        protocol: 2,
        token_id: 'token',
        space_id: 'space',
        scope,
        status: 'active',
        limits: { max_file_bytes: 1000, quota_bytes: null },
      })
    if (path === '/v2/commit') {
      const { ops } = JSON.parse(String(init?.body)) as {
        ops: Array<{
          path?: string
          to_path?: string
          file_id?: string
          sha?: string
          size?: number
          mtime?: number
        }>
      }
      cursor++
      return Response.json({
        cursor,
        results: ops.map((op) => ({
          status: 'applied',
          file_id: op.file_id ?? crypto.randomUUID(),
          version_id: crypto.randomUUID(),
          seq: cursor,
          path: op.path ?? op.to_path ?? scope.path,
          sha: op.sha ?? null,
          size: op.size ?? 0,
          mtime: op.mtime ?? 0,
        })),
      })
    }
    if (path.startsWith('/v2/uploads/')) return new Response(null, { status: 201 })
    return Response.json({ items: [], cursor, next: null })
  })
  const ui = new TokenUi(registry, secrets, transport, {
    executables: new ExecutableReview(metadata),
    attachments: new AttachmentConsent(metadata),
    close: () => {},
  })
  const factory = new IDBFactory()
  const makeHost = () =>
    new TokenEngines(app as unknown as App, ui, secrets.get, {
      fetch: transport,
      indexedDB: factory,
      WebSocket: class {
        constructor() {
          throw new Error('No test socket')
        }
      } as unknown as typeof WebSocket,
    })
  const host = makeHost()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const read = app.vault.adapter.readBinary.bind(app.vault.adapter)
  const probe = vi.spyOn(app.vault.adapter, 'readBinary').mockImplementation(async (path) => {
    await gate
    return read(path)
  })
  const encoded = encodeAccessToken({
    v: 1,
    address: 'https://sync.example',
    key: 'a'.repeat(43),
    scope,
  })
  return {
    app,
    registry,
    ui,
    host,
    transport,
    probe,
    release,
    encoded,
    factory,
    scope,
    makeHost,
    secrets,
  }
}

it('stops a locally renamed folder connection before any further exchange', async () => {
  const { app, registry, ui, host, transport, release, encoded, makeHost } = inspectionFixture(
    false,
    'Notes'
  )
  try {
    release()
    await ui.connect(encoded)
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
    await ui.sync(id)
    transport.mockClear()
    await app.vault.rename(app.vault.getAbstractFileByPath('Notes')!, 'Moved')
    expect(registry.records()[0]).toMatchObject({
      status: 'scope_unavailable',
      rootIssue: { kind: 'moved', path: 'Moved' },
    })
    await expect(ui.sync(id)).rejects.toMatchObject({ code: 'scope_unavailable' })
    expect(transport).not.toHaveBeenCalled()
    await ui.runtimes.get(id)!.followRoot!()
    await ui.sync(id)
    expect(registry.records()[0]).toMatchObject({ localRoot: 'Moved', scope: { path: 'Notes' } })
    expect(registry.records()[0].rootIssue).toBeUndefined()
    transport.mockClear()
    await app.vault.adapter.write('Moved/added.md', 'placed locally')
    // The vault watcher batches create events before invalidating the scan cache.
    let ops: { path?: string; to_path?: string }[] = []
    await vi.waitFor(async () => {
      await ui.sync(id)
      ops = transport.mock.calls
        .filter(([input]) => new URL(String(input)).pathname === '/v2/commit')
        .flatMap(([, init]) => JSON.parse(String(init?.body)).ops)
      expect(ops).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'Notes/added.md' })])
      )
    })
    expect(
      ops.some(
        (op: { path?: string; to_path?: string }) =>
          op.path?.startsWith('Moved/') || op.to_path?.startsWith('Moved/')
      )
    ).toBe(false)
    await host.close()
    const reopened = makeHost()
    try {
      reopened.start()
      await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
      await ui.sync(id)
      expect(registry.records()[0]).toMatchObject({ localRoot: 'Moved', scope: { path: 'Notes' } })
      // The fake adapter retains old empty directory entries after a vault rename.
      expect(app.vault.getFiles().some((file) => file.path.startsWith('Notes/'))).toBe(false)
      expect(await app.vault.adapter.read('Moved/added.md')).toBe('placed locally')
    } finally {
      await reopened.close()
    }
  } finally {
    release()
    await host.close()
  }
})

it('follows a moved folder after native pulls preserve local edit sources', async () => {
  const { app, registry, ui, host, transport, release, encoded, makeHost } = inspectionFixture(
    false,
    'Fixtures/Shared',
    [
      { path: 'Fixtures/Shared/nested/second.md', content: 'nested sample' },
      { path: 'Fixtures/Shared/slow.txt', content: 'ordinary note' },
    ]
  )
  const root = await nativeFs.mkdtemp(join(tmpdir(), 'sample-follow-'))
  try {
    await nativeFs.mkdir(join(root, 'Fixtures/Shared'), { recursive: true })
    await nativeFs.mkdir(join(root, 'Fixtures/Shared/nested'))
    await nativeFs.writeFile(join(root, 'Fixtures/Shared/nested/second.md'), 'nested sample')
    await nativeFs.writeFile(join(root, 'Fixtures/Shared/slow.txt'), 'ordinary note')
    Object.assign(app.vault.adapter, {
      getFullPath: (path: string) => join(root, path),
      fsPromises: nativeFs,
    })
    desktopFsPort(nativeFs)
    const original = transport.getMockImplementation()!
    const items = await Promise.all(
      [
        ['Fixtures/Shared/slow.txt', 'ordinary note'],
        ['Fixtures/Shared/nested/second.md', 'nested sample'],
      ].map(async ([path, text], n) => ({
        file_id: 'file-' + n,
        version_id: 'version-' + n,
        path,
        sha: await sha256(new TextEncoder().encode(text)),
        size: text.length,
        mtime: 1000,
        kind: 'note',
      }))
    )
    transport.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname
      let response: Response
      if (path === '/v2/manifest')
        response = Response.json({
          items: [
            {
              file_id: 'root',
              version_id: 'root-version',
              path: 'Fixtures/Shared',
              kind: 'directory',
              mtime: 1000,
            },
            {
              file_id: 'nested',
              version_id: 'nested-version',
              path: 'Fixtures/Shared/nested',
              kind: 'directory',
              mtime: 1000,
            },
            ...items,
          ],
          cursor: 1,
          next: null,
        })
      else if (path.includes('/content')) {
        const text = path.includes('file-0') ? 'ordinary note' : 'nested sample'
        response = new Response(text, {
          status: 206,
          headers: {
            'content-range': `bytes 0-${text.length - 1}/${text.length}`,
            'content-length': String(text.length),
          },
        })
      } else response = await original(input, init)
      response.headers.set('abele-restore-generation', 'sample-generation')
      return response
    })
    release()
    await ui.connect(encoded)
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
    await ui.sync(id)
    const retained = app.loadLocalStorage(JOURNAL_KEY) as Array<{ target: string; temp: string }>
    expect(retained).toHaveLength(2)
    expect(
      retained.every((entry) =>
        entry.target.startsWith(connectionPrivateRoot(id) + '/placement-outbox/')
      )
    ).toBe(true)
    const kept = await Promise.all(
      retained.map((entry) => nativeFs.readFile(join(root, entry.temp), 'utf8'))
    )
    transport.mockClear()
    await app.vault.rename(app.vault.getAbstractFileByPath('Fixtures/Shared')!, 'Fixtures/Moved')
    await nativeFs.rename(join(root, 'Fixtures/Shared'), join(root, 'Fixtures/Moved'))
    expect(registry.records()[0]).toMatchObject({
      status: 'scope_unavailable',
      rootIssue: { kind: 'moved', path: 'Fixtures/Moved' },
    })
    await expect(ui.sync(id)).rejects.toMatchObject({ code: 'scope_unavailable' })
    expect(transport).not.toHaveBeenCalled()
    await ui.runtimes.get(id)!.followRoot!()
    await ui.sync(id)
    expect(registry.records()[0]).toMatchObject({
      localRoot: 'Fixtures/Moved',
      scope: { path: 'Fixtures/Shared' },
    })
    expect(registry.records()[0].rootIssue).toBeUndefined()
    expect(registry.records()[0].status).toBe('idle')
    expect(
      await Promise.all(retained.map((entry) => nativeFs.readFile(join(root, entry.temp), 'utf8')))
    ).toEqual(kept)
    transport.mockClear()
    await app.vault.adapter.write('Fixtures/Moved/added.md', 'placed locally')
    await nativeFs.writeFile(join(root, 'Fixtures/Moved/added.md'), 'placed locally')
    // The vault watcher batches create events before invalidating the scan cache.
    let ops: { op: string; path?: string; to_path?: string }[] = []
    await vi.waitFor(async () => {
      await ui.sync(id)
      ops = transport.mock.calls
        .filter(([input]) => new URL(String(input)).pathname === '/v2/commit')
        .flatMap(([, init]) => JSON.parse(String(init?.body)).ops)
      expect(ops).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'Fixtures/Shared/added.md' })])
      )
    })
    expect(
      ops.some(
        (op: { path?: string; to_path?: string }) =>
          op.path?.startsWith('Fixtures/Moved/') || op.to_path?.startsWith('Fixtures/Moved/')
      )
    ).toBe(false)
    expect(ops.some((op) => op.op === 'delete' || op.op === 'delete_directory')).toBe(false)
    await host.close()
    const reopened = makeHost()
    try {
      reopened.start()
      await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
      await ui.sync(id)
      expect(registry.records()[0]).toMatchObject({
        localRoot: 'Fixtures/Moved',
        scope: { path: 'Fixtures/Shared' },
      })
      // The fake adapter retains old empty directory entries after a vault rename.
      expect(app.vault.getFiles().some((file) => file.path.startsWith('Fixtures/Shared/'))).toBe(
        false
      )
      expect(await app.vault.adapter.read('Fixtures/Moved/added.md')).toBe('placed locally')
    } finally {
      await reopened.close()
    }
  } finally {
    release()
    await host.close()
    await nativeFs.rm(root, { recursive: true, force: true })
  }
})

it.each(['later-move', 'replaced-file', 'edited-file'])(
  'verifies the stopped root after %s before following',
  async (kind) => {
    const { app, registry, ui, host, transport, release, encoded } = inspectionFixture(
      false,
      'Notes'
    )
    try {
      release()
      await ui.connect(encoded)
      const id = registry.records()[0].id
      await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
      await ui.sync(id)
      await app.vault.rename(app.vault.getAbstractFileByPath('Notes')!, 'Moved')
      if (kind === 'later-move') {
        await app.vault.rename(app.vault.getAbstractFileByPath('Moved')!, 'Final')
        await app.vault.createFolder('Moved')
        await app.vault.adapter.write('Moved/private.md', 'private')
        expect(registry.records()[0].rootIssue).toEqual({ kind: 'moved', path: 'Final' })
        transport.mockClear()
        await ui.runtimes.get(id)!.followRoot!()
        expect(registry.records()[0].localRoot).toBe('Final')
        await ui.sync(id)
        const bodies = transport.mock.calls
          .filter(([url]) => new URL(String(url)).pathname === '/v2/commit')
          .map(([, init]) => String(init?.body))
          .join('')
        expect(bodies).not.toContain('private.md')
      } else if (kind === 'edited-file') {
        const file = app.vault.getFileByPath('Moved/slow.txt')!
        await app.vault.modify(file, 'edited before follow')
        await ui.runtimes.get(id)!.followRoot!()
        expect(registry.records()[0].localRoot).toBe('Moved')
        expect(await app.vault.adapter.read('Moved/slow.txt')).toBe('edited before follow')
      } else {
        await app.vault.delete(app.vault.getFileByPath('Moved/slow.txt')!)
        await app.vault.adapter.write('Moved/slow.txt', 'ordinary note')
        transport.mockClear()
        // The exact-set rule permits edits and replacement at an already known path.
        await ui.runtimes.get(id)!.followRoot!()
        expect(registry.records()[0].rootIssue).toBeUndefined()
        expect(registry.records()[0].localRoot).toBe('Moved')
      }
    } finally {
      release()
      await host.close()
    }
  }
)

it('pins local discovery independently of an authoritative scope rename', async () => {
  const { app, registry, ui, host, transport, probe, release, encoded, scope } = inspectionFixture(
    false,
    'Notes'
  )
  const list = vi.spyOn(app.vault.adapter, 'list')
  try {
    release()
    await ui.connect(encoded)
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
    await ui.sync(id)
    scope.path = 'Renamed'
    await app.vault.create('Renamed/private.md', 'unrelated private bytes')
    await app.vault.adapter.write('Notes/slow.txt', 'changed after scope rename')
    list.mockClear()
    probe.mockClear()
    transport.mockClear()
    await expect(ui.sync(id)).rejects.toThrow(/renamed on the server: Notes.*Renamed/)
    expect(registry.records()[0].localRoot).toBe('Notes')
    expect(
      list.mock.calls.some(
        ([path]) => path === '' || path === 'Renamed' || path.startsWith('Renamed/')
      )
    ).toBe(false)
    expect(probe.mock.calls.some(([path]) => path.startsWith('Renamed/'))).toBe(false)
    const ops = transport.mock.calls
      .filter(([input]) => new URL(String(input)).pathname === '/v2/commit')
      .flatMap(([, init]) => JSON.parse(String(init?.body)).ops)
    expect(ops).toEqual([])
    expect(await app.vault.adapter.read('Renamed/private.md')).toBe('unrelated private bytes')
    expect(await app.vault.adapter.read('Notes/slow.txt')).toBe('changed after scope rename')
  } finally {
    release()
    list.mockRestore()
    probe.mockRestore()
    await host.close()
  }
})

it.each(['root', 'member'] as const)(
  'keeps a locally renamed group %s visible for core move matching',
  async (identity) => {
    const { app, registry, ui, host, transport, probe, release, encoded } = inspectionFixture(
      false,
      'Notes/group.md',
      'group'
    )
    const original = transport.getMockImplementation()!
    const bytes = new TextEncoder().encode('ordinary note')
    const sha = await sha256(bytes)
    const member = new TextEncoder().encode('---\ngroups:\n  - "[[Notes/group]]"\n---\nmember')
    await app.vault.adapter.mkdir('Private')
    await app.vault.adapter.write('Private/source.md', 'unrelated')
    const records = [
      {
        file_id: 'root',
        version_id: 'root-version',
        path: 'Notes/group.md',
        sha,
        size: bytes.length,
        mtime: 1000,
        kind: 'note',
      },
      {
        file_id: 'member',
        version_id: 'member-version',
        path: 'Notes/member.md',
        sha: await sha256(member),
        size: member.length,
        mtime: 1000,
        kind: 'note',
      },
    ]
    transport.mockImplementation(async (input, init) => {
      const route = new URL(String(input)).pathname
      if (route === '/v2/manifest') return Response.json({ items: records, cursor: 1, next: null })
      if (route.includes('/content')) {
        const content = route.includes('/member/') ? member : bytes
        const range = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/)
        if (!range) return new Response(content)
        const start = Number(range[1]),
          end = Number(range[2])
        return new Response(content.slice(start, end + 1), {
          status: 206,
          headers: {
            'content-range': `bytes ${start}-${end}/${content.length}`,
            'content-length': String(end - start + 1),
          },
        })
      }
      if (route === '/v2/commit') {
        const response = await original(input, init)
        const body = await response.json()
        for (const result of body.results) {
          const record = records.find((record) => record.file_id === result.file_id)
          if (!record) continue
          result.sha = record.sha
          result.size = record.size
          result.mtime = 1000
        }
        return Response.json(body)
      }
      return original(input, init)
    })
    try {
      release()
      await ui.connect(encoded)
      const id = registry.records()[0].id
      await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
      await ui.sync(id)
      transport.mockClear()
      probe.mockClear()
      await app.vault.adapter.rename('Private/source.md', 'Private/renamed.md')
      app.emit(
        'vault',
        'rename',
        app.vault.getFileByPath('Private/renamed.md')!,
        'Private/source.md'
      )
      const from = identity === 'root' ? 'Notes/group.md' : 'Notes/member.md'
      await app.vault.adapter.rename(from, 'Notes/renamed.md')
      app.emit('vault', 'rename', app.vault.getFileByPath('Notes/renamed.md')!, from)
      await ui.sync(id)
      const ops = transport.mock.calls
        .filter(([input]) => new URL(String(input)).pathname === '/v2/commit')
        .flatMap(([, init]) => JSON.parse(String(init?.body)).ops)
      expect(ops).toContainEqual(
        expect.objectContaining({ op: 'move', file_id: identity, to_path: 'Notes/renamed.md' })
      )
      expect(ops).not.toContainEqual(expect.objectContaining({ op: 'delete', file_id: identity }))
      expect(probe.mock.calls.some(([path]) => path.startsWith('Private/'))).toBe(false)
    } finally {
      release()
      probe.mockRestore()
      await host.close()
    }
  }
)

async function checkFolderInspection(allStartup: boolean) {
  const fixture = inspectionFixture(false, 'Notes')
  const { app, ui, host, registry, probe, release, encoded } = fixture
  for (let i = 0; i < 200; i++) await app.vault.create(`Private/item-${i}.txt`, 'private')
  const list = vi.spyOn(app.vault.adapter, 'list')
  let inspectionLists: string[] = []
  const recover = safety.recoverExternalState
  const recovery = vi.spyOn(safety, 'recoverExternalState').mockImplementation(async (...args) => {
    const start = list.mock.calls.length
    await recover(...args)
    inspectionLists = list.mock.calls.slice(start).map(([path]) => path)
  })
  try {
    release()
    await ui.connect(encoded)
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
    const directories = allStartup ? list.mock.calls.map(([path]) => path) : inspectionLists
    expect(directories.some((path) => path === '' || path.startsWith('Private'))).toBe(false)
    expect(probe.mock.calls.some(([path]) => path.startsWith('Private/'))).toBe(false)
    expect(probe.mock.calls.some(([path]) => path === 'Notes/slow.txt')).toBe(true)
  } finally {
    release()
    probe.mockRestore()
    list.mockRestore()
    recovery.mockRestore()
    await host.close()
  }
}

it('keeps folder recovery inspection away from unrelated vault files', () =>
  checkFolderInspection(false))
it('ordinary folder runtime directory discovery stays inside the selected folder', () =>
  checkFolderInspection(true))

it.each(['folder', 'group'] as const)(
  'performs no unrelated adapter listing, stat or content read at startup or a normal %s cycle',
  async (kind) => {
    const { app, ui, host, registry, probe, release, encoded, transport } = inspectionFixture(
      false,
      kind === 'folder' ? 'Notes' : 'Notes/group.md',
      kind
    )
    for (let i = 0; i < 100; i++) await app.vault.create(`Private-${i}/note.md`, 'private')
    await app.vault.create('Notes/ignored.md', 'must stay local')
    await app.vault.adapter.mkdir('.obsidian')
    await app.vault.adapter.write('.obsidian/app.json', '{}')
    await app.vault.adapter.write('.abele-sync-ignore', 'Private-*/\nNotes/ignored.md')
    const list = vi.spyOn(app.vault.adapter, 'list')
    const stat = vi.spyOn(app.vault.adapter, 'stat')
    const write = vi.spyOn(app.vault.adapter, 'writeBinary')
    try {
      release()
      await ui.connect(encoded)
      const id = registry.records()[0].id
      await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
      await ui.sync(id)
      await ui.sync(id)
      // Private staging is required for this connection's publication. Permit only
      // exact paths created by this runtime, never unrelated staged recovery files.
      const ownedStages = new Set(
        write.mock.calls
          .map(([path]) => path)
          .filter((path) => path.startsWith('.obsidian/plugins/abele/sync-staging/'))
      )
      for (const calls of [list.mock.calls, stat.mock.calls, probe.mock.calls]) {
        expect(
          calls.filter(
            ([path]) =>
              !(kind === 'folder'
                ? path === 'Notes' || path.startsWith('Notes/')
                : path === 'Notes/group.md') &&
              !ownedStages.has(path) &&
              path !== '.abele-sync-ignore'
          )
        ).toEqual([])
      }
      if (kind === 'folder') expect(list).toHaveBeenCalled()
      else expect(list).not.toHaveBeenCalled()
      expect(probe).toHaveBeenCalled()
      for (const [input, init] of transport.mock.calls)
        if (new URL(String(input)).pathname === '/v2/commit')
          expect(
            JSON.parse(String(init?.body)).ops.some(
              (op: { path?: string }) => op.path === 'Notes/ignored.md'
            )
          ).toBe(false)
    } finally {
      release()
      probe.mockRestore()
      list.mockRestore()
      stat.mockRestore()
      write.mockRestore()
      await host.close()
    }
  }
)

for (const action of ['pass', 'refuse', 'disconnect', 'unload']) {
  it(`keeps a slow full inspection outside Connect and handles ${action} safely`, async () => {
    const fixture = inspectionFixture(action === 'refuse')
    const { ui, host, registry, transport, release, encoded } = fixture
    let connected = false
    const connecting = ui.connect(encoded).then(() => {
      connected = true
    })
    try {
      await vi.waitFor(() => expect(connected).toBe(true), { timeout: 300 })
      await connecting
      const id = registry.records()[0].id
      await vi.waitFor(() =>
        expect(ui.activity.value[id]?.inspection).toEqual({ completed: 0, total: 1 })
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(ui.runtimes.has(id)).toBe(false)
      expect(
        transport.mock.calls.every(
          ([input]) => new URL(String(input)).pathname === '/v2/connection'
        )
      ).toBe(true)
      vi.useFakeTimers()
      await vi.advanceTimersByTimeAsync(60000)
      expect(registry.records()[0].status).toBe('joining')
      expect(ui.activity.value[id].error).toBeUndefined()
      vi.useRealTimers()
      if (action === 'disconnect') {
        await ui.disconnect(id)
        expect(registry.records()).toEqual([])
      } else if (action === 'unload') {
        await host.close()
      }
      release()
      if (action === 'pass') {
        await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
        expect(
          ui.activity.value[id].startupTimings?.filter((one) => one.stage === 'Listing the vault')
        ).toHaveLength(1)
        expect(
          ui.activity.value[id].startupTimings?.filter((one) => one.stage === 'Checking the vault')
        ).toHaveLength(1)
      } else if (action === 'refuse') {
        await vi.waitFor(() => expect(registry.records()[0].status).toBe('error'))
        expect(ui.activity.value[id].error).toContain('recovery')
      }
      if (action !== 'pass') {
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(ui.runtimes.has(id)).toBe(false)
        expect(
          transport.mock.calls.every(
            ([input]) => new URL(String(input)).pathname === '/v2/connection'
          )
        ).toBe(true)
      }
    } finally {
      vi.useRealTimers()
      release()
      await connecting.catch(() => {})
      await host.close()
      fixture.probe.mockRestore()
    }
  })
}

it('names and bounds a stalled inspection and retains its startup timings', async () => {
  const original = ObsidianFileSystem.prototype.recover
  const recover = vi
    .spyOn(ObsidianFileSystem.prototype, 'recover')
    .mockImplementationOnce(async function () {
      await original.call(this)
      vi.useFakeTimers()
    })
  const { ui, host, registry, encoded, release, probe } = inspectionFixture()
  try {
    await ui.connect(encoded)
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.activity.value[id]?.inspection?.total).toBe(1))
    expect(ui.activity.value[id].startup).toMatchObject({
      stage: 'Checking the vault',
      completed: 0,
      total: 1,
    })
    await vi.advanceTimersByTimeAsync(120001)
    expect(registry.records()[0].status).toBe('error')
    expect(ui.activity.value[id].error).toContain('Checking the vault')
    expect(ui.activity.value[id].startupTimings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'Checking the vault', outcome: 'failed' }),
      ])
    )
    vi.useRealTimers()
    release()
    await ui.sync(id)
    expect(ui.runtimes.has(id)).toBe(true)
  } finally {
    vi.useRealTimers()
    release()
    await host.close()
    probe.mockRestore()
    recover.mockRestore()
  }
})

it('revokes a timed-out engine start and permits a later explicit retry', async () => {
  vi.useFakeTimers()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const inspection = vi
    .spyOn(safety, 'activeExternalDocuments')
    .mockImplementationOnce(async () => {
      await gate
      return []
    })
  const app = buildFakeVault([])
  const registry = TokenConnectionRegistry.open(app)
  const metadata = new MemoryStateStore()
  const keys = new Map<string, string>()
  const secrets = {
    get: (ref: string) => keys.get(ref) ?? null,
    set: (ref: string, key: string) => {
      keys.set(ref, key)
    },
    remove: (ref: string) => {
      keys.delete(ref)
    },
  }
  const scope = { kind: 'folder' as const, id: 'root', path: '/' }
  const transport: typeof fetch = async (input) =>
    new URL(String(input)).pathname === '/v2/connection'
      ? Response.json({
          protocol: 2,
          token_id: 'token',
          space_id: 'space',
          scope,
          status: 'active',
          limits: { max_file_bytes: 1000, quota_bytes: null },
        })
      : Response.json({ items: [], cursor: 1, next: null })
  const ui = new TokenUi(registry, secrets, transport, {
    executables: new ExecutableReview(metadata),
    attachments: new AttachmentConsent(metadata),
    close: () => {},
  })
  const host = new TokenEngines(app as unknown as App, ui, secrets.get, {
    fetch: transport,
    indexedDB: new IDBFactory(),
    WebSocket: class {
      constructor() {
        throw new Error('No test socket')
      }
    } as unknown as typeof WebSocket,
  })
  try {
    await ui.connect(
      encodeAccessToken({ v: 1, address: 'https://sync.example', key: 'a'.repeat(43), scope })
    )
    const id = registry.records()[0].id
    await vi.advanceTimersByTimeAsync(10001)
    expect(registry.records()[0].status).toBe('error')
    expect(ui.activity.value[id].error).toContain('starting sync')
    const retry = ui.sync(id).catch((error) => error)
    await vi.advanceTimersByTimeAsync(10001)
    expect(connectionError(await retry)).toContain('starting sync')
    release()
    await vi.advanceTimersByTimeAsync(1)
    expect(ui.runtimes.has(id)).toBe(false)
    vi.useRealTimers()
    await ui.sync(id)
    expect(ui.runtimes.has(id)).toBe(true)
  } finally {
    release()
    vi.useRealTimers()
    inspection.mockRestore()
    await host.close()
  }
})

it.each(['revoked', 'forbidden', '503', 'network'] as const)(
  'keeps %s classification across reload without deleting local files',
  async (failure) => {
    const revoked = failure === 'revoked' || failure === 'forbidden'
    const app = buildFakeVault([{ path: 'Private/keep.md', content: 'local retained file' }])
    const registry = TokenConnectionRegistry.open(app),
      keys = new Map<string, string>(),
      metadata = new MemoryStateStore()
    const secrets = {
      get: (id: string) => keys.get(id) ?? null,
      set: (id: string, value: string) => {
        keys.set(id, value)
      },
      remove: (id: string) => {
        keys.delete(id)
      },
    }
    const scope = { kind: 'folder' as const, id: 'root', path: '/' }
    let failing = false
    const transport = vi.fn<typeof fetch>(async (input) => {
      if (failing) {
        if (failure === 'network') throw new TypeError('Network unavailable')
        if (failure === 'forbidden')
          return Response.json(
            { error: { code: 'forbidden', message: 'Access closed' } },
            { status: 403 }
          )
        return Response.json(
          {
            error: {
              code: failure === 'revoked' ? 'unauthorized' : 'internal',
              message: 'sample failure',
            },
          },
          { status: failure === 'revoked' ? 401 : 503 }
        )
      }
      if (new URL(String(input)).pathname === '/v2/connection')
        return Response.json({
          protocol: 2,
          token_id: 'token',
          space_id: 'space',
          scope,
          status: 'active',
          limits: { max_file_bytes: 1000000, quota_bytes: null },
        })
      return Response.json({ items: [], cursor: 0, next: null })
    })
    const reviews = {
      executables: new ExecutableReview(metadata),
      attachments: new AttachmentConsent(metadata),
      close: () => {},
    }
    let ui = new TokenUi(registry, secrets, transport, reviews)
    await ui.connect(
      encodeAccessToken({ v: 1, address: 'https://sample.example', key: 'a'.repeat(43), scope })
    )
    failing = true
    const deps = {
      fetch: transport,
      indexedDB: new IDBFactory(),
      WebSocket: class {
        constructor() {
          throw new Error('No socket')
        }
      } as unknown as typeof WebSocket,
    }
    let host = new TokenEngines(app as unknown as App, ui, secrets.get, deps)
    try {
      host.start()
      await vi.waitFor(() =>
        expect(registry.records()[0].status).toBe(revoked ? 'needs-token' : 'offline')
      )
      // The friendly text hides the cause; diagnostics keep the code and the original message.
      if (revoked)
        expect(ui.activity.value[registry.records()[0].id]?.failure).toMatchObject({
          code: failure === 'forbidden' ? 'forbidden' : 'unauthorized',
          message: expect.any(String),
        })
      let stopped = transport.mock.calls.length
      if (!revoked) {
        await vi.waitFor(() =>
          expect(ui.activity.value[registry.records()[0].id]?.refused).toContainEqual({
            path: 'Private/keep.md',
            reason: connectionError({ code: 'offline' }),
          })
        )
        // A retry blocked on the connection check has not sent these bytes.
        const id = registry.records()[0].id
        await (
          host as unknown as {
            changed: (id: string, status: EngineStatus) => Promise<void>
          }
        ).changed(id, {
          state: 'syncing',
          pending: 0,
          lastSyncAt: null,
          lastError: 'Network unavailable',
          cursor: 0,
          headSeq: null,
        })
        expect(ui.activity.value[id]?.refused).toContainEqual({
          path: 'Private/keep.md',
          reason: connectionError({ code: 'offline' }),
        })
        expect(ui.activity.value[id]?.pending).toBeGreaterThan(0)
        const runtime = host as unknown as {
          live: Map<
            string,
            { pendingLocalDetails: () => Promise<{ count: number; paths: string[] }> }
          >
          changed: (id: string, status: EngineStatus, report?: SyncReport) => Promise<void>
        }
        let finish!: (value: { count: number; paths: string[] }) => void
        vi.spyOn(runtime.live.get(id)!, 'pendingLocalDetails').mockReturnValueOnce(
          new Promise((resolve) => {
            finish = resolve
          })
        )
        // On a large vault the failed attempt's pending scan can outlive the backoff.
        ui.publish(id, { refused: [], pending: 0 })
        const failed = runtime.changed(id, {
          state: 'offline',
          pending: 0,
          lastSyncAt: null,
          lastError: 'Network unavailable',
          cursor: 0,
          headSeq: null,
        })
        await runtime.changed(id, {
          state: 'syncing',
          pending: 0,
          lastSyncAt: null,
          lastError: 'Network unavailable',
          cursor: 0,
          headSeq: null,
        })
        finish({ count: 1, paths: ['Private/keep.md'] })
        await failed
        expect(ui.activity.value[id]?.refused).toContainEqual({
          path: 'Private/keep.md',
          reason: connectionError({ code: 'offline' }),
        })
        expect(registry.records()[0].status).toBe('syncing')
        vi.spyOn(runtime.live.get(id)!, 'pendingLocalDetails').mockReturnValueOnce(
          new Promise((resolve) => {
            finish = resolve
          })
        )
        const olderFailure = runtime.changed(id, {
          state: 'offline',
          pending: 0,
          lastSyncAt: null,
          lastError: 'Network unavailable',
          cursor: 0,
          headSeq: null,
        })
        const report: SyncReport = {
          pull: { applied: 0, held: [], skipped: 0, cursor: 1, deferred: 0, bootstrapped: false },
          push: {
            committed: null,
            applied: 1,
            merged: 0,
            conflicts: 0,
            rejected: [],
            replayed: false,
            kept: [],
          },
          secondPull: null,
          collisions: [],
          deferred: 0,
          joined: false,
        }
        await runtime.changed(
          id,
          {
            state: 'idle',
            pending: 0,
            lastSyncAt: new Date().toISOString(),
            lastError: null,
            cursor: 1,
            headSeq: 1,
          },
          report
        )
        finish({ count: 1, paths: ['Private/keep.md'] })
        await olderFailure
        expect(ui.activity.value[id]?.refused).toEqual([])
        expect(ui.activity.value[id]?.pending).toBe(0)
        await vi.waitFor(() => expect(transport.mock.calls.length).toBeGreaterThan(stopped), {
          timeout: 4000,
        })
        stopped = transport.mock.calls.length
      }
      await host.close()
      ui = new TokenUi(TokenConnectionRegistry.open(app), secrets, transport, reviews)
      host = new TokenEngines(app as unknown as App, ui, secrets.get, deps)
      host.announce()
      host.start()
      if (revoked) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(transport).toHaveBeenCalledTimes(stopped)
        expect(registry.records()[0].status).toBe('needs-token')
      } else {
        await vi.waitFor(() => expect(transport.mock.calls.length).toBeGreaterThan(stopped))
        expect(registry.records()[0].status).not.toBe('needs-token')
      }
      expect(await app.vault.adapter.read('Private/keep.md')).toBe('local retained file')
    } finally {
      await host.close()
    }
  }
)

it('binds saved token rows to independent native production runtimes and drains disconnect', async () => {
  const app = buildFakeVault([]),
    registry = TokenConnectionRegistry.open(app),
    keys = new Map<string, string>(),
    metadata = new MemoryStateStore()
  const secrets = {
    get: (ref: string) => keys.get(ref) ?? null,
    set: (ref: string, key: string) => {
      keys.set(ref, key)
    },
    remove: (ref: string) => {
      keys.delete(ref)
    },
  }
  const scope = { kind: 'folder' as const, id: 'sample-root', path: '/' }
  const transport: typeof fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/v2/connection')
      return Response.json({
        protocol: 2,
        token_id: 'sample-token',
        space_id: 'sample-space',
        scope,
        status: 'active',
        limits: { max_file_bytes: 1000000, quota_bytes: null },
      })
    if (url.pathname === '/v2/manifest' || url.pathname === '/v2/changes')
      return Response.json({ items: [], cursor: 1, next: null })
    throw new Error('Unexpected route: ' + url.pathname)
  }
  const reviews = {
    executables: new ExecutableReview(metadata),
    attachments: new AttachmentConsent(metadata),
    close: () => {},
  }
  const ui = new TokenUi(registry, secrets, transport, reviews)
  const host = new TokenEngines(app as unknown as App, ui, secrets.get, {
    fetch: transport,
    indexedDB: new IDBFactory(),
    WebSocket: class {
      constructor() {
        throw new Error('No test socket')
      }
    } as unknown as typeof WebSocket,
  })
  try {
    await ui.connect(
      encodeAccessToken({ v: 1, address: 'https://first.example', key: 'a'.repeat(43), scope })
    )
    await ui.connect(
      encodeAccessToken({ v: 1, address: 'https://second.example', key: 'b'.repeat(43), scope })
    )
    await vi.waitFor(() => expect(ui.runtimes.size).toBe(2))
    const [first, second] = registry.records()
    await Promise.all([ui.sync(first.id), ui.sync(second.id)])
    expect(ui.activity.value[first.id].lastSync).toBeGreaterThan(0)
    await ui.pause(first.id, true)
    expect(registry.records().find((one) => one.id === second.id)?.paused).toBe(false)
    await ui.disconnect(first.id)
    expect(ui.runtimes.has(first.id)).toBe(false)
    expect(keys.size).toBe(1)
    // Count the host's retained owners, not just the visible connection rows.
    const retained = host as unknown as {
      engines: { runtimes: Map<string, unknown> }
      retries: Map<string, unknown>
      activityEpoch: Map<string, unknown>
      activityReports: Map<string, unknown>
    }
    for (let cycle = 0; cycle < 6; cycle++) {
      await ui.connect(
        encodeAccessToken({
          v: 1,
          address: `https://cycle${cycle}.example`,
          key: 'c'.repeat(43),
          scope,
        })
      )
      const added = registry.records().find((one) => one.id !== second.id)!
      await vi.waitFor(() => expect(ui.runtimes.has(added.id)).toBe(true))
      await ui.disconnect(added.id)
    }
    expect(retained.engines.runtimes.size).toBe(1)
    expect(retained.retries.size).toBe(1)
    const ports = TokenSettingsPort as unknown as {
      instances: WeakMap<TokenUi, Map<string, unknown>>
    }
    expect(ports.instances.get(ui)?.size).toBe(1)
    expect(retained.activityEpoch.size).toBeLessThanOrEqual(1)
    expect(retained.activityReports.size).toBeLessThanOrEqual(1)
    expect(Object.keys(ui.activity.value)).toEqual([second.id])
    await ui.sync(second.id)
    expect(registry.records().map((one) => one.id)).toEqual([second.id])
  } finally {
    await host.close()
  }
})

it('stops a server rename without discovering its private local namesake and permits disconnect', async () => {
  const { app, registry, ui, host, transport, probe, release, encoded, scope } = inspectionFixture(
    false,
    'Notes'
  )
  const list = vi.spyOn(app.vault.adapter, 'list')
  try {
    release()
    await ui.connect(encoded)
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
    await ui.sync(id)
    await app.vault.create('Private/secret.md', 'private bytes')
    scope.path = 'Private'
    list.mockClear()
    probe.mockClear()
    transport.mockClear()
    await expect(ui.sync(id)).rejects.toThrow(/renamed on the server/)
    expect(registry.records()[0].localRoot).toBe('Notes')
    expect(
      list.mock.calls.some(([path]) => path === 'Private' || path.startsWith('Private/'))
    ).toBe(false)
    expect(probe.mock.calls.some(([path]) => path.startsWith('Private/'))).toBe(false)
    expect(
      transport.mock.calls.some(([url]) => new URL(String(url)).pathname === '/v2/commit')
    ).toBe(false)
    expect(ui.activity.value[id].error).toContain('Notes → Private')
    await ui.disconnect(id)
    expect(registry.records()).toEqual([])
    expect(await app.vault.adapter.read('Private/secret.md')).toBe('private bytes')
  } finally {
    release()
    list.mockRestore()
    probe.mockRestore()
    await host.close()
  }
})

it('confines full folder startup, recovery and first exchange before any adapter access', async () => {
  const { app, ui, host, registry, encoded, release, probe, transport } = inspectionFixture(
    false,
    'Notes',
    [{ path: 'Notes/excluded.txt', content: 'excluded bytes' }]
  )
  const bytes = new TextEncoder().encode('downloaded bytes')
  const item = {
    file_id: 'remote-file',
    version_id: 'remote-version',
    path: 'Notes/remote.md',
    kind: 'note',
    mtime: 1000,
    size: bytes.length,
    sha: await sha256(bytes),
  }
  const send = transport.getMockImplementation()!
  transport.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/v2/manifest')
      return Response.json({ items: [item], cursor: 1, next: null })
    if (url.pathname.endsWith('/content')) {
      const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('range') ?? '')
      return range
        ? new Response(bytes.slice(Number(range[1]), Number(range[2]) + 1), {
            status: 206,
            headers: {
              'content-range': `bytes ${range[1]}-${range[2]}/${bytes.length}`,
              'content-length': String(Number(range[2]) - Number(range[1]) + 1),
            },
          })
        : new Response(bytes)
    }
    return send(input, init)
  })
  await app.vault.create('Private/secret.md', 'private uncached bytes')
  await app.vault.adapter.write('.abele-sync-ignore', 'Notes/excluded.txt\n')
  const calls: string[] = []
  for (const method of [
    'list',
    'stat',
    'read',
    'readBinary',
    'exists',
    'write',
    'writeBinary',
    'appendBinary',
    'mkdir',
    'remove',
    'rmdir',
    'rename',
  ] as const) {
    if (typeof app.vault.adapter[method] !== 'function') continue
    const port = app.vault.adapter[method]
    const original = (vi.isMockFunction(port) ? port.getMockImplementation()! : port).bind(
      app.vault.adapter
    )
    vi.spyOn(app.vault.adapter, method).mockImplementation(
      async (path: string, ...args: never[]) => {
        calls.push(path)
        if (method === 'rename') calls.push(String(args[0]))
        return original(path, ...args)
      }
    )
  }
  try {
    release()
    await ui.connect(encoded)
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
    await ui.sync(id)
    const published = transport.mock.calls
      .filter(([url]) => new URL(String(url)).pathname === '/v2/commit')
      .flatMap(([, init]) => JSON.parse(String(init?.body)).ops as Array<{ path: string }>)
    expect(published.map((op) => op.path)).toContain('Notes/slow.txt')
    expect(published.map((op) => op.path)).not.toContain('Notes/excluded.txt')
    expect(published.map((op) => op.path)).not.toContain('.abele-sync-ignore')
    expect(probe.mock.calls.some(([path]) => path === '.abele-sync-ignore')).toBe(true)
    expect(
      calls.filter(
        (path) =>
          path !== 'Notes' &&
          path !== '.abele-sync-ignore' &&
          !path.startsWith('Notes/') &&
          !path.startsWith('.abele-sync/connections/' + id + '/') &&
          path !== '.abele-sync/connections/' + id &&
          !['.abele-sync', '.abele-sync/connections'].includes(path)
      )
    ).toEqual([])
    expect(calls.some((path) => path.startsWith('Private'))).toBe(false)
    expect(await app.vault.adapter.read('Notes/remote.md')).toBe('downloaded bytes')
  } finally {
    release()
    await host.close()
    probe.mockRestore()
    vi.restoreAllMocks()
  }
})

it.each(['owned', 'legacy'])(
  'restarts after an interrupted %s private placement download without treating it as a foreign folder',
  async (kind) => {
    const { app, ui, host, registry, encoded, release, probe, makeHost } = inspectionFixture(
      false,
      'Notes'
    )
    let restarted: TokenEngines | undefined
    try {
      release()
      await ui.connect(encoded)
      const id = registry.records()[0].id
      await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
      await ui.sync(id)
      const fs = Reflect.get(Reflect.get(host, 'live').get(id), 'options').fs
      const stages = Reflect.get(fs, Symbol.for('abele.sync.private-placement-stages-v1'))
      const pending =
        kind === 'owned'
          ? await stages.beginAtomicWrite('.abele-sync/placement-inbox/aaaaaaaa-bbbb', 0, null)
          : await new ObsidianFileSystem(app as never).beginAtomicWrite(
              '.abele-sync/placement-inbox/aaaaaaaa-bbbb',
              0,
              null
            )
      await pending.append(0, new Uint8Array([1, 2]))
      expect(new WriteJournal(app).entries().some((entry) => entry.temp === pending.id)).toBe(true)
      await host.close()
      restarted = makeHost()
      restarted.start()
      await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
      await ui.sync(id)
      expect(registry.records()[0].status).not.toBe('error')
      expect(new WriteJournal(app).entries().some((entry) => entry.temp === pending.id)).toBe(
        kind === 'legacy'
      )
    } finally {
      release()
      await restarted?.close()
      await host.close()
      probe.mockRestore()
    }
  }
)

it.each(['before-create', 'after-remove', 'other-connection'])(
  'starts a folder connection after interrupted private work: %s',
  async (gap) => {
    const { app, ui, host, registry, encoded, release, probe, makeHost } = inspectionFixture(
      false,
      'Notes'
    )
    let restarted: TokenEngines | undefined
    let restore: (() => void) | undefined
    try {
      release()
      await ui.connect(encoded)
      const id = registry.records()[0].id
      await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
      await ui.sync(id)
      const { connectionAdapter } = await import('@/sync/connectionScope')
      const { connectionPrivateRoot } = await import('@/sync/connectionPaths')
      const { privatePlacementStages } = await import('@/sync/privatePlacementStages')
      const owner = gap === 'other-connection' ? 'another-connection' : id
      const root = connectionPrivateRoot(owner)
      const fs = new ObsidianFileSystem(app as unknown as App, {
        adapter: connectionAdapter(
          app.vault.adapter,
          gap === 'other-connection' ? 'Private' : 'Notes',
          root
        ),
        connectionId: owner,
        fileScope: gap === 'other-connection' ? 'Private' : 'Notes',
      })
      const stages = privatePlacementStages(fs, root)
      const path = '.abele-sync/placement-inbox/aaaaaaaa-bbbb'
      let temp: string
      if (gap === 'before-create') {
        const create = vi
          .spyOn(Reflect.get(fs, 'io'), 'create')
          .mockRejectedValueOnce(new Error('simulated termination'))
        restore = () => create.mockRestore()
        await expect(stages.beginAtomicWrite(path, 0, null)).rejects.toThrow(
          'simulated termination'
        )
        temp = new WriteJournal(app)
          .entries()
          .find((entry) => entry.target === root + '/placement-inbox/aaaaaaaa-bbbb')!.temp!
      } else {
        const stage = await stages.beginAtomicWrite(path, 0, null)
        temp = stage.id
        await stage.append(0, new Uint8Array([1, 2]))
        if (gap === 'after-remove') {
          const original = app.saveLocalStorage.bind(app)
          app.saveLocalStorage = (key, value) => {
            if (key === JOURNAL_KEY) throw new Error('simulated termination')
            original(key, value)
          }
          restore = () => {
            app.saveLocalStorage = original
          }
          await expect(stage.discard()).rejects.toThrow('cannot save the write journal')
        }
      }
      restore?.()
      restore = undefined
      expect(new WriteJournal(app).entries().some((entry) => entry.temp === temp)).toBe(true)
      await host.close()
      const stat = vi.spyOn(app.vault.adapter, 'stat')
      restarted = makeHost()
      restarted.start()
      await vi.waitFor(() =>
        expect(ui.runtimes.has(id) || registry.records()[0].status === 'error').toBe(true)
      )
      expect(ui.activity.value[id]?.error).toBeUndefined()
      expect(ui.runtimes.has(id)).toBe(true)
      await ui.sync(id)
      expect(new WriteJournal(app).entries().some((entry) => entry.temp === temp)).toBe(
        gap === 'other-connection'
      )
      if (gap === 'other-connection')
        expect(stat.mock.calls.some(([path]) => path.startsWith(root))).toBe(false)
      stat.mockRestore()
    } finally {
      restore?.()
      release()
      await restarted?.close()
      await host.close()
      probe.mockRestore()
    }
  }
)
it('starts an unchanged legacy folder connection with saved state and pins its current local root', async () => {
  const f = inspectionFixture(false, 'Notes')
  let restarted: TokenEngines | undefined
  try {
    f.release()
    await f.ui.connect(f.encoded)
    const id = f.registry.records()[0].id
    await vi.waitFor(() => expect(f.ui.runtimes.has(id)).toBe(true))
    await f.ui.sync(id)
    const before = f.registry.records()[0]
    await f.host.close()
    const doc = f.app.loadLocalStorage(TOKEN_REGISTRY_KEY) as { records: { localRoot?: string }[] }
    delete doc.records[0].localRoot
    f.app.saveLocalStorage(TOKEN_REGISTRY_KEY, doc)
    const registry = TokenConnectionRegistry.open(f.app),
      ui = new TokenUi(registry, f.secrets, f.transport, f.ui.reviews)
    restarted = new TokenEngines(f.app as unknown as App, ui, f.secrets.get, {
      fetch: f.transport,
      indexedDB: f.factory,
      WebSocket: class {
        constructor() {
          throw new Error('No test socket')
        }
      } as unknown as typeof WebSocket,
    })
    restarted.start()
    await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
    await ui.sync(id)
    expect(registry.records()[0]).toMatchObject({
      localRoot: 'Notes',
      ledgerId: before.ledgerId,
      scope: before.scope,
    })
    expect(registry.records()[0].rootIssue).toBeUndefined()
    expect(await f.app.vault.adapter.read('Notes/slow.txt')).toBe('ordinary note')
    f.transport.mockClear()
    await f.app.vault.adapter.write('Notes/slow.txt', 'edited after upgrade')
    await ui.sync(id)
    const ops = f.transport.mock.calls
      .filter(([url]) => new URL(String(url)).pathname === '/v2/commit')
      .flatMap(([, init]) => JSON.parse(String(init?.body)).ops)
    expect(ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: 'modify', file_id: expect.any(String) }),
      ])
    )
    expect(ops.some((op) => op.op === 'delete' || op.op === 'delete_directory')).toBe(false)
  } finally {
    f.release()
    await restarted?.close()
    await f.host.close()
    f.probe.mockRestore()
  }
})

it.each([false, true])(
  'explicitly follows a moved root with preserved copies without granting the old root access (native archive=%s)',
  async (nativeArchive) => {
    const { app, registry, ui, host, transport, release, encoded, makeHost } = inspectionFixture(
      false,
      'Notes'
    )
    try {
      release()
      await ui.connect(encoded)
      const id = registry.records()[0].id
      await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
      await ui.sync(id)
      const localBackup = connectionPrivateRoot(id) + '/recovery/sample.old'
      const backup = nativeArchive ? '/sample-vault/' + localBackup : localBackup
      if (nativeArchive)
        Object.assign(app.vault.adapter, { getFullPath: (path: string) => '/sample-vault/' + path })
      await app.vault.adapter.mkdir(connectionPrivateRoot(id) + '/recovery')
      await app.vault.adapter.write(localBackup, 'preserved sample')
      const foreign = {
        owner: 'other-connection',
        target: 'Private/other.md',
        backup: 'Private/other.old',
      }
      app.saveLocalStorage(RECOVERED_WRITES_KEY, [
        foreign,
        { owner: id, target: 'Notes/slow.txt', backup },
      ])
      await app.vault.rename(app.vault.getAbstractFileByPath('Notes')!, 'Moved')
      transport.mockClear()
      await expect(ui.sync(id)).rejects.toMatchObject({ code: 'scope_unavailable' })
      expect(transport).not.toHaveBeenCalled()
      await ui.runtimes.get(id)!.followRoot!()
      await ui.sync(id)
      expect(registry.records()[0].status).toBe('idle')
      expect(registry.records()[0].rootIssue).toBeUndefined()
      expect(await app.vault.adapter.read(localBackup)).toBe('preserved sample')
      expect(app.loadLocalStorage(RECOVERED_WRITES_KEY)).toContainEqual(foreign)
      expect(await app.vault.adapter.read('Moved/slow.txt')).toBe('ordinary note')
      expect(app.loadLocalStorage(RECOVERED_WRITES_KEY)).toContainEqual({
        owner: id,
        target: 'Moved/slow.txt',
        backup,
      })
      await host.close()
      const reopened = makeHost()
      try {
        reopened.start()
        // Enrollment intentionally remains blocked while retained recovery is unresolved.
        await vi.waitFor(() => expect(registry.records()[0].status).toBe('error'))
        expect(ui.runtimes.has(id)).toBe(false)
        expect(ui.activity.value[id].error).toContain('retained-byte recovery')
        expect(app.loadLocalStorage(RECOVERED_WRITES_KEY)).toContainEqual({
          owner: id,
          target: 'Moved/slow.txt',
          backup,
        })
        expect(await app.vault.adapter.read(localBackup)).toBe('preserved sample')
      } finally {
        await reopened.close()
      }
    } finally {
      release()
      await host.close()
    }
  }
)

it.each(['unfinished', 'foreign-backup'])(
  'keeps Follow stopped with %s recovery evidence',
  async (kind) => {
    const { app, registry, ui, host, transport, release, encoded } = inspectionFixture(
      false,
      'Notes'
    )
    try {
      release()
      await ui.connect(encoded)
      const id = registry.records()[0].id
      await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
      await ui.sync(id)
      const key = kind === 'unfinished' ? JOURNAL_KEY : RECOVERED_WRITES_KEY
      const evidence = [
        {
          owner: id,
          target: 'Notes/slow.txt',
          backup:
            kind === 'unfinished'
              ? connectionPrivateRoot(id) + '/recovery/sample.old'
              : 'Private/sample.old',
        },
      ]
      app.saveLocalStorage(key, evidence)
      await app.vault.rename(app.vault.getAbstractFileByPath('Notes')!, 'Moved')
      transport.mockClear()
      await expect(ui.runtimes.get(id)!.followRoot!()).rejects.toThrow(/recovery/)
      expect(registry.records()[0].rootIssue).toEqual({ kind: 'moved', path: 'Moved' })
      expect(registry.records()[0].localRoot).toBe('Notes')
      expect(app.loadLocalStorage(key)).toEqual(evidence)
      expect(transport).not.toHaveBeenCalled()
      expect(await app.vault.adapter.read('Moved/slow.txt')).toBe('ordinary note')
    } finally {
      release()
      await host.close()
    }
  }
)

it('explicitly follows a server rename with preserved copies while keeping local placement', async () => {
  const { app, registry, ui, host, release, encoded, scope } = inspectionFixture(false, 'Notes')
  try {
    release()
    await ui.connect(encoded)
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
    await ui.sync(id)
    const backup = connectionPrivateRoot(id) + '/recovery/sample.old'
    await app.vault.adapter.mkdir(connectionPrivateRoot(id) + '/recovery')
    await app.vault.adapter.write(backup, 'preserved sample')
    const evidence = [{ owner: id, target: 'Notes/slow.txt', backup }]
    app.saveLocalStorage(RECOVERED_WRITES_KEY, evidence)
    scope.path = 'Renamed'
    await expect(ui.sync(id)).rejects.toThrow(/renamed on the server/)
    expect(registry.records()[0].rootIssue?.kind).toBe('server-renamed')
    await ui.runtimes.get(id)!.followServerRoot!()
    await ui.sync(id)
    expect(registry.records()[0]).toMatchObject({
      status: 'idle',
      localRoot: 'Notes',
      serverRoot: 'Renamed',
    })
    expect(registry.records()[0].rootIssue).toBeUndefined()
    expect(app.loadLocalStorage(RECOVERED_WRITES_KEY)).toEqual(evidence)
    expect(await app.vault.adapter.read('Notes/slow.txt')).toBe('ordinary note')
    expect(await app.vault.adapter.read(backup)).toBe('preserved sample')
    expect(await app.vault.adapter.exists('Renamed')).toBe(false)
  } finally {
    release()
    await host.close()
  }
})

it.each(['foreign-owner', 'prefix-sibling', 'traversal'])(
  'keeps local Follow stopped for an unproven native archive: %s',
  async (kind) => {
    const { app, registry, ui, host, transport, release, encoded } = inspectionFixture(
      false,
      'Notes'
    )
    try {
      release()
      await ui.connect(encoded)
      const id = registry.records()[0].id
      await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
      await ui.sync(id)
      Object.assign(app.vault.adapter, { getFullPath: (path: string) => '/sample-vault/' + path })
      const archive = '/sample-vault/' + connectionPrivateRoot(id) + '/recovery'
      const backup =
        kind === 'foreign-owner'
          ? '/sample-vault/' + connectionPrivateRoot('other') + '/recovery/sample.old'
          : kind === 'prefix-sibling'
            ? archive + '-other/sample.old'
            : archive + '/../../Private/sample.old'
      const evidence = [{ owner: id, target: 'Notes/slow.txt', backup }]
      app.saveLocalStorage(RECOVERED_WRITES_KEY, evidence)
      await app.vault.rename(app.vault.getAbstractFileByPath('Notes')!, 'Moved')
      transport.mockClear()
      await expect(ui.runtimes.get(id)!.followRoot!()).rejects.toThrow()
      expect(registry.records()[0].rootIssue).toEqual({ kind: 'moved', path: 'Moved' })
      expect(registry.records()[0].localRoot).toBe('Notes')
      expect(app.loadLocalStorage(RECOVERED_WRITES_KEY)).toEqual(evidence)
      expect(transport).not.toHaveBeenCalled()
      expect(await app.vault.adapter.read('Moved/slow.txt')).toBe('ordinary note')
    } finally {
      release()
      await host.close()
    }
  }
)
