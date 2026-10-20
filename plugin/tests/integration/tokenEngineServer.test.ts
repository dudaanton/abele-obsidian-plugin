// @vitest-environment node
import { beforeAll, expect, it, vi } from 'vitest'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { AccessClient, MemoryStateStore, V2EngineClient, sha256 } from '@abele/sync-sdk/core'
import type { App } from 'obsidian'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { coordinatedFileSystem, PathCoordinator } from '@/sync/pathCoordinator'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { ignoreFor, scopeKey } from '@/sync/scope'
import { IDBFactory } from 'fake-indexeddb'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { TokenUi } from '@/sync/tokenUi'
import { TokenEngines } from '@/sync/tokenEngines'
import { openDeviceReviews } from '@/sync/openDeviceReviews'
import { desktopTransport } from '@/sync/desktopTransport'
import { nativeTokenFixture } from '../helpers/nativeTokenFixture'
import { resetSyncTokenState } from '@/testing/resetSyncTokenState'
import type { Plugin } from 'obsidian'
import { projectionPath } from '@/sync/external/projection'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { V2SyncClient } from '@abele/sync-server/tests/helpers/v2SyncClient.js'
import { createDb } from '@abele/sync-server/src/db/connect.js'
import { bumpGeneration } from '@abele/sync-server/src/restoreGeneration.js'
import { GENERATION_KEY, readReconciliation } from '@abele/sync-sdk/core'
import { JOURNAL_KEY } from '@/sync/writeJournal'
import { holdTokenDownload } from '@/testing/holdTokenDownload'

it('handshakes before startup write recovery and resumes ordinary sync with retired artifacts retained', async () => {
  const server = await v2Server(),
    factory = new IDBFactory()
  vi.stubGlobal('window', {
    indexedDB: factory,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  })
  vi.stubGlobal('document', { visibilityState: 'visible' })
  const app = buildFakeVault([{ path: 'sample.bin', content: 'current local bytes', mtime: 1000 }])
  let fixture: Awaited<ReturnType<typeof nativeTokenFixture>> | undefined
  let restarted: TokenEngines | undefined
  try {
    const user = await createUser(
      { db: server.db, pepper: server.config.tokenPepper },
      'Sample user',
      server.address
    )
    fixture = await nativeTokenFixture(app, user.token, globalThis.fetch, factory)
    await fixture.host.close()
    const temp = '.obsidian/plugins/abele/sync-staging/.abele-sync-abcd1234.tmp'
    const backup = '.obsidian/plugins/abele/sync-staging/.abele-sync-abcd1234.old'
    await app.vault.adapter.mkdir('.obsidian/plugins/abele/sync-staging')
    await app.vault.adapter.write(temp, 'pending obsolete bytes')
    await app.vault.adapter.write(backup, 'previous local bytes')
    app.saveLocalStorage(JOURNAL_KEY, [
      ...((app.loadLocalStorage(JOURNAL_KEY) as unknown[]) ?? []),
      { owner: fixture.id, target: 'sample.bin', temp, backup },
    ])
    await server.restart(async () => {
      const db = createDb(server.databaseUrl)
      try {
        await bumpGeneration(db.db)
      } finally {
        await db.close()
      }
    })
    restarted = new TokenEngines(
      app as unknown as App,
      fixture.ui,
      (reference) => fixture!.keys.get(reference) ?? null,
      {
        indexedDB: factory,
        fetch: globalThis.fetch,
        fallbackMs: 60000,
        pollMs: 60000,
        WebSocket: class {
          constructor() {
            throw new Error('Fixture uses polling')
          }
        } as never,
      }
    )
    restarted.start()
    await fixture.ui.connectionsChanged()
    await fixture.ui.sync(fixture.id)
    expect(app.loadLocalStorage(JOURNAL_KEY)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: 'sample.bin',
          temp,
          backup,
          retiredGeneration: expect.any(String),
        }),
      ])
    )
    expect(await app.vault.adapter.read('sample.bin')).toBe('current local bytes')
    expect(await app.vault.adapter.read(temp)).toBe('pending obsolete bytes')
    expect(await app.vault.adapter.read(backup)).toBe('previous local bytes')
    expect(fixture.ui.rows.value.find((row) => row.id === fixture!.id)?.status).toBe('idle')
  } finally {
    await restarted?.close()
    await fixture?.host.close()
    await server.close()
    vi.unstubAllGlobals()
  }
})

