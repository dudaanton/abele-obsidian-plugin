import { beforeAll, afterEach, expect, it } from 'vitest'
import { AccessClient, V2EngineClient } from '@abele/sync-sdk/core'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { create, seed } from '@abele/sync-test-seed'
import {
  productionPluginCode,
  bootProductionPlugin,
  nativeFetch,
} from '../helpers/productionPlugin'
import type { TokenEngines } from '@/sync/tokenEngines'
import type { TokenUi } from '@/sync/tokenUi'
let code: string
const fixtureFetch: typeof fetch = (input, init) =>
  nativeFetch(input, { ...init, redirect: 'manual' })
beforeAll(async () => {
  code = await productionPluginCode()
}, 120000)
const hosts: Awaited<ReturnType<typeof bootProductionPlugin>>[] = [],
  servers: Awaited<ReturnType<typeof v2Server>>[] = []
afterEach(async () => {
  for (const host of hosts.splice(0).reverse()) await host.close()
  for (const server of servers.splice(0)) await server.close()
})
async function device() {
  const native = await bootProductionPlugin(code)
  hosts.push(native)
  await expect.poll(() => native.plugin.tokenEngines, { timeout: 10000 }).toBeDefined()
  const host = native.plugin.tokenEngines as TokenEngines,
    ui = (host as unknown as { ui: TokenUi }).ui
  return { ...native, host, ui }
}
async function fixture() {
  const server = await v2Server()
  servers.push(server)
  const token = (
      await createUser(
        { db: server.db, pepper: server.config.tokenPepper },
        'Sample user',
        server.address
      )
    ).token,
    owner = new V2EngineClient(token, { fetch: fixtureFetch })
  await seed(owner, [
    await create(owner, 'Groups/sample.md', 'sample root', 1000),
    await create(
      owner,
      'Notes/member.md',
      '---\ngroups: ["[[Groups/sample]]"]\n---\n![[Private/sample.bin]]',
      1000
    ),
  ])
  const root = (await owner.manifest(null)).items.find((one) => one.path === 'Groups/sample.md')!,
    shared = await AccessClient.fromToken(token, { fetch: fixtureFetch }).issue({
      scope: { kind: 'group', id: root.file_id },
      label: 'Sample group',
    }),
    native = await device()
  await native.app.vault.adapter.mkdir('Private')
  await native.app.vault.adapter.write('Private/sample.bin', 'sample private bytes', {
    mtime: 2000,
  })
  await native.ui.connect(shared.token)
  const id = native.ui.rows.value[0].id
  await native.ui.sync(id)
  return { ...native, id, owner, token, shared, server }
}
it('boots the unmodified production bundle with native token controls and no test API', async () => {
  const native = await device()
  expect((window as unknown as { __abeleTest?: unknown }).__abeleTest).toBeUndefined()
  expect(native.plugin.syncSharing).toBeUndefined()
  const root = native.settings()
  await expect.poll(() => root.querySelectorAll('[role="tab"]').length).toBeGreaterThan(0)
  const sync = [...root.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (one) => one.textContent?.trim() === 'Sync'
  )!
  sync.click()
  await expect.poll(() => root.textContent).toContain('Connect')
  expect(root.textContent).not.toContain('Join a shared group')
})
it('production note-open consent publishes only the selected private target, including later edits', async () => {
  const s = await fixture()
  await s.app.vault.adapter.write('Private/neighbor.bin', 'sample neighbor')
  for (let turn = 0; turn < 2; turn++) await s.ui.sync(s.id)
  expect(s.ui.questions.value).toEqual([])
  expect((await s.owner.manifest(null)).items.map((one) => one.path)).not.toContain(
    'Private/sample.bin'
  )
  const note = s.app.vault.getFileByPath('Notes/member.md')!
  s.app.emit('workspace', 'file-open', note)
  await expect.poll(() => s.ui.questions.value.length).toBe(1)
  await s.ui.decide(s.ui.questions.value[0], true)
  expect((await s.owner.manifest(null)).items.map((one) => one.path)).toContain(
    'Private/sample.bin'
  )
  expect((await s.owner.manifest(null)).items.map((one) => one.path)).not.toContain(
    'Private/neighbor.bin'
  )
  await s.app.vault.adapter.write('Private/sample.bin', 'sample future bytes', { mtime: 3000 })
  await s.ui.sync(s.id)
  const file = (await s.owner.manifest(null)).items.find(
    (one) => one.path === 'Private/sample.bin'
  )!
  expect(new TextDecoder().decode(await s.owner.versionBytes(file.file_id, file.version_id))).toBe(
    'sample future bytes'
  )
  expect(s.network.requests.every((one) => one.path.startsWith('/v2/'))).toBe(true)
})
it('production denial keeps the private file and never publishes on background processing', async () => {
  const s = await fixture()
  s.app.emit('workspace', 'file-open', s.app.vault.getFileByPath('Notes/member.md'))
  await expect.poll(() => s.ui.questions.value.length).toBe(1)
  await s.ui.decide(s.ui.questions.value[0], false)
  await s.ui.sync(s.id)
  expect((await s.owner.manifest(null)).items.map((one) => one.path)).not.toContain(
    'Private/sample.bin'
  )
  expect(await s.app.vault.adapter.read('Private/sample.bin')).toBe('sample private bytes')
})
it('a renamed explicitly published attachment stays one server file with the same identity', async () => {
  const s = await fixture()
  s.app.emit('workspace', 'file-open', s.app.vault.getFileByPath('Notes/member.md'))
  await expect.poll(() => s.ui.questions.value.length).toBe(1)
  await s.ui.decide(s.ui.questions.value[0], true)
  const before = (await s.owner.manifest(null)).items.find(
    (one) => one.path === 'Private/sample.bin'
  )!
  await s.app.vault.rename(s.app.vault.getFileByPath('Private/sample.bin')!, 'Private/renamed.bin')
  await s.ui.sync(s.id)
  const after = (await s.owner.manifest(null)).items.filter((one) => one.kind === 'attachment')
  expect(after).toMatchObject([{ file_id: before.file_id, path: 'Private/renamed.bin' }])
  expect(await s.app.vault.adapter.exists('Private/renamed.bin')).toBe(true)
})
it('production retry repeats the exact successful request after its response is lost', async () => {
  const s = await fixture()
  s.app.emit('workspace', 'file-open', s.app.vault.getFileByPath('Notes/member.md'))
  await expect.poll(() => s.ui.questions.value.length).toBe(1)
  s.network.loseAssetCommit = true
  await expect(s.ui.decide(s.ui.questions.value[0], true)).rejects.toThrow()
  const first = s.network.requests.find((one) => one.path === '/v2/group-assets')!
  await s.ui.sync(s.id)
  const attempts = s.network.requests.filter((one) => one.path === '/v2/group-assets')
  expect(attempts.length).toBeGreaterThanOrEqual(2)
  expect(attempts.every((one) => one.key === first.key && one.body === first.body)).toBe(true)
  const file = (await s.owner.manifest(null)).items.find(
    (one) => one.path === 'Private/sample.bin'
  )!
  expect(await s.owner.versions(file.file_id)).toHaveLength(1)
})
it('a copied obsolete script marker does not block ordinary token exchange', async () => {
  const s = await fixture()
  await s.app.vault.adapter.write('.abele-script-managed', 'untrusted sample marker')
  await s.app.vault.adapter.write(
    'Notes/local.md',
    '---\ngroups: ["[[Groups/sample]]"]\n---\nlocal sample'
  )
  await s.ui.sync(s.id)
  expect((await s.owner.manifest(null)).items.map((one) => one.path)).toContain('Notes/local.md')
})
it('twenty production binary reconnect cycles drain each token runtime and preserve local files', async () => {
  const s = await fixture()
  await s.ui.disconnect(s.id)
  for (let turn = 0; turn < 20; turn++) {
    await s.ui.connect(s.token)
    const id = s.ui.rows.value[0].id,
      path = `Images/sample-${turn}.bin`
    await s.app.vault.adapter.mkdir('Images')
    await s.app.vault.adapter.writeBinary(path, new Uint8Array([turn, 1, 2]).buffer, {
      mtime: 5000 + turn,
    })
    await s.ui.sync(id)
    const runtime = (
      s.host as unknown as {
        live: Map<string, { options: { state: { permitsEngineEffects: boolean } } }>
      }
    ).live.get(id)!
    expect((await s.owner.manifest(null)).items.map((one) => one.path)).toContain(path)
    await s.ui.disconnect(id)
    expect(runtime.options.state.permitsEngineEffects).toBe(false)
    expect(s.ui.runtimes.size).toBe(0)
    expect(s.ui.registry.records()).toEqual([])
    expect(await s.app.vault.adapter.exists(path)).toBe(true)
  }
}, 30000)
