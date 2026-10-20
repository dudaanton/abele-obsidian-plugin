// @vitest-environment node
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { V2EngineClient } from '@abele/sync-sdk/core'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { create, seed, shaOf } from '@abele/sync-test-seed'
import { buildFakeVault } from '../helpers/fakeVault'
import { nativeTokenFixture } from '../helpers/nativeTokenFixture'
let server: Awaited<ReturnType<typeof v2Server>>, token: string, remote: V2EngineClient
beforeAll(() => {
  const global = globalThis as unknown as Record<string, unknown>
  global.window ??= globalThis
  global.document ??= { visibilityState: 'visible' }
})
const hosts: Awaited<ReturnType<typeof nativeTokenFixture>>[] = []
beforeEach(async () => {
  server = await v2Server()
  token = (
    await createUser(
      { db: server.db, pepper: server.config.tokenPepper },
      'Sample user',
      server.address
    )
  ).token
  remote = new V2EngineClient(token, { fetch: globalThis.fetch })
})
afterEach(async () => {
  for (const host of hosts.splice(0).reverse()) await host.destroy()
  await server.close()
})
async function join(
  app: ReturnType<typeof buildFakeVault>,
  factory = new IDBFactory(),
  transport = globalThis.fetch,
  retry = false
) {
  const host = await nativeTokenFixture(app, token, transport, factory, undefined, retry)
  hosts.push(host)
  return host
}
it('filled server reaches the empty vault and a restart sends no deletes before indexing', async () => {
  await seed(remote, [await create(remote, 'Nested/sample.md', 'server bytes', 1000)])
  const app = buildFakeVault([]),
    factory = new IDBFactory(),
    first = await join(app, factory)
  expect(await app.vault.adapter.read('Nested/sample.md')).toBe('server bytes')
  const identity = first.registry.records()[0]
  await first.destroy()
  const next = await join(app, factory)
  await next.syncNow()
  expect(next.registry.records()[0].ledgerId).toBe(identity.ledgerId)
  expect(await remote.trash()).toEqual([])
  expect(
    (await remote.manifest(null)).items.filter((one) => one.kind !== 'directory')
  ).toHaveLength(1)
})
it('filled local vault uploads ordinary files and keeps their paths on an empty root', async () => {
  const app = buildFakeVault([{ path: 'Nested/sample.md', content: 'local bytes', mtime: 1000 }])
  await join(app)
  const files = (await remote.manifest(null)).items.filter((one) => one.kind !== 'directory')
  expect(files).toMatchObject([{ path: 'Nested/sample.md', sha: await shaOf('local bytes') }])
  expect(await remote.trash()).toEqual([])
})
it('two token connections keep intentional absence, hydrate real bytes through the other source, and resume after restart', async () => {
  const other = await v2Server(),
    factory = new IDBFactory(),
    bytes = 'sample binary bytes'
  try {
    const secondToken = (
        await createUser(
          { db: other.db, pepper: other.config.tokenPepper },
          'Other sample',
          other.address
        )
      ).token,
      secondRemote = new V2EngineClient(secondToken, { fetch: globalThis.fetch })
    await seed(remote, [await create(remote, 'Media/sample.bin', bytes, 1000)])
    const app = buildFakeVault([])
    Object.assign(app.workspace, { iterateAllLeaves: () => {} })
    const first = await join(app, factory)
    await first.ui.connect(secondToken)
    const secondId = first.registry.records().find((one) => one.address === other.address)!.id
    await first.ui.sync(secondId)
    await expect(first.host.evict(first.id, 'Media/sample.bin')).resolves.toMatchObject({
      status: 'complete',
    })
    expect(await app.vault.adapter.exists('Media/sample.bin')).toBe(false)
    await first.ui.sync(secondId)
    expect(await secondRemote.trash()).toEqual([])
    expect(
      (await secondRemote.manifest(null)).items.find((one) => one.path === 'Media/sample.bin')?.sha
    ).toBe(await shaOf(bytes))
    await first.destroy()
    const transport: typeof fetch = (input, init) => {
      if (new URL(String(input)).origin === new URL(server.address).origin)
        throw new Error('sample source offline')
      return globalThis.fetch(input, init)
    }
    // Reopen with the reachable token, retaining the independently fenced unavailable source.
    const next = await nativeTokenFixture(app, secondToken, transport, factory)
    hosts.push(next)
    await next.host.hydrate('Media/sample.bin')
    expect(await app.vault.adapter.read('Media/sample.bin')).toBe(bytes)
    expect((await app.vault.adapter.stat('Media/sample.bin'))?.mtime).toBe(1000)
    expect(await secondRemote.trash()).toEqual([])
  } finally {
    await other.close()
  }
})
it('a user edit during hydration is never overwritten by the downloaded old version', async () => {
  await seed(remote, [await create(remote, 'sample.bin', 'old bytes', 1000)])
  const app = buildFakeVault([])
  Object.assign(app.workspace, { iterateAllLeaves: () => {} })
  let edit = false
  const transport: typeof fetch = async (input, init) => {
    const response = await globalThis.fetch(input, init)
    if (edit && new URL(String(input)).pathname.includes('/content')) {
      edit = false
      await app.vault.adapter.write('sample.bin', 'new user bytes', { mtime: 2000 })
    }
    return response
  }
  const first = await join(app, new IDBFactory(), transport)
  await expect(first.host.evict(first.id, 'sample.bin')).resolves.toMatchObject({
    status: 'complete',
  })
  edit = true
  await expect(first.host.hydrate('sample.bin')).rejects.toThrow(/hydration/i)
  expect(await app.vault.adapter.read('sample.bin')).toBe('new user bytes')
})
it('disconnect materializes its offloaded file and preserves the local bytes', async () => {
  await seed(remote, [await create(remote, 'sample.bin', 'retained bytes', 1000)])
  const app = buildFakeVault([])
  Object.assign(app.workspace, { iterateAllLeaves: () => {} })
  const first = await join(app)
  await expect(first.host.evict(first.id, 'sample.bin')).resolves.toMatchObject({
    status: 'complete',
  })
  await expect(first.ui.disconnect(first.id)).resolves.toBeUndefined()
  expect(await app.vault.adapter.read('sample.bin')).toBe('retained bytes')
  expect(first.registry.records()).toEqual([])
})
it('an incoming edit hydrates the prior offloaded base before placement and then reaches the other token', async () => {
  const other = await v2Server()
  try {
    const secondToken = (
        await createUser(
          { db: other.db, pepper: other.config.tokenPepper },
          'Other sample',
          other.address
        )
      ).token,
      secondRemote = new V2EngineClient(secondToken, { fetch: globalThis.fetch })
    await seed(remote, [await create(remote, 'sample.bin', 'old bytes', 1000)])
    const app = buildFakeVault([])
    Object.assign(app.workspace, { iterateAllLeaves: () => {} })
    const first = await join(app)
    await first.ui.connect(secondToken)
    const secondId = first.registry.records().find((one) => one.address === other.address)!.id
    await first.ui.sync(secondId)
    await expect(first.host.evict(first.id, 'sample.bin')).resolves.toMatchObject({
      status: 'complete',
    })
    const before = (await secondRemote.manifest(null)).items.find(
        (one) => one.path === 'sample.bin'
      )!,
      bytes = new TextEncoder().encode('remote new bytes'),
      sha = await shaOf('remote new bytes')
    await secondRemote.putBlob(sha, bytes)
    await secondRemote.commitRaw(
      [
        {
          op: 'modify',
          file_id: before.file_id,
          base_version_id: before.version_id,
          sha,
          size: bytes.length,
          mtime: 3000,
        },
      ],
      crypto.randomUUID()
    )
    await first.ui.sync(secondId)
    expect(await app.vault.adapter.read('sample.bin')).toBe('remote new bytes')
    await first.syncNow()
    expect((await remote.manifest(null)).items.find((one) => one.path === 'sample.bin')?.sha).toBe(
      sha
    )
  } finally {
    await other.close()
  }
})
it('identical first-contact bytes produce one file and no conflict or redundant version', async () => {
  await seed(remote, [await create(remote, 'sample.md', 'same bytes', 1000)])
  const app = buildFakeVault([{ path: 'sample.md', content: 'same bytes', mtime: 2000 }]),
    one = await join(app)
  await one.syncNow()
  const files = (await remote.manifest(null)).items.filter((item) => item.kind !== 'directory')
  expect(files).toHaveLength(1)
  expect(await remote.versions(files[0].file_id)).toHaveLength(1)
  expect(app.vault.getFiles().map((file) => file.path)).toEqual(['sample.md'])
})
it.each(['sample.md', 'sample.bin'])(
  'different %s keeps server bytes and exactly one immutable local conflict with its original time',
  async (path) => {
    await seed(remote, [await create(remote, path, 'server bytes', 1000)])
    const app = buildFakeVault([{ path, content: 'local bytes', mtime: 2000 }]),
      factory = new IDBFactory(),
      one = await join(app, factory)
    expect(await app.vault.adapter.read(path)).toBe('server bytes')
    const conflicts = app.vault.getFiles().filter((file) => file.path.includes('Conflicted copy'))
    expect(conflicts).toHaveLength(1)
    expect(await app.vault.adapter.read(conflicts[0].path)).toBe('local bytes')
    expect((await app.vault.adapter.stat(conflicts[0].path))?.mtime).toBe(2000)
    await one.destroy()
    const next = await join(app, factory)
    await next.syncNow()
    expect(
      app.vault
        .getFiles()
        .filter((file) => file.path.includes('Conflicted copy'))
        .map((file) => file.path)
    ).toEqual(conflicts.map((file) => file.path))
    expect(await remote.trash()).toEqual([])
  }
)
it('a same-size user edit during download is preserved before the retry installs the server variant', async () => {
  await seed(remote, [await create(remote, 'sample.md', 'server bytes', 1000)])
  const app = buildFakeVault([{ path: 'sample.md', content: 'local bytes!', mtime: 2000 }])
  let edited = false
  const transport: typeof fetch = async (input, init) => {
    const response = await globalThis.fetch(input, init)
    if (!edited && String(input).includes('/content')) {
      edited = true
      await app.vault.adapter.writeBinary(
        'sample.md',
        new TextEncoder().encode('newer bytes!').buffer as ArrayBuffer,
        { mtime: 3000 }
      )
    }
    return response
  }
  const one = await join(app, undefined, transport, true)
  await one.syncNow()
  const copies = app.vault.getFiles().filter((file) => file.path.includes('Conflicted copy'))
  expect(edited).toBe(true)
  expect(copies).toHaveLength(1)
  expect(await app.vault.adapter.read(copies[0].path)).toBe('newer bytes!')
  expect((await app.vault.adapter.stat(copies[0].path))?.mtime).toBe(3000)
  expect(await app.vault.adapter.read('sample.md')).toBe('server bytes')
})
it('re-pasting the same token keeps its ledger, keychain entry and completed first contact', async () => {
  await seed(remote, [await create(remote, 'sample.md', 'server bytes', 1000)])
  const app = buildFakeVault([]),
    one = await join(app),
    before = one.registry.records()[0],
    keys = [...one.keys]
  await one.ui.connect(token)
  await one.syncNow()
  expect(one.registry.records()).toHaveLength(1)
  expect(one.registry.records()[0].ledgerId).toBe(before.ledgerId)
  expect([...one.keys]).toEqual(keys)
  expect(await remote.trash()).toEqual([])
})