it.each(['server-generation', 'local-backup'] as const)(
  'preserves both binary variants across %s and a ledger restart',
  async (kind) => {
    const server = await v2Server()
    const factory = new IDBFactory()
    const path = 'й-folder/ё-data.bin'
    const physical = path.normalize('NFD')
    const app = buildFakeVault(
      [
        { path: physical, content: 'initial local bytes', mtime: 1000 },
        { path: 'keep.md', content: 'keep these bytes', mtime: 1000 },
      ],
      { sensitiveNames: true }
    )
    let state = await IndexedDbStateStore.open(factory, 'restore-sample-' + kind)
    let engine: TokenEngineRuntime | undefined
    try {
      const user = await createUser(
        { db: server.db, pepper: server.config.tokenPepper },
        'Sample user',
        server.address
      )
      const owner = new V2SyncClient(user.token)
      const statuses: import('@abele/sync-sdk/core').EngineStatus[] = []
      const make = () => {
        const metadata = new MemoryStateStore()
        return new TokenEngineRuntime({
          id: 'restore-sample',
          encoded: user.token,
          fs: coordinatedFileSystem(
            new ObsidianFileSystem(app as unknown as App, {
              ledger: state,
              preserveEmptyDirectories: true,
            }),
            new PathCoordinator()
          ),
          state,
          reviews: {
            executables: new ExecutableReview(metadata),
            attachments: new AttachmentConsent(metadata),
            close: () => {},
          },
          fetch: globalThis.fetch,
          changed: (status) => {
            statuses.push(structuredClone(status))
          },
          failed: () => {},
          covers: async () => false,
        })
      }
      engine = make()
      await engine.sync()
      const generation = await state.getMeta(GENERATION_KEY)
      const entry = (await state.get(physical))!
      const blob = await owner.upload(Buffer.from('newer remote bytes'))
      await owner.commit([
        {
          op: 'modify',
          file_id: entry.fileId,
          base_version_id: entry.versionId,
          ...blob,
          mtime: 5000,
        },
      ])
      const keep = (await state.get('keep.md'))!
      const journal = {
        batchId: 'stale-batch',
        idempotencyKey: crypto.randomUUID(),
        startedAt: new Date().toISOString(),
        ops: [{ op: 'delete' as const, file_id: keep.fileId, base_version_id: keep.versionId }],
      }
      await state.setJournal(journal)
      if (kind === 'server-generation') {
        // Keep the original bytes equal to the retired ledger digest: they still survive.
        await server.restart(async () => {
          const db = createDb(server.databaseUrl)
          try {
            await bumpGeneration(db.db)
          } finally {
            await db.close()
          }
        })
      } else {
        await app.vault.adapter.writeBinary(
          physical,
          new TextEncoder().encode('restored local bytes').buffer,
          { mtime: 1 }
        )
        await app.vault.adapter.remove('keep.md')
      }
      await engine.sync()
      if (kind === 'local-backup') {
        const held = await engine.heldDeletes()
        expect(held.map((one) => one.fileId)).toEqual([keep.fileId])
        expect((await readReconciliation(state))?.phase).toBe('review')
        // The existing held-delete review survives closing and reopening the ledger.
        await engine.disconnect()
        state.close()
        state = await IndexedDbStateStore.open(factory, 'restore-sample-' + kind)
        engine = make()
        expect((await engine.heldDeletes()).map((one) => one.fileId)).toEqual([keep.fileId])
        await engine.decideDeletes('restore', [keep.fileId])
        await engine.sync()
      }
      const expected = kind === 'server-generation' ? 'initial local bytes' : 'restored local bytes'
      const local = await Promise.all(
        app.vault.getFiles().map((file) => app.vault.adapter.read(file.path))
      )
      expect(local).toEqual(
        expect.arrayContaining([expected, 'newer remote bytes', 'keep these bytes'])
      )
      const items = (await owner.manifest()).items.filter((item) => item.kind !== 'directory')
      const remote = await Promise.all(
        items.map(async (item) => (await owner.content(item.file_id)).toString())
      )
      expect(remote).toEqual(
        expect.arrayContaining([expected, 'newer remote bytes', 'keep these bytes'])
      )
      expect(await state.getJournal()).toBeNull()
      if (kind === 'server-generation') {
        expect(await state.getMeta(GENERATION_KEY)).not.toBe(generation)
        expect(await state.getMeta('retired-generation:' + generation)).toContain(
          journal.idempotencyKey
        )
      } else {
        expect(
          await state.getMeta('reconciliation-journal:' + journal.idempotencyKey)
        ).not.toBeNull()
      }
      expect(
        statuses.some(
          (status) => status.reconciliation && status.reconciliation.phase !== 'complete'
        )
      ).toBe(true)
      const sweep = await state.getMeta('content-sweep-after')
      const count = (await server.db.selectFrom('versions').select('id').execute()).length
      await engine.disconnect()
      state.close()
      state = await IndexedDbStateStore.open(factory, 'restore-sample-' + kind)
      expect(await state.getMeta('content-sweep-after')).toBe(sweep)
      expect((await readReconciliation(state))?.phase).toBe('complete')
      engine = make()
      await engine.sync()
      expect((await server.db.selectFrom('versions').select('id').execute()).length).toBe(count)
      expect(await app.vault.adapter.exists(physical)).toBe(true)
    } finally {
      await engine?.disconnect()
      state.close()
      await server.close()
    }
  }
)

it('shows normalization collisions as pending refusals while unrelated files sync', async () => {
  const server = await v2Server()
  const factory = new IDBFactory()
  vi.stubGlobal('window', {
    indexedDB: factory,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  })
  let fixture: Awaited<ReturnType<typeof nativeTokenFixture>> | undefined
  const path = 'ё-note.md'
  const app = buildFakeVault(
    [
      { path, content: 'composed bytes' },
      { path: path.normalize('NFD'), content: 'decomposed bytes' },
      { path: 'unrelated.md', content: 'unrelated bytes' },
    ],
    { sensitiveNames: true }
  )
  try {
    const user = await createUser(
      { db: server.db, pepper: server.config.tokenPepper },
      'Sample user',
      server.address
    )
    expect(await app.vault.adapter.read(path)).toBe('composed bytes')
    fixture = await nativeTokenFixture(app, user.token, globalThis.fetch, factory)
    await fixture.ui.sync(fixture.id)
    const activity = fixture.ui.activity.value[fixture.id]
    expect(activity.pending).toBeGreaterThan(0)
    expect(activity.refused).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: expect.stringMatching(/normalization collision.*U\+/i) }),
      ])
    )
    expect(await app.vault.adapter.read(path)).toBe('composed bytes')
    expect(await app.vault.adapter.read(path.normalize('NFD'))).toBe('decomposed bytes')
    expect(
      (await new V2SyncClient(user.token).manifest()).items.some(
        (one) => one.path === 'unrelated.md'
      )
    ).toBe(true)
  } finally {
    await fixture?.host.close()
    await server.close()
    vi.unstubAllGlobals()
  }
})

