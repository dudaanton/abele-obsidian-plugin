// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Platform } from 'obsidian'
import { IDBFactory } from 'fake-indexeddb'
import { V2EngineClient, AccessClient } from '@abele/sync-sdk/core'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { create, seed, shaOf } from '@abele/sync-test-seed'
import { buildFakeVault, type FakeFileSpec } from '../helpers/fakeVault'
import { nativeTokenFixture } from '../helpers/nativeTokenFixture'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { TokenUi, tokenUi } from '@/sync/tokenUi'
import { TokenEngines } from '@/sync/tokenEngines'
import { TokenSettingsPort } from '@/sync/tokenSettingsPort'
import { runAfterSync } from '@/helpers/runAfterSync'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'

let server: Awaited<ReturnType<typeof v2Server>>, encoded: string, remote: V2EngineClient
const hosts: Awaited<ReturnType<typeof nativeTokenFixture>>[] = []
beforeAll(() => {
  const global = globalThis as unknown as Record<string, unknown>
  global.window ??= globalThis
  global.document ??= { visibilityState: 'visible' }
})
beforeEach(async () => {
  Platform.isMobile = false
  server = await v2Server()
  encoded = (
    await createUser(
      { db: server.db, pepper: server.config.tokenPepper },
      'Sample user',
      server.address
    )
  ).token
  remote = new V2EngineClient(encoded, { fetch: globalThis.fetch })
})
afterEach(async () => {
  tokenUi.value = null
  for (const one of hosts.splice(0).reverse()) await one.destroy()
  await server.close()
  Platform.isMobile = false
  vi.restoreAllMocks()
})
async function connect(
  specs: FakeFileSpec[] = [],
  transport = globalThis.fetch,
  factory = new IDBFactory()
) {
  const app = buildFakeVault(specs),
    one = await nativeTokenFixture(app, encoded, transport, factory)
  hosts.push(one)
  return { ...one, app, factory }
}
const paths = async () => (await remote.manifest(null)).items.map((item) => item.path)
describe('native token service', () => {
  it('connects without account enrolment and downloads the accessible vault', async () => {
    await seed(remote, [await create(remote, 'Remote.md', 'remote bytes')])
    const one = await connect()
    expect(await one.app.vault.adapter.read('Remote.md')).toBe('remote bytes')
    expect(one.ui.available.value).toBe(true)
    expect(one.status.value.state).toBe('idle')
  })
  it('stores credentials in the keychain and connection and ledger identity only on the device', async () => {
    const one = await connect([
        { path: '.obsidian/plugins/abele/data.json', content: '{"tasksFolder":"Tasks"}' },
      ]),
      record = one.registry.records()[0]
    expect(one.keys.get(record.secretReference)).toHaveLength(43)
    const settings = await one.app.vault.adapter.read('.obsidian/plugins/abele/data.json')
    for (const privateValue of [
      encoded,
      one.keys.get(record.secretReference)!,
      record.secretReference,
      record.ledgerId,
    ])
      expect(settings).not.toContain(privateValue)
    expect(record).not.toHaveProperty('key')
    expect(record).not.toHaveProperty('token')
  })
  it('sends a newly created ordinary note to the server', async () => {
    const one = await connect()
    await one.app.vault.adapter.write('Created.md', 'local content')
    await one.syncNow()
    expect(await paths()).toContain('Created.md')
    expect(
      (await remote.manifest(null)).items.find((item) => item.path === 'Created.md')?.sha
    ).toBe(await shaOf('local content'))
  })
  it('sends its own settings but never its local chat index or token ledger', async () => {
    await connect([
      { path: '.obsidian/plugins/abele/data.json', content: '{}' },
      { path: '.obsidian/plugins/abele/chat-index.json', content: 'private index' },
      { path: '.abele-sync/private.json', content: 'local state' },
    ])
    expect(await paths()).toContain('.obsidian/plugins/abele/data.json')
    expect(await paths()).not.toContain('.obsidian/plugins/abele/chat-index.json')
    expect(await paths()).not.toContain('.abele-sync/private.json')
  })
  it('passes through syncing and returns to idle with a completion time', async () => {
    const one = await connect(),
      seen: string[] = []
    const set = one.registry.setStatus.bind(one.registry)
    vi.spyOn(one.registry, 'setStatus').mockImplementation((id, status) => {
      seen.push(status)
      return set(id, status)
    })
    await one.syncNow()
    expect(seen).toContain('syncing')
    expect(one.status.value.state).toBe('idle')
    expect(one.status.value.lastSyncAt).not.toBeNull()
  })
  it('offline exchange preserves local bytes and resumes when transport returns', async () => {
    let offline = false
    const transport: typeof fetch = (input, init) =>
      offline ? Promise.reject(new TypeError('sample disconnected')) : globalThis.fetch(input, init)
    const one = await connect([], transport)
    offline = true
    await one.app.vault.adapter.write('Pending.md', 'unsent bytes')
    await expect(one.syncNow()).rejects.toThrow()
    expect(one.status.value.state).toBe('offline')
    expect(await one.app.vault.adapter.read('Pending.md')).toBe('unsent bytes')
    offline = false
    await one.syncNow()
    expect(await paths()).toContain('Pending.md')
    expect(one.status.value.state).toBe('idle')
  })
  it('revocation closes exchange without deleting local files or disabling a different token', async () => {
    const access = AccessClient.fromToken(encoded, { fetch: globalThis.fetch }),
      issued = await access.issue({
        scope: { kind: 'folder', id: (await access.connection()).scope.id },
        label: 'Sample device',
      })
    const one = await connect([{ path: 'Kept.md', content: 'kept' }])
    await access.revoke((await access.connection()).token_id)
    await one.app.vault.adapter.write('Pending.md', 'pending')
    await expect(one.syncNow()).rejects.toThrow()
    expect(await one.app.vault.adapter.read('Kept.md')).toBe('kept')
    expect(await one.app.vault.adapter.read('Pending.md')).toBe('pending')
    expect(
      (await AccessClient.fromToken(issued.token, { fetch: globalThis.fetch }).connection()).status
    ).toBe('active')
  })
  it('paused manual exchange sends nothing and resume sends the retained edit', async () => {
    const one = await connect()
    await one.pause()
    await one.app.vault.adapter.write('Paused.md', 'waiting')
    await expect(one.syncNow()).rejects.toThrow(/paused/i)
    expect(await paths()).not.toContain('Paused.md')
    await one.resume()
    await one.syncNow()
    expect(await paths()).toContain('Paused.md')
  })
  it('selective changes are device-local and widening rewalks a previously skipped file without disconnection', async () => {
    const one = await connect(),
      record = one.registry.records()[0],
      seen: string[] = []
    await one.ui.updateConnection(one.id, { selective: { ...record.selective, pdf: false } })
    await seed(remote, [await create(remote, 'sample.pdf', 'document bytes')])
    await one.syncNow()
    expect(await one.app.vault.adapter.exists('sample.pdf')).toBe(false)
    const set = one.registry.setStatus.bind(one.registry)
    vi.spyOn(one.registry, 'setStatus').mockImplementation((id, status) => {
      seen.push(status)
      return set(id, status)
    })
    await one.ui.updateConnection(one.id, { selective: record.selective })
    expect(await one.app.vault.adapter.read('sample.pdf')).toBe('document bytes')
    expect(seen).not.toContain('disconnected')
    expect(one.registry.records()[0].selective).toEqual(record.selective)
  })
  it('rejects malformed selective settings without writing or replacing the live engine', async () => {
    const one = await connect(),
      before = one.registry.records(),
      runtime = one.ui.runtimes.get(one.id)
    await expect(
      one.ui.updateConnection(one.id, { selective: { pdf: 'yes' } as never })
    ).rejects.toThrow()
    expect(one.registry.records()).toEqual(before)
    expect(one.ui.runtimes.get(one.id)).toBe(runtime)
  })
  it('disconnect removes only this credential, keeps local files and retained ledger evidence', async () => {
    const one = await connect([{ path: 'Local.md', content: 'local bytes' }]),
      record = one.registry.records()[0]
    await one.ui.disconnect(one.id)
    expect(one.registry.records()).toEqual([])
    expect(one.keys.size).toBe(0)
    expect(one.ui.available.value).toBe(false)
    expect(await one.app.vault.adapter.read('Local.md')).toBe('local bytes')
    expect(await one.factory.databases()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: record.ledgerId })])
    )
  })
  it('same-token reconnect reuses its keychain entry and device-only ledger', async () => {
    const one = await connect(),
      record = one.registry.records()[0],
      keys = [...one.keys]
    await one.ui.connect(encoded)
    expect(one.registry.records()).toHaveLength(1)
    expect(one.registry.records()[0].ledgerId).toBe(record.ledgerId)
    expect([...one.keys]).toEqual(keys)
  })
  it('path lookup returns stable server identity only for files this connection has exchanged', async () => {
    const one = await connect([{ path: 'sample.md', content: 'sample bytes' }]),
      file = (await remote.manifest(null)).items.find((item) => item.path === 'sample.md')!
    expect(await one.ui.runtimes.get(one.id)!.entryFor!('sample.md')).toMatchObject({
      fileId: file.file_id,
      versionId: file.version_id,
    })
    expect(await one.ui.runtimes.get(one.id)!.entryFor!('unknown.md')).toBeNull()
  })
  it('per-connection log keeps its last five hundred lines', async () => {
    const one = await connect(),
      port = TokenSettingsPort.forConnection(one.ui, one.id, one.app as never)
    for (let index = 0; index < 600; index++) port.note('sample line ' + index)
    expect(port.log.value).toHaveLength(500)
    expect(port.log.value[0]).toBe('sample line 100')
    expect(port.log.value.at(-1)).toBe('sample line 599')
  })
  it('an unconfigured device runs no exchange and gives a clear manual-sync refusal', async () => {
    const app = buildFakeVault([]),
      fetcher = vi.fn(),
      ui = new TokenUi(
        TokenConnectionRegistry.open(app),
        { get: () => null, set: () => {}, remove: () => {} },
        fetcher
      )
    const host = new TokenEngines(app as never, ui, () => null, {
      indexedDB: new IDBFactory(),
      fetch: fetcher,
    })
    host.start()
    await ui.connectionsChanged()
    await expect(ui.sync('unknown')).rejects.toThrow(/paused|connect/i)
    expect(ui.rows.value).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
    await host.close()
  })
  it('different local vaults cannot read or certify each other’s ledger', async () => {
    const first = await connect([{ path: 'First.md', content: 'first' }]),
      next = await connect(),
      a = first.registry.records()[0],
      b = next.registry.records()[0]
    expect(a.ledgerId).not.toBe(b.ledgerId)
    const inspect = await IndexedDbStateStore.open(next.factory, a.ledgerId)
    try {
      expect(await inspect.get('First.md')).toBeNull()
      expect(await inspect.getMeta('token-engine-identity-v2')).toBeNull()
    } finally {
      inspect.close()
    }
  })
  it('a copied settings file cannot import a live token, credential reference or ledger', async () => {
    const first = await connect(),
      record = first.registry.records()[0]
    const app = buildFakeVault([
        {
          path: '.obsidian/plugins/abele/data.json',
          content: JSON.stringify({ sync: record, token: encoded, stateId: record.ledgerId }),
        },
      ]),
      registry = TokenConnectionRegistry.open(app)
    expect(registry.records()).toEqual([])
    expect(first.registry.records()[0].ledgerId).toBe(record.ledgerId)
  })
  it('refuses non-local plain HTTP tokens before sending credentials and leaves existing connections intact', async () => {
    const one = await connect(),
      before = one.registry.records(),
      transport = vi.fn(),
      ui = new TokenUi(
        one.registry,
        { get: (id) => one.keys.get(id) ?? null, set: () => {}, remove: () => {} },
        transport
      )
    await expect(
      ui.connect(
        btoa(
          JSON.stringify({
            v: 1,
            address: 'http://remote.example',
            key: 'a'.repeat(43),
            scope: { kind: 'folder', id: 'sample-root', path: '/' },
          })
        )
      )
    ).rejects.toThrow()
    expect(transport).not.toHaveBeenCalled()
    expect(one.registry.records()).toEqual(before)
  })
  it('honours the vault ignore file before scanning or uploading any ordinary bytes', async () => {
    await connect([
      { path: '.abele-sync-ignore', content: 'Private/\n' },
      { path: 'Private/sample.md', content: 'private' },
      { path: 'Public.md', content: 'public' },
    ])
    expect(await paths()).toContain('Public.md')
    expect(await paths()).not.toContain('Private/sample.md')
  })
  it('does not download or delete a hidden server file', async () => {
    await seed(remote, [await create(remote, 'sample.md', 'hidden server bytes')])
    const transport: typeof fetch = async (input, init) => {
      const response = await globalThis.fetch(input, init)
      if (String(input).includes('/v2/manifest')) {
        const page = await response.json()
        page.items = page.items.map((item: { path: string }) => ({
          ...item,
          path: '.hidden/' + item.path,
        }))
        return Response.json(page)
      }
      return response
    }
    const one = await connect([], transport)
    expect(await one.app.vault.adapter.exists('.hidden/sample.md')).toBe(false)
    expect(await paths()).toContain('sample.md')
  })
  it('runAfterSync waits for all token connections and runs once after settlement', async () => {
    const one = await connect()
    tokenUi.value = one.ui
    one.registry.setStatus(one.id, 'joining')
    one.ui.refresh()
    const ran = vi.fn()
    runAfterSync(one.app as never, ran)
    expect(ran).not.toHaveBeenCalled()
    await one.syncNow()
    expect(ran).toHaveBeenCalledOnce()
    await one.syncNow()
    expect(ran).toHaveBeenCalledOnce()
  })
  it('mobile transport opens no WebSocket while edits still use the production engine', async () => {
    Platform.isMobile = true
    const one = await connect([{ path: 'Mobile.md', content: 'mobile bytes' }])
    expect(await paths()).toContain('Mobile.md')
    await one.app.vault.adapter.write('Mobile.md', 'changed mobile bytes')
    await one.syncNow()
    expect((await remote.manifest(null)).items.find((item) => item.path === 'Mobile.md')?.sha).toBe(
      await shaOf('changed mobile bytes')
    )
  })
  it('re-reads edited ignore rules, widens reception and never deletes a file hidden while offline', async () => {
    const one = await connect([{ path: '.abele-sync-ignore', content: 'Private/\n' }])
    await seed(remote, [await create(remote, 'Private/sample.md', 'server private bytes')])
    await one.syncNow()
    expect(await one.app.vault.adapter.exists('Private/sample.md')).toBe(false)
    await one.app.vault.adapter.write('.abele-sync-ignore', '')
    await one.syncNow()
    expect(await one.app.vault.adapter.read('Private/sample.md')).toBe('server private bytes')
    await one.app.vault.adapter.write('.abele-sync-ignore', 'Private/\n')
    await one.app.vault.adapter.remove('Private/sample.md')
    await one.syncNow()
    expect(await paths()).toContain('Private/sample.md')
    expect(await remote.trash()).toEqual([])
  })
  it('an unreadable ignore file blocks exchange before transport and retry reads the restored rules', async () => {
    const one = await connect([{ path: '.abele-sync-ignore', content: 'Private/\n' }]),
      send = vi.spyOn(globalThis, 'fetch'),
      read = one.app.vault.adapter.readBinary.bind(one.app.vault.adapter)
    await one.app.vault.adapter.mkdir('Private')
    await one.app.vault.adapter.write('Private/sample.md', 'private bytes')
    let locked = true
    vi.spyOn(one.app.vault.adapter, 'readBinary').mockImplementation((path) =>
      locked && path === '.abele-sync-ignore'
        ? Promise.reject(new Error('sample locked ignore file'))
        : read(path)
    )
    await expect(one.syncNow()).rejects.toThrow(/ignore|locked/i)
    expect(send).not.toHaveBeenCalled()
    locked = false
    await one.syncNow()
    expect(await paths()).not.toContain('Private/sample.md')
  })
  it('scope identity includes the exact ignore input in the device ledger', async () => {
    const one = await connect([{ path: '.abele-sync-ignore', content: 'Private/\n' }]),
      record = one.registry.records()[0],
      store = await IndexedDbStateStore.open(one.factory, record.ledgerId)
    try {
      const { scopeKey } = await import('@/sync/scope')
      expect(await store.getMeta('scope')).toBe(await scopeKey(record.selective, 'Private/\n'))
    } finally {
      store.close()
    }
  })
  it('phone foreground resumes receiving and leaving foreground sends the last unreported edit', async () => {
    Platform.isMobile = true
    const one = await connect()
    await seed(remote, [await create(remote, 'Incoming.md', 'incoming bytes')])
    await one.host.foreground(true)
    expect(await one.app.vault.adapter.read('Incoming.md')).toBe('incoming bytes')
    await one.app.vault.adapter.write('Leaving.md', 'last local bytes')
    await one.host.foreground(false)
    expect(await paths()).toContain('Leaving.md')
  })
  it('phone polling receives remote changes without leaving foreground or a socket', async () => {
    Platform.isMobile = true
    const app = buildFakeVault([]),
      one = await nativeTokenFixture(app, encoded, globalThis.fetch, undefined, undefined, false, {
        fallbackMs: 100,
      })
    hosts.push(one)
    await seed(remote, [await create(remote, 'Polled.md', 'polled bytes')])
    await vi.waitFor(async () =>
      expect(await app.vault.adapter.read('Polled.md')).toBe('polled bytes')
    )
  })
  it('startup announcement holds a callback before layout-ready and an empty device holds nothing', async () => {
    const one = await connect()
    tokenUi.value = one.ui
    one.host.announce()
    const ran = vi.fn()
    runAfterSync(one.app as never, ran)
    expect(ran).not.toHaveBeenCalled()
    await one.syncNow()
    expect(ran).toHaveBeenCalledOnce()
    tokenUi.value = null
    const empty = vi.fn()
    runAfterSync(buildFakeVault([]) as never, empty)
    expect(empty).toHaveBeenCalledOnce()
  })
  it.each([true, false])(
    'a pause decision changed to %s during ledger construction reaches the new engine',
    async (paused) => {
      const { tokenBuildFixture } = await import('../helpers/tokenBuildFixture'),
        fixture = await tokenBuildFixture()
      fixture.registry.setPaused(fixture.id, !paused)
      fixture.store.close()
      const open = IndexedDbStateStore.open.bind(IndexedDbStateStore)
      let release!: () => void, enter!: () => void
      const hold = new Promise<void>((resolve) => {
          release = resolve
        }),
        entered = new Promise<void>((resolve) => {
          enter = resolve
        })
      vi.spyOn(IndexedDbStateStore, 'open').mockImplementationOnce(async (...args) => {
        const store = await open(...args)
        enter()
        await hold
        return store
      })
      const building = fixture.build()
      await entered
      fixture.registry.setPaused(fixture.id, paused)
      release()
      try {
        const built = await building
        expect(built.engine.status.state).toBe(paused ? 'paused' : 'idle')
        expect(fixture.registry.records()[0].paused).toBe(paused)
      } finally {
        await fixture.close()
      }
    }
  )
  it('an overridden configuration folder and the old wire folder stay untouched', async () => {
    await seed(remote, [await create(remote, '.obsidian/app.json', '{"remote":true}')])
    const app = buildFakeVault([{ path: '.custom/app.json', content: '{"private":true}' }])
    app.vault.configDir = '.custom'
    const one = await nativeTokenFixture(app, encoded, globalThis.fetch)
    hosts.push(one)
    expect(await app.vault.adapter.read('.custom/app.json')).toBe('{"private":true}')
    expect(await app.vault.adapter.exists('.obsidian/app.json')).toBe(false)
    expect(await paths()).not.toContain('.custom/app.json')
    expect(await remote.trash()).toEqual([])
  })
  it('a vault create event uploads on the phone while it remains in foreground', async () => {
    Platform.isMobile = true
    const one = await connect()
    await one.app.vault.adapter.write('Created-on-mobile.md', 'mobile event bytes')
    one.app.emit('vault', 'create', one.app.vault.getAbstractFileByPath('Created-on-mobile.md'))
    await vi.waitFor(async () => expect(await paths()).toContain('Created-on-mobile.md'), {
      timeout: 3000,
    })
  })
  it('a scripts-folder change rebuilds only once and reviews code in the new folder', async () => {
    const one = await connect(),
      record = one.registry.records()[0],
      open = vi.spyOn(IndexedDbStateStore, 'open')
    await one.host.updateScriptsFolder('Automation')
    await one.syncNow()
    expect(open.mock.calls.filter(([, name]) => name === record.ledgerId)).toHaveLength(1)
    expect(one.registry.records()[0].ledgerId).toBe(record.ledgerId)
    await one.host.updateScriptsFolder('Automation')
    expect(open.mock.calls.filter(([, name]) => name === record.ledgerId)).toHaveLength(1)
    await seed(remote, [await create(remote, 'Automation/sample.txt', 'executable source')])
    await one.syncNow()
    expect(await one.app.vault.adapter.exists('Automation/sample.txt')).toBe(false)
    expect(await one.ui.reviews!.executables.pending()).toMatchObject([
      { path: 'Automation/sample.txt' },
    ])
  })
  it('counts five unsent local edits even when the first engine server-state request fails', async () => {
    let requests = 0
    const transport: typeof fetch = (input, init) =>
      String(input).includes('/v2/connection') && ++requests > 1
        ? Promise.reject(new TypeError('sample server unavailable'))
        : globalThis.fetch(input, init)
    const app = buildFakeVault(
      Array.from({ length: 5 }, (_, index) => ({
        path: `sample-${index}.md`,
        content: 'unsent bytes',
        mtime: 1000,
      }))
    )
    const one = await nativeTokenFixture(app, encoded, transport, undefined, undefined, false, {
      waitForIdle: false,
    })
    hosts.push(one)
    await vi.waitFor(() => expect(one.status.value.state).toBe('offline'))
    await vi.waitFor(() => expect(one.status.value.pending).toBe(5))
    expect(app.vault.getFiles()).toHaveLength(5)
  })
})
