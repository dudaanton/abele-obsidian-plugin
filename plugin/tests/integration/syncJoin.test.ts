// @vitest-environment node
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { V2EngineClient } from '@abele/sync-core'
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