it.each([
  { scoped: false, existing: 'empty' },
  { scoped: true, existing: 'empty' },
  { scoped: false, existing: 'same' },
  { scoped: false, existing: 'different' },
])(
  'syncs raw NFD names both ways and reloads their ledger (folder token=$scoped, existing=$existing)',
  async ({ scoped, existing }) => {
    const server = await v2Server()
    const factory = new IDBFactory()
    const folder = scoped ? 'Shared/й-folder' : 'й-folder'
    const path = folder + '/ё-note.md'
    const physical = path.normalize('NFD')
    const secondPath = existing === 'empty' ? path : folder.normalize('NFD') + '/ё-note.md'
    const apps = [
      buildFakeVault([{ path: physical, content: 'initial\nbytes\u0000' }], {
        sensitiveNames: true,
      }),
      buildFakeVault(
        existing === 'empty'
          ? []
          : [
              {
                path: secondPath,
                content: existing === 'same' ? 'initial\nbytes\u0000' : 'different local bytes',
              },
            ],
        { sensitiveNames: true }
      ),
    ]
    let states = await Promise.all(
      ['nfd-a', 'nfd-b'].map((name) => IndexedDbStateStore.open(factory, name))
    )
    let engines: TokenEngineRuntime[] = []
    try {
      const user = await createUser(
        { db: server.db, pepper: server.config.tokenPepper },
        'Sample user',
        server.address
      )
      const remote = new V2EngineClient(user.token, { fetch: globalThis.fetch })
      const inventory = new V2SyncClient(user.token)
      let encoded = user.token
      if (scoped) {
        // The selected physical root is exact; Unicode round trips happen inside it.
        await remote.commitRaw([{ op: 'mkdir', path: 'Shared' }], crypto.randomUUID())
        const directory = (await inventory.manifest()).items.find((one) => one.path === 'Shared')!
        encoded = (
          await AccessClient.fromToken(user.token, { fetch: globalThis.fetch }).issue({
            scope: { kind: 'folder', id: directory.file_id },
            label: 'sample folder',
          })
        ).token
      }
      const make = () =>
        apps.map((app, index) => {
          const metadata = new MemoryStateStore()
          return new TokenEngineRuntime({
            id: 'nfd-' + index,
            encoded,
            fs: coordinatedFileSystem(
              new ObsidianFileSystem(app as unknown as App, {
                fileScope: scoped ? 'Shared' : undefined,
                preserveEmptyDirectories: true,
                ledger: states[index],
              }),
              new PathCoordinator()
            ),
            state: states[index],
            reviews: {
              executables: new ExecutableReview(metadata),
              attachments: new AttachmentConsent(metadata),
              close: () => {},
            },
            fetch: globalThis.fetch,
            changed: () => {},
            failed: (error) => {
              throw error
            },
            covers: async () => false,
          })
        })
      engines = make()
      await apps[0].vault.adapter.mkdir(folder.normalize('NFD') + '/ё-empty'.normalize('NFD'))
      await apps[0].vault.adapter.mkdir('й-folder-other'.normalize('NFD'))
      await apps[0].vault.adapter.write(
        'й-folder-other/outside.md'.normalize('NFD'),
        'outside scope'
      )
      await engines[0].sync()
      await engines[1].sync()
      expect(new Uint8Array(await apps[1].vault.adapter.readBinary(secondPath))).toEqual(
        new Uint8Array(await apps[0].vault.adapter.readBinary(physical))
      )
      if (existing === 'different') {
        const copies = apps[1].vault
          .getFiles()
          .filter((file) => file.path.includes('(Conflicted copy local'))
        expect(copies).toHaveLength(1)
        expect(await apps[1].vault.adapter.read(copies[0].path)).toBe('different local bytes')
      }
      expect(
        await apps[1].vault.adapter.exists(
          (existing === 'empty' ? folder : folder.normalize('NFD')) + '/ё-empty'
        )
      ).toBe(true)
      if (scoped)
        expect(
          (await inventory.manifest()).items.some((one) => one.path.includes('outside.md'))
        ).toBe(false)
      await apps[1].vault.adapter.write(secondPath, 'edited from second\n\u0000', { mtime: 2000 })
      await engines[1].sync()
      await engines[0].sync()
      expect(new Uint8Array(await apps[0].vault.adapter.readBinary(physical))).toEqual(
        new Uint8Array(await apps[1].vault.adapter.readBinary(secondPath))
      )
      const before = (await inventory.manifest()).items
      const entry = await states[0].get(physical)
      expect(entry).not.toBeNull()
      await Promise.all(engines.map((one) => one.disconnect()))
      for (const state of states) state.close()
      states = await Promise.all(
        ['nfd-a', 'nfd-b'].map((name) => IndexedDbStateStore.open(factory, name))
      )
      expect(await states[0].get(physical)).toEqual(entry)
      expect(JSON.parse((await states[0].getMeta('v2-directories'))!).schemaVersion).toBe(2)
      await apps[0].vault.rename(
        apps[0].vault.getAbstractFileByPath(folder.normalize('NFD'))!,
        folder
      )
      const renamedFile = folder + '/ё-note.md'.normalize('NFD')
      await apps[0].vault.adapter.rename(renamedFile, path)
      engines = make()
      await engines[0].sync()
      await engines[1].sync()
      await engines[0].sync()
      expect((await inventory.manifest()).items).toEqual(before)
      expect(await engines[0].heldDeletes()).toEqual([])
      expect((await states[0].get(path))?.fileId).toBe(entry!.fileId)
      expect((await engines[0].entryFor(physical))?.path).toBe(path)
      const entries = []
      for await (const one of states[0].all()) entries.push(one)
      expect(entries.filter((one) => one.fileId === entry!.fileId)).toHaveLength(1)
    } finally {
      await Promise.all(engines.map((one) => one.disconnect()))
      for (const state of states) state.close()
      await server.close()
    }
  }
)

// The app's timer host is explicit; source type imports must not initialize it accidentally.
beforeAll(() => {
  const host = globalThis as unknown as Record<string, unknown>
  host.window ??= globalThis
})

it.each([false, true, 'touched', 'paged'])(
  'stages a remote executable deletion without revival after review and restart (approved=%s)',
  async (approved) => {
    const server = await v2Server(),
      user = await createUser(
        { db: server.db, pepper: server.config.tokenPepper },
        'Code review',
        server.address
      ),
      remote = new V2EngineClient(user.token, { fetch: globalThis.fetch }),
      app = buildFakeVault([]),
      fs = new ObsidianFileSystem(app as unknown as App),
      state = new MemoryStateStore(),
      reviews = {
        executables: new ExecutableReview(new MemoryStateStore()),
        attachments: new AttachmentConsent(new MemoryStateStore()),
        close: () => {},
      }
    const make = () =>
      new TokenEngineRuntime({
        id: 'review-test',
        encoded: user.token,
        fs,
        state,
        reviews,
        fetch: (input, init) => {
          const url = new URL(String(input))
          if (
            approved === 'paged' &&
            url.pathname === '/v2/changes' &&
            !url.searchParams.has('limit')
          )
            url.searchParams.set('limit', '1')
          return globalThis.fetch(url, init)
        },
        changed: () => {},
        failed: (error) => {
          throw error
        },
        covers: async () => false,
      })
    let engine = make()
    try {
      await engine.sync()
      const bytes = new TextEncoder().encode('// incoming code'),
        sha = await sha256(bytes)
      await remote.putBlob(sha, bytes)
      await remote.commitRaw(
        [{ op: 'create', path: 'Scripts/sample.js', sha, size: bytes.length, mtime: 1000 }],
        crypto.randomUUID()
      )
      await engine.sync()
      await engine.sync()
      if (approved)
        await reviews.executables.approve(
          (await reviews.executables.pending()).map((one) => one.id),
          engine
        )
      let file = (await remote.manifest()).items.find((one) => one.path === 'Scripts/sample.js')!
      await remote.commitRaw(
        [
          {
            op: 'move',
            file_id: file.file_id,
            base_version_id: file.version_id,
            to_path: 'Scripts/renamed.js',
          },
        ],
        crypto.randomUUID()
      )
      await engine.sync()
      await engine.sync()
      if (approved)
        await reviews.executables.approve(
          (await reviews.executables.pending()).map((one) => one.id),
          engine
        )
      await engine.disconnect()
      engine = make()
      if (approved === 'touched') await fs.writeAtomic('Scripts/renamed.js', bytes, 1001)
      if (approved === 'paged')
        await remote.commitRaw(
          [
            { op: 'mkdir', path: 'Other/one' },
            { op: 'mkdir', path: 'Other/two' },
          ],
          crypto.randomUUID()
        )
      file = (await remote.manifest()).items.find((one) => one.path === 'Scripts/renamed.js')!
      await remote.commitRaw(
        [{ op: 'delete', file_id: file.file_id, base_version_id: file.version_id }],
        crypto.randomUUID()
      )
      await engine.sync()
      await engine.sync()
      expect((await remote.manifest()).items.filter((one) => one.kind !== 'directory')).toEqual([])
      expect(
        (await reviews.executables.pending()).filter((one) => one.operation === 'delete')
      ).toMatchObject([{ path: 'Scripts/renamed.js', bytes: null }])
      expect(await fs.stat('Scripts/renamed.js')).toEqual(approved ? expect.anything() : null)
    } finally {
      await engine.disconnect()
      await server.close()
    }
  }
)

