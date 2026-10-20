// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { AccessClient } from '@abele/sync-sdk/core'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { V2SyncClient } from '@abele/sync-server/tests/helpers/v2SyncClient.js'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { V2Client } from '@/sync/v2/client'
import { issueDeletionDevice, deletionFolder } from '../helpers/serverDeleteSetup'
import { spawnSyncServer } from '../e2e/helpers/syncServer'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildFakeVault } from '../helpers/fakeVault'
import { nativeTokenFixture } from '../helpers/nativeTokenFixture'
import { TokenUi, SCOPE_DELETED } from '@/sync/tokenUi'

const network = globalThis.fetch

async function setup() {
  const server = await v2Server()
  try {
    const user = await createUser(
      { db: server.db, pepper: server.config.tokenPepper },
      'Sample user',
      server.address
    )
    const root = new V2SyncClient(user.token)
    const folder = (await root.commit([{ op: 'mkdir', path: 'Sample' }])).results[0]!
    if (folder.status === 'rejected') throw new Error(folder.code)
    await root.create('Sample/note.md', 'sample bytes')
    await root.create('sibling.md', 'retained sibling')
    return { server, root, encoded: user.token, folder }
  } catch (error) {
    await server.close()
    throw error
  }
}

it('issues screenshot-device tokens using a strict selector rather than a labelled scope', async () => {
  const f = await setup()
  try {
    const reader = await issueDeletionDevice(f.encoded, 'Sample reading device', true, network)
    expect(reader.info.read_only).toBe(true)
    expect(
      (await AccessClient.fromToken(reader.token, { fetch: network }).connection()).scope.path
    ).toBe('/')
  } finally {
    await f.server.close()
  }
})

it('finds a screenshot folder in the raw directory-inclusive manifest', async () => {
  const f = await setup()
  try {
    expect(await deletionFolder(f.encoded, 'Sample', network)).toMatchObject({
      kind: 'directory',
      file_id: f.folder.file_id,
    })
  } finally {
    await f.server.close()
  }
})

it('rejects an actual in-flight deletion when its frozen server crashes', async () => {
  const directory = await mkdtemp(resolve('.scratch/server-delete-crash-'))
  const server = await spawnSyncServer(directory)
  let pending: Promise<unknown> | undefined
  try {
    const client = new V2Client(
      AccessClient.fromToken(server.rootToken, { fetch: network }).token,
      network
    )
    server.suspend()
    let settled = false
    pending = client.deleteScope(randomUUID()).then(
      () => {
        settled = true
        return { committed: true }
      },
      (error: unknown) => {
        settled = true
        return error
      }
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(settled).toBe(false)
    await server.crash()
    expect(await pending).toMatchObject({ code: 'unreachable' })
  } finally {
    await server.kill()
    await pending
    await rm(directory, { recursive: true, force: true })
  }
})

it.each(['root', 'folder'] as const)(
  'matches the real %s deletion contract and replays a receipt after revocation',
  async (kind) => {
    const f = await setup()
    try {
      const root = AccessClient.fromToken(f.encoded, { fetch: network })
      const scope = {
        kind: root.token.scope.kind,
        id: kind === 'root' ? root.token.scope.id : f.folder.file_id,
      }
      const issued = await root.issue({ scope, label: 'Sample deleting device' })
      const reader = await root.issue({ scope, label: 'Sample other device', read_only: true })
      const calls: { body: string; key: string | null; status: number; json: unknown }[] = []
      const transport: typeof globalThis.fetch = async (input, init) => {
        const response = await network(input, init)
        if (String(input).endsWith('/connection/delete'))
          calls.push({
            body: String(init?.body),
            key: new Headers(init?.headers).get('Idempotency-Key'),
            status: response.status,
            json: await response.clone().json(),
          })
        return response
      }
      const client = new V2Client(
        AccessClient.fromToken(issued.token, { fetch: network }).token,
        transport
      )
      const key = randomUUID(),
        receipt = await client.deleteScope(key)
      expect(receipt.files).toBe(kind === 'root' ? 2 : 1)
      expect(receipt.revoked_tokens).toEqual(
        expect.arrayContaining([issued.info.id, reader.info.id])
      )
      expect(await client.deleteScope(key)).toEqual(receipt)
      expect(calls).toEqual([0, 1].map(() => ({ body: '{}', key, status: 200, json: receipt })))
      await expect(client.connection()).rejects.toMatchObject({
        code: 'scope_deleted',
        status: 401,
      })
      await expect(
        new V2Client(
          AccessClient.fromToken(reader.token, { fetch: network }).token,
          network
        ).connection()
      ).rejects.toMatchObject({ code: 'scope_deleted', status: 401 })
      const refusal = await network(f.server.address + '/v2/connection', {
        headers: {
          authorization:
            'Bearer ' + AccessClient.fromToken(reader.token, { fetch: network }).token.key,
        },
      })
      expect(refusal.status).toBe(401)
      expect(await refusal.json()).toMatchObject({
        error: { code: 'scope_deleted', message: 'Deleted on the server', details: {} },
      })
      if (kind === 'folder') {
        expect((await f.root.manifest()).items.map((one) => one.path)).toContain('sibling.md')
        expect(JSON.stringify(await f.root.json('/trash'))).toContain('Sample/note.md')
      }
    } finally {
      await f.server.close()
    }
  }
)

it('persists another native device stopped by real scope deletion and retains its files after restart', async () => {
  const f = await setup(),
    app = buildFakeVault([])
  let device: Awaited<ReturnType<typeof nativeTokenFixture>> | undefined
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('document', { visibilityState: 'visible' })
  try {
    const { token } = await issueDeletionDevice(f.encoded, 'Sample other device', false, network)
    device = await nativeTokenFixture(app, token, network)
    const owner = AccessClient.fromToken(f.encoded, { fetch: network })
    await new V2Client(owner.token, network).deleteScope(randomUUID())
    await expect(device.ui.sync(device.id)).rejects.toBeDefined()
    expect(
      device.registry.records().find((one) => one.id === device!.id)?.state[
        'abele-sync-token-state:scope-deleted'
      ]
    ).toBe(true)
    expect(device.ui.activity.value[device.id].error).toBe(SCOPE_DELETED)
    expect(await app.vault.adapter.read('Sample/note.md')).toBe('sample bytes')
    expect(await app.vault.adapter.read('sibling.md')).toBe('retained sibling')
    await device.host.close()
    const keys = device.keys
    const restarted = new TokenUi(
      device.registry,
      {
        get: (id) => keys.get(id) ?? null,
        set: (id, value) => {
          keys.set(id, value)
        },
        remove: (id) => {
          keys.delete(id)
        },
      },
      network
    )
    expect(restarted.activity.value[device.id].error).toBe(SCOPE_DELETED)
    await expect(restarted.pause(device.id, false)).rejects.toThrow('stopped')
    await expect(restarted.sync(device.id)).rejects.toThrow(SCOPE_DELETED)
    expect(await app.vault.adapter.read('Sample/note.md')).toBe('sample bytes')
  } finally {
    await device?.host.close()
    await f.server.close()
    vi.unstubAllGlobals()
  }
})
