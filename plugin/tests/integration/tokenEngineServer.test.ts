// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { AccessClient, MemoryStateStore, V2EngineClient, sha256 } from '@abele/sync-core'
import type { App } from 'obsidian'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
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

it('the IndexedDB production host receives own executable code and ordinary notes without a stuck sync', async () => {
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
    ...Array.from({ length: 16 }, (_, i) => ({
      path: `.obsidian/plugins/sample-${i}/main.js`,
      content: '// installed code ' + i + '\n' + 'x'.repeat(512 * 1024),
    })),
    { path: '.obsidian/themes/Sample/theme.css', content: '/* theme */' + 'x'.repeat(256 * 1024) },
    { path: '.obsidian/workspace.json', content: '{"open":0}' },
  ])
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
    expect(workspaceEdits).toBeGreaterThan(10)
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
}, 30000)

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