it('first root contact stages different existing hotkeys and exposes the review while Ready', async () => {
  const server = await v2Server(),
    factory = new IDBFactory()
  vi.stubGlobal('window', {
    indexedDB: factory,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  })
  vi.stubGlobal('document', { visibilityState: 'visible' })
  let fixture: Awaited<ReturnType<typeof nativeTokenFixture>> | undefined
  try {
    const user = await createUser(
      { db: server.db, pepper: server.config.tokenPepper },
      'Root settings',
      server.address
    )
    const remote = new V2EngineClient(user.token, { fetch: globalThis.fetch })
    const bytes = new TextEncoder().encode('{"remote":true}'),
      sha = await sha256(bytes)
    await remote.putBlob(sha, bytes)
    await remote.commitRaw(
      [{ op: 'create', path: '.obsidian/hotkeys.json', sha, size: bytes.length, mtime: 1000 }],
      crypto.randomUUID()
    )
    const app = buildFakeVault([{ path: '.obsidian/hotkeys.json', content: '{"local":true}' }])
    await app.vault.adapter.write('.abele-sync-ignore', '*\n!.obsidian/hotkeys.json\n')
    fixture = await nativeTokenFixture(app, user.token, globalThis.fetch, factory)
    await fixture.ui.sync(fixture.id)
    expect(await app.vault.adapter.read('.obsidian/hotkeys.json')).toBe('{"local":true}')
    await vi.waitFor(() =>
      expect(fixture!.port.settingsPrompt.asking.value?.changes).toMatchObject([
        { path: '.obsidian/hotkeys.json' },
      ])
    )
    expect(fixture.status.value.state).toBe('idle')
  } finally {
    await fixture?.host.close()
    await server.close()
    vi.unstubAllGlobals()
  }
})

it('a guarded pool reset and fixture cleanup after an unavailable offloaded source permit a fresh token connection', async () => {
  const servers = await Promise.all([v2Server(), v2Server()])
  const factory = new IDBFactory()
  vi.stubGlobal('window', {
    indexedDB: factory,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  })
  const app = buildFakeVault([])
  Object.assign(app.workspace, { iterateAllLeaves: () => {} })
  Object.assign(app.vault, { getName: () => 'leased-pool' })
  app.saveLocalStorage('abele-sync-device-review-id-v1', crypto.randomUUID())
  const users = await Promise.all(
    servers.map((server) =>
      createUser(
        { db: server.db, pepper: server.config.tokenPepper },
        'Sample user',
        server.address
      )
    )
  )
  const s = await nativeTokenFixture(app, users[0].token, globalThis.fetch, factory)
  const callbacks: (() => void)[] = []
  const owner = {
    app,
    tokenEngines: s.host,
    register: (callback: () => void) => callbacks.push(callback),
  }
  let stopped = false
  try {
    await app.vault.adapter.mkdir('Fixture')
    await app.vault.adapter.write('Fixture/sample.bin', 'retained server bytes')
    await s.ui.sync(s.id)
    await s.host.evict(s.id, 'Fixture/sample.bin')
    await servers[0].close()
    stopped = true
    await resetSyncTokenState(owner as unknown as Plugin, {
      vault: 'leased-pool',
      confirm: 'reset-sync-token-state',
    })
    // The reset must not delete notes, including the offload sidecar. Live teardown
    // separately removes only the synthetic directory owned by this case.
    expect(await app.vault.adapter.exists(projectionPath('Fixture/sample.bin'))).toBe(true)
    await app.vault.adapter.rmdir('Fixture', true)
    await s.ui.connect(users[1].token)
    const next = s.registry.records()[0]
    expect(next.address).toBe(servers[1].address)
    await s.ui.sync(next.id)
  } finally {
    await owner.tokenEngines.close()
    for (const close of callbacks) close()
    if (!stopped) await servers[0].close()
    await servers[1].close()
    vi.unstubAllGlobals()
  }
}, 15000)

it('connects two real servers before editing, then hydrates offloaded bytes from the surviving source', async () => {
  const servers = await Promise.all([v2Server(), v2Server()])
  const factory = new IDBFactory()
  vi.stubGlobal('window', {
    indexedDB: factory,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  })
  const app = buildFakeVault([])
  Object.assign(app.workspace, { iterateAllLeaves: () => {} })
  const users = await Promise.all(
    servers.map((server) =>
      createUser(
        { db: server.db, pepper: server.config.tokenPepper },
        'Sample user',
        server.address
      )
    )
  )
  const s = await nativeTokenFixture(app, users[0].token, globalThis.fetch, factory)
  let closedSecond = false
  try {
    await s.ui.connect(users[1].token)
    const second = s.registry.records().find((one) => one.id !== s.id)!.id
    await s.ui.sync(second)
    await app.vault.adapter.write('sample.bin', 'real attachment bytes')
    await s.ui.sync(s.id)
    await s.ui.sync(second)
    await s.host.evict(second, 'sample.bin')
    expect(await app.vault.adapter.exists('sample.bin')).toBe(false)
    await servers[1].close()
    closedSecond = true
    await s.host.hydrate('sample.bin')
    expect(await app.vault.adapter.read('sample.bin')).toBe('real attachment bytes')
  } finally {
    await s.host.close()
    await servers[0].close()
    if (!closedSecond) await servers[1].close()
    vi.unstubAllGlobals()
  }
}, 15000)

it.each([
  ['none', 'folder', false],
  ['parent', 'folder', false],
  ['folder', 'folder', false],
  ['none', 'root', false],
  ['none', 'folder', true],
  ['parent', 'folder', true],
  ['folder', 'folder', true],
] as const)(
  'connects and places nested folders while the index lags (local=%s, token=%s, native=%s)',
  async (local, kind, native) => {
    const existing = local === 'folder'
    const server = await v2Server()
    const factory = new IDBFactory()
    vi.stubGlobal('window', {
      indexedDB: factory,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    })
    const app = buildFakeVault([
      ...(local === 'none'
        ? []
        : [{ path: 'Fixtures/local.md', content: 'outside the folder token' }]),
      ...(existing ? [{ path: 'Fixtures/Shared/kept.md', content: 'kept' }] : []),
    ])
    if (native) {
      withDesktopFs(app)
      Object.assign(Reflect.get(app.vault.adapter, 'fsPromises'), {
        lstat: async (full: string) => {
          if (!(await app.vault.adapter.stat(full.slice('/vault/'.length))))
            throw Object.assign(new Error('missing'), { code: 'ENOENT' })
          return { isSymbolicLink: () => false }
        },
      })
    }
    Object.assign(app.workspace, { iterateAllLeaves: () => {} })
    // Obsidian indexes what the adapter creates later, from its file watcher: until then a
    // folder a pull just made is on disk and absent from the index.
    const indexed = new Set(['', ...app.vault.getFiles().map((one) => one.path)])
    if (local !== 'none') indexed.add('Fixtures')
    if (existing) indexed.add('Fixtures/Shared')
    const lookup = app.vault.getAbstractFileByPath.bind(app.vault)
    const files = app.vault.getFiles.bind(app.vault)
    app.vault.getAbstractFileByPath = (path: string) => (indexed.has(path) ? lookup(path) : null)
    app.vault.getFiles = () => files().filter((one) => indexed.has(one.path))
    const user = await createUser(
      { db: server.db, pepper: server.config.tokenPepper },
      'Sample user',
      server.address
    )
    const remote = new V2EngineClient(user.token, { fetch: globalThis.fetch })
    await remote.commitRaw(
      [
        { op: 'mkdir', path: 'Fixtures' },
        { op: 'mkdir', path: 'Fixtures/Shared' },
        { op: 'mkdir', path: 'Fixtures/Shared/Inner' },
        { op: 'mkdir', path: 'Fixtures/Shared/Inner/Empty' },
      ],
      crypto.randomUUID()
    )
    const bytes = new TextEncoder().encode('shared note'),
      sha = await sha256(bytes)
    await remote.putBlob(sha, bytes)
    await remote.commitRaw(
      [
        {
          op: 'create',
          path: 'Fixtures/Shared/Inner/note.md',
          sha,
          size: bytes.length,
          mtime: 1000,
        },
      ],
      crypto.randomUUID()
    )
    const folder = (await new V2SyncClient(user.token).manifest()).items.find(
      (one) => one.path === 'Fixtures/Shared'
    )!
    const encoded =
      kind === 'root'
        ? user.token
        : (
            await AccessClient.fromToken(user.token, { fetch: globalThis.fetch }).issue({
              scope: { kind: 'folder', id: folder.file_id },
              label: 'nested folder',
            })
          ).token
    const s = await nativeTokenFixture(app, encoded, globalThis.fetch, factory)
    try {
      expect(s.registry.records().find((one) => one.id === s.id)!.status).toBe('idle')
      expect(await app.vault.adapter.read('Fixtures/Shared/Inner/note.md')).toBe('shared note')
      expect(await app.vault.adapter.exists('Fixtures/Shared/Inner/Empty')).toBe(true)
      await app.vault.adapter.mkdir('Fixtures/Shared/Made here')
      // The index catches up with everything on disk before the next exchange.
      for (const path of [
        'Fixtures',
        'Fixtures/Shared',
        'Fixtures/Shared/Inner',
        'Fixtures/Shared/Inner/Empty',
        'Fixtures/Shared/Inner/note.md',
        'Fixtures/Shared/Made here',
      ])
        indexed.add(path)
      await s.syncNow()
      expect(
        (await new V2SyncClient(user.token).manifest()).items.some(
          (one) => one.path === 'Fixtures/Shared/Made here'
        )
      ).toBe(true)
    } finally {
      await s.host.close()
      await server.close()
      vi.unstubAllGlobals()
    }
  },
  20000
)

it.each([false, true])(
  'an empty nested folder made on one device appears on the other (accented root name=%s)',
  async (accented) => {
    const server = await v2Server()
    vi.stubGlobal('window', {
      indexedDB: new IDBFactory(),
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    })
    const extra = [
      ...(accented ? [{ path: 'Café.md'.normalize('NFD'), content: 'accented' }] : []),
      // The live fixture's rules: everything but its own folder is ignored.
      { path: '.abele-sync-ignore', content: '*\n!Fixtures/\n!Fixtures/**\n.obsidian/\n' },
    ]
    const apps = [
      buildFakeVault([{ path: 'Fixtures/shared/sample.md', content: 'one' }, ...extra], {
        sensitiveNames: true,
      }),
      buildFakeVault([...extra], { sensitiveNames: true }),
    ]
    for (const app of apps) {
      withDesktopFs(app)
      Object.assign(app.workspace, { iterateAllLeaves: () => {} })
      // Obsidian's root is '/', available through getRoot(), not an empty-path lookup.
      const root = app.vault.getRoot()
      const lookup = app.vault.getAbstractFileByPath.bind(app.vault)
      app.vault.getRoot = () => Object.assign(Object.create(root), { path: '/' })
      app.vault.getAbstractFileByPath = (path: string) => (path === '' ? null : lookup(path))
      // Obsidian announces every folder its adapter makes, parents included, as it indexes it.
      const mkdir = app.vault.adapter.mkdir.bind(app.vault.adapter)
      app.vault.adapter.mkdir = async (path: string) => {
        const parts = path.split('/')
        const fresh = []
        for (let length = 1; length <= parts.length; length++) {
          const prefix = parts.slice(0, length).join('/')
          if (!(await app.vault.adapter.exists(prefix))) fresh.push(prefix)
        }
        await mkdir(path)
        for (const one of fresh) {
          const folder = app.vault.getAbstractFileByPath(one)
          if (folder) app.emit('vault', 'create', folder)
        }
      }
      const createFolder = app.vault.createFolder.bind(app.vault)
      app.vault.createFolder = async (path: string) => {
        const parts = path.split('/')
        const fresh = []
        for (let length = 1; length <= parts.length; length++) {
          const prefix = parts.slice(0, length).join('/')
          if (!(await app.vault.adapter.exists(prefix))) fresh.push(prefix)
        }
        const made = await createFolder(path)
        for (const one of fresh) {
          const folder = app.vault.getAbstractFileByPath(one)
          if (folder) app.emit('vault', 'create', folder)
        }
        return made
      }
    }
    const user = await createUser(
      { db: server.db, pepper: server.config.tokenPepper },
      'Sample user',
      server.address
    )
    const devices = []
    try {
      for (const app of apps)
        devices.push(await nativeTokenFixture(app, user.token, globalThis.fetch, new IDBFactory()))
      await devices[1].syncNow()
      expect(await apps[1].vault.adapter.read('Fixtures/shared/sample.md')).toBe('one')
      const cycle = async () => {
        for (const device of [...devices, ...devices]) await device.syncNow()
      }
      // The same history the live case has: an edit, a rename on one side and a move on the other.
      await apps[1].vault.adapter.write('Fixtures/shared/sample.md', 'remote')
      await cycle()
      expect(await apps[0].vault.adapter.read('Fixtures/shared/sample.md')).toBe('remote')
      await apps[0].vault.rename(
        apps[0].vault.getFileByPath('Fixtures/shared/sample.md')!,
        'Fixtures/shared/renamed.md'
      )
      await cycle()
      await apps[1].vault.adapter.mkdir('Fixtures/moved')
      await apps[1].vault.rename(
        apps[1].vault.getFileByPath('Fixtures/shared/renamed.md')!,
        'Fixtures/moved/sample.md'
      )
      await cycle()
      expect(await apps[0].vault.adapter.read('Fixtures/moved/sample.md')).toBe('remote')
      for (const device of devices)
        expect(device.ui.activity.value[device.id]?.reconciliation?.phase ?? 'complete').toBe(
          'complete'
        )
      // The receiving index has not caught up with folders a pull makes there.
      const lookup = apps[1].vault.getAbstractFileByPath.bind(apps[1].vault)
      apps[1].vault.getAbstractFileByPath = (path: string) =>
        path.startsWith('Fixtures/empty') ? null : lookup(path)
      const parent = lookup('Fixtures') as unknown as { children: { path: string }[] }
      let real = parent.children
      Object.defineProperty(parent, 'children', {
        get: () => real.filter((one) => !one.path.startsWith('Fixtures/empty')),
        set: (value: { path: string }[]) => (real = value),
      })
      await apps[0].vault.createFolder('Fixtures/empty/child')
      await devices[0].syncNow()
      expect((await new V2SyncClient(user.token).manifest()).items.map((one) => one.path)).toEqual(
        expect.arrayContaining(['Fixtures/empty', 'Fixtures/empty/child'])
      )
      await devices[1].syncNow()
      await devices[1].syncNow()
      await devices[0].syncNow()
      expect(await apps[1].vault.adapter.exists('Fixtures/empty/child')).toBe(true)
      expect(await apps[0].vault.adapter.exists('Fixtures/empty/child')).toBe(true)
      await apps[0].vault.adapter.rmdir('Fixtures/empty', true)
      expect(await apps[0].vault.adapter.exists('Fixtures/empty')).toBe(false)
      await cycle()
      expect(await apps[1].vault.adapter.exists('Fixtures/empty')).toBe(false)
    } finally {
      for (const device of devices) await device.host.close()
      await server.close()
      vi.unstubAllGlobals()
    }
  },
  30000
)

it.each([true, false])(
  'hydrates through a held download while an edit lands and another connection transfers (original available=%s)',
  async (available) => {
    const servers = await Promise.all([v2Server(), v2Server()])
    const factory = new IDBFactory()
    vi.stubGlobal('window', {
      indexedDB: factory,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    })
    const app = buildFakeVault([])
    withDesktopFs(app)
    Object.assign(app.workspace, { iterateAllLeaves: () => {} })
    const users = await Promise.all(
      servers.map((server) =>
        createUser(
          { db: server.db, pepper: server.config.tokenPepper },
          'Sample user',
          server.address
        )
      )
    )
    const s = await nativeTokenFixture(app, users[0].token, globalThis.fetch, factory)
    try {
      await s.ui.connect(users[1].token)
      const other = s.registry.records().find((one) => one.id !== s.id)!.id
      await s.ui.sync(other)
      await app.vault.adapter.mkdir('Race')
      await app.vault.adapter.write('Race/race.bin', 'old retained version')
      await s.ui.sync(s.id)
      await s.ui.sync(other)
      expect(await s.host.evict(s.id, 'Race/race.bin')).toMatchObject({ status: 'complete' })
      await s.ui.pause(s.id, true)
      await s.ui.pause(other, true)
      const host = s.host as unknown as { live: Map<string, TokenEngineRuntime> }
      Reflect.set(host.live.get(s.id)!, 'serverAvailable', available)
      // The shared offload view may hydrate through either authorized provider.
      const gates = [s.id, other].map((id) =>
        holdTokenDownload(host.live.get(id)!, () => s.ui.runtimes.get(id)!.assertCurrent())
      )
      try {
        const opened = s.host.hydrate('Race/race.bin').then(
          () => true,
          () => false
        )
        await Promise.race([
          ...gates.map((gate) => gate.ready),
          opened.then((hydrated) => {
            throw new Error('hydration finished without downloading: ' + hydrated)
          }),
        ])
        await app.vault.create('Race/race.bin', 'newest local edit')
        await s.ui.pause(other, false)
        const transfer = host.live
          .get(other)!
          .sync()
          .catch(() => {})
        gates.forEach((gate) => gate.release())
        await opened
        await transfer
        expect(await app.vault.adapter.read('Race/race.bin')).toBe('newest local edit')
      } finally {
        gates.forEach((gate) => gate.close())
      }
    } finally {
      await s.host.close()
      await Promise.all(servers.map((server) => server.close()))
      vi.unstubAllGlobals()
    }
  },
  30000
)

it('holds all children of a deleted folder before any recursive directory commit, then restores them', async () => {
  const server = await v2Server()
  const app = buildFakeVault(
    Array.from({ length: 60 }, (_, i) => ({ path: 'Bulk/note-' + i + '.md', content: 'kept' }))
  )
  const fs = new ObsidianFileSystem(app as unknown as App, { preserveEmptyDirectories: true })
  const state = new MemoryStateStore(),
    metadata = new MemoryStateStore()
  const user = await createUser(
    { db: server.db, pepper: server.config.tokenPepper },
    'Sample user',
    server.address
  )
  const engine = new TokenEngineRuntime({
    id: 'bulk-connection',
    encoded: user.token,
    fs: coordinatedFileSystem(fs, new PathCoordinator()),
    state,
    reviews: {
      executables: new ExecutableReview(metadata),
      attachments: new AttachmentConsent(metadata),
      close: () => {},
    },
    fetch: globalThis.fetch,
    changed: () => {},
    failed: () => {},
    covers: async () => false,
  })
  try {
    await engine.sync()
    await app.vault.adapter.rmdir('Bulk', true)
    await engine.sync()
    const client = new V2EngineClient(user.token, { fetch: globalThis.fetch })
    expect((await client.manifest()).items.filter((one) => one.kind === 'note')).toHaveLength(60)
    const held = await engine.heldDeletes()
    expect(held).toHaveLength(60)
    await engine.decideDeletes(
      'restore',
      held.map((one) => one.fileId)
    )
    const files = []
    for await (const item of fs.list()) files.push(item)
    expect(files.filter((one) => one.path.startsWith('Bulk/'))).toHaveLength(60)
  } finally {
    await engine.disconnect()
    await server.close()
  }
})

it.each([false, true])(
  'the IndexedDB production host receives own code and notes with realistic configuration (narrowed=%s)',
  async (narrowed) => {
    const server = await v2Server(),
      factory = new IDBFactory()
    vi.stubGlobal('window', {
      indexedDB: factory,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    })
    const app = buildFakeVault([
      {
        path: '.obsidian/plugins/abele/main.js',
        content: '// installed Abele code\n' + 'x'.repeat(1024 * 1024),
      },
      ...Array.from({ length: 16 }, (_, i) => ({
        path: `.obsidian/plugins/sample-${i}/main.js`,
        content: '// installed code ' + i + '\n' + 'x'.repeat(512 * 1024),
      })),
      {
        path: '.obsidian/themes/Sample/theme.css',
        content: '/* theme */' + 'x'.repeat(256 * 1024),
      },
      { path: '.obsidian/workspace.json', content: '{"open":0}' },
    ])
    if (narrowed)
      await app.vault.adapter.write(
        '.abele-sync-ignore',
        '*\n!incoming.md\n!Group.md\n!member.md\n!private.bin\n!.obsidian/plugins/abele/incoming.js\n'
      )
    let workspaceEdits = 0
    const fetchPort = desktopTransport(undefined, {
      session: {
        fetch: async (input, init) => {
          if (String(input).includes('/v2/uploads/'))
            await app.vault.adapter.write(
              '.obsidian/workspace.json',
              JSON.stringify({ open: ++workspaceEdits }),
              { mtime: 1000 + workspaceEdits }
            )
          return globalThis.fetch(input, init)
        },
      },
      bytes: (buffer) => new Uint8Array(buffer),
      body: (buffer) => new Uint8Array(buffer),
      controller: () => new AbortController(),
    })
    const registry = TokenConnectionRegistry.open(app),
      keys = new Map<string, string>()
    const secrets = {
      get: (id: string) => keys.get(id) ?? null,
      set: (id: string, value: string) => {
        keys.set(id, value)
      },
      remove: (id: string) => {
        keys.delete(id)
      },
    }
    const reviews = await openDeviceReviews(factory, crypto.randomUUID())
    const ui = new TokenUi(registry, secrets, fetchPort, reviews)
    const host = new TokenEngines(app as unknown as App, ui, secrets.get, {
      indexedDB: factory,
      fetch: fetchPort,
      WebSocket: class {
        constructor() {
          throw new Error('No fixture socket')
        }
      } as unknown as typeof WebSocket,
    })
    const failures: unknown[] = []
    const errors = host as unknown as { failed(id: string, error: unknown): void }
    const failed = errors.failed.bind(host)
    vi.spyOn(errors, 'failed').mockImplementation((id, error) => {
      failures.push(error)
      failed(id, error)
    })
    try {
      const user = await createUser(
        { db: server.db, pepper: server.config.tokenPepper },
        'Sample user',
        server.address
      )
      const firstSyncStarted = performance.now()
      await ui.connect(user.token)
      const id = registry.records()[0].id
      await vi.waitFor(() => {
        expect(failures).toEqual([])
        expect(ui.runtimes.has(id), JSON.stringify(ui.activity.value)).toBe(true)
      })
      await ui.sync(id)
      if (narrowed) expect(workspaceEdits).toBe(0)
      else expect(workspaceEdits).toBeGreaterThan(10)
      console.info(
        'Realistic root first sync completed in',
        Math.round(performance.now() - firstSyncStarted),
        'ms'
      )
      const remote = new V2EngineClient(user.token, { fetch: globalThis.fetch })
      for (const [path, text] of [
        ['.obsidian/plugins/abele/incoming.js', '// staged code'],
        ['incoming.md', 'ordinary'],
      ]) {
        const bytes = new TextEncoder().encode(text),
          sha = await sha256(bytes)
        await remote.putBlob(sha, bytes)
        await remote.commitRaw(
          [{ op: 'create', path, sha, size: bytes.length, mtime: 2000 }],
          crypto.randomUUID()
        )
      }
      await ui.sync(id)
      expect((await reviews.executables.pending()).map((one) => one.path)).toContain(
        '.obsidian/plugins/abele/incoming.js'
      )
      expect(await app.vault.adapter.exists('.obsidian/plugins/abele/incoming.js')).toBe(false)
      expect(await app.vault.adapter.read('incoming.md')).toBe('ordinary')
      await ui.pause(id, true)
      await app.vault.adapter.write('private.bin', 'private bytes')
      for (const [path, text] of [
        ['Group.md', 'group'],
        ['member.md', '---\ngroups: ["[[Group]]"]\n---\nmember ![[private.bin]]'],
      ]) {
        const bytes = new TextEncoder().encode(text),
          sha = await sha256(bytes)
        await remote.putBlob(sha, bytes)
        await remote.commitRaw(
          [{ op: 'create', path, sha, size: bytes.length, mtime: 3000 }],
          crypto.randomUUID()
        )
      }
      const group = (await remote.manifest()).items.find((one) => one.path === 'Group.md')!
      const issued = await AccessClient.fromToken(user.token, { fetch: fetchPort }).issue({
        scope: { kind: 'group', id: group.file_id },
        label: 'group',
      })
      await ui.connect(issued.token)
      const second = registry.records().find((one) => one.id !== id)!.id
      await ui.sync(second)
      expect(ui.runtimes.size).toBe(2)
      expect(await app.vault.adapter.read('member.md')).toContain('member')
      expect(await reviews.attachments.pending()).toHaveLength(0)
      expect((await remote.manifest()).items.some((one) => one.path === 'private.bin')).toBe(false)
      await ui.opened('member.md')
      const questions = await reviews.attachments.pending()
      expect(questions).toHaveLength(1)
      await ui.decide(questions[0], true)
      await ui.sync(second)
      expect((await remote.manifest()).items.some((one) => one.path === 'private.bin')).toBe(true)
    } finally {
      await host.close()
      reviews.close()
      await server.close()
      vi.unstubAllGlobals()
    }
  },
  30000
)

it('completes root first sync with large installed plugins and a changing workspace, then stages own code without blocking notes', async () => {
  const server = await v2Server()
  const app = buildFakeVault([
    ...Array.from({ length: 16 }, (_, index) => ({
      path: `.obsidian/plugins/sample-${index}/main.js`,
      content: '// plugin ' + index + '\n' + 'x'.repeat(512 * 1024),
    })),
    { path: '.obsidian/themes/Sample/theme.css', content: '/* theme */' + 'x'.repeat(256 * 1024) },
    { path: '.obsidian/workspace.json', content: '{"open":0}' },
    { path: 'ordinary.md', content: 'ordinary' },
  ])
  const fs = new ObsidianFileSystem(app as unknown as App, { preserveEmptyDirectories: true })
  const state = new MemoryStateStore(),
    metadata = new MemoryStateStore()
  const reviews = {
    executables: new ExecutableReview(metadata),
    attachments: new AttachmentConsent(metadata),
    close: () => {},
  }
  const user = await createUser(
    { db: server.db, pepper: server.config.tokenPepper },
    'Sample user',
    server.address
  )
  let edits = 0
  const engine = new TokenEngineRuntime({
    id: 'root-realistic',
    encoded: user.token,
    fs: coordinatedFileSystem(fs, new PathCoordinator()),
    state,
    reviews,
    fetch: async (input, init) => {
      if (String(input).includes('/v2/uploads/')) {
        await app.vault.adapter.writeBinary(
          '.obsidian/workspace.json',
          new TextEncoder().encode(JSON.stringify({ open: ++edits })).buffer,
          { mtime: 1000 + edits }
        )
      }
      return globalThis.fetch(input, init)
    },
    scopeInput: async (selective) => ({
      key: await scopeKey(selective, null),
      ignore: ignoreFor('.obsidian', null),
    }),
    ownSettingsPath: '.obsidian/plugins/abele/data.json',
    changed: () => {},
    failed: (error) => {
      throw error
    },
    covers: async () => false,
  })
  try {
    await engine.sync()
    expect(edits).toBeGreaterThan(10)
    const client = new V2EngineClient(user.token, { fetch: globalThis.fetch })
    expect(
      (await client.manifest()).items.filter((one) => one.path.endsWith('/main.js'))
    ).toHaveLength(16)
    const bytes = new TextEncoder().encode('// reviewed own code'),
      sha = await sha256(bytes)
    await client.putBlob(sha, bytes)
    await client.commitRaw(
      [
        {
          op: 'create',
          path: '.obsidian/plugins/abele/incoming.js',
          sha,
          size: bytes.length,
          mtime: 2000,
        },
      ],
      crypto.randomUUID()
    )
    const note = new TextEncoder().encode('incoming ordinary'),
      hash = await sha256(note)
    await client.putBlob(hash, note)
    await client.commitRaw(
      [{ op: 'create', path: 'incoming.md', sha: hash, size: note.length, mtime: 2000 }],
      crypto.randomUUID()
    )
    await engine.sync()
    expect(
      (await reviews.executables.pending()).some(
        (one) => one.path === '.obsidian/plugins/abele/incoming.js'
      )
    ).toBe(true)
    expect(await fs.stat('.obsidian/plugins/abele/incoming.js')).toBeNull()
    expect(new TextDecoder().decode(await fs.read('incoming.md'))).toBe('incoming ordinary')
  } finally {
    await engine.disconnect()
    await server.close()
  }
}, 20000)

it('exchanges files through two production token engines, forwards an edit and resumes after restart', async () => {
  const servers = await Promise.all([v2Server(), v2Server()])
  const fs = new ObsidianFileSystem(buildFakeVault([]) as unknown as App, {
      preserveEmptyDirectories: true,
    }),
    locks = new PathCoordinator(),
    requests: string[] = []
  const state = [new MemoryStateStore(), new MemoryStateStore()]
  const metadata = new MemoryStateStore(),
    reviews = {
      executables: new ExecutableReview(metadata),
      attachments: new AttachmentConsent(metadata),
      close: () => {},
    }
  let engines: TokenEngineRuntime[] = []
  const fetchPort: typeof fetch = (input, init) => {
    requests.push(new URL(String(input)).pathname)
    return globalThis.fetch(input, init)
  }
  try {
    const users = await Promise.all(
      servers.map((server) =>
        createUser(
          { db: server.db, pepper: server.config.tokenPepper },
          'Sample user',
          server.address
        )
      )
    )
    const create = () =>
      users.map(
        (user, index) =>
          new TokenEngineRuntime({
            id: 'sample-connection-' + index,
            encoded: user.token,
            fs: coordinatedFileSystem(fs, locks),
            state: state[index],
            reviews,
            fetch: fetchPort,
            changed: () => {},
            failed: () => {},
            covers: async () => true,
          })
      )
    engines = create()
    await fs.writeAtomic('Shared/sample.md', new TextEncoder().encode('one\ntwo\n'), 1000)
    await engines[0].sync()
    await engines[1].sync()
    expect(await state[0].get('Shared/sample.md')).not.toBeNull()
    expect(await state[1].get('Shared/sample.md')).not.toBeNull()
    await fs.writeAtomic('Shared/sample.md', new TextEncoder().encode('ONE\ntwo\n'), 2000)
    await engines[0].sync()
    await engines[1].sync()
    await Promise.all(engines.map((one) => one.disconnect()))
    engines = create()
    await engines[0].sync()
    await engines[1].sync()
    expect(new TextDecoder().decode(await fs.read('Shared/sample.md'))).toBe('ONE\ntwo\n')
    expect((await state[0].get('Shared/sample.md'))?.sha).toBe(
      (await state[1].get('Shared/sample.md'))?.sha
    )
    expect(requests.every((path) => path.startsWith('/v2/'))).toBe(true)
  } finally {
    await Promise.all(engines.map((one) => one.disconnect()))
    await Promise.all(servers.map((one) => one.close()))
  }
})
