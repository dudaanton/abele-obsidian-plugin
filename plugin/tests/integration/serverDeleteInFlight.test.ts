// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { AccessClient } from '@abele/sync-sdk/core'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { V2SyncClient } from '@abele/sync-server/tests/helpers/v2SyncClient.js'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { buildFakeVault } from '../helpers/fakeVault'
import { nativeTokenFixture } from '../helpers/nativeTokenFixture'

const network = globalThis.fetch

/**
 * A folder connection is downloading when its owner deletes it from the server: one transfer
 * never answers, and the first deletion answer is lost after the server applied it.
 */
it('stops an in-flight sync before deleting, keeps it stopped, and Try again finishes with the same key', async () => {
  const server = await v2Server()
  const app = buildFakeVault([])
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('document', { visibilityState: 'visible' })
  let device: Awaited<ReturnType<typeof nativeTokenFixture>> | undefined
  const events: string[] = []
  const keys: (string | null)[] = []
  let stall = false,
    loseAnswer = true
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    if (stall && url.pathname.endsWith('/content')) {
      events.push('transfer stalled')
      return new Promise<Response>((_, reject) => {
        const stop = () => {
          events.push('transfer stopped')
          reject(new DOMException('The request was aborted', 'AbortError'))
        }
        if (init?.signal?.aborted) stop()
        else init?.signal?.addEventListener('abort', stop, { once: true })
      })
    }
    if (url.pathname.endsWith('/connection/delete')) {
      events.push('deletion sent')
      keys.push(new Headers(init?.headers).get('Idempotency-Key'))
      const response = await network(input, init)
      if (loseAnswer) {
        loseAnswer = false
        throw new TypeError('The response was lost')
      }
      return response
    }
    return network(input, init)
  }
  try {
    const user = await createUser(
      { db: server.db, pepper: server.config.tokenPepper },
      'Sample user',
      server.address
    )
    const root = new V2SyncClient(user.token)
    const folder = (await root.commit([{ op: 'mkdir', path: 'Field Notes' }])).results[0] as {
      file_id: string
    }
    await root.create('Field Notes/first.md', 'first sample note')
    const owner = AccessClient.fromToken(user.token, { fetch: network })
    const issued = await owner.issue({
      scope: { kind: 'folder', id: folder.file_id },
      label: 'Sample folder device',
    })
    device = await nativeTokenFixture(app, issued.token, transport)
    const id = device.id
    expect(await app.vault.adapter.read('Field Notes/first.md')).toBe('first sample note')
    for (let i = 0; i < 12; i++)
      await root.create(`Field Notes/sample-${i}.md`, 'sample note '.repeat(i + 1))
    stall = true
    void device.ui.sync(id).catch(() => {})
    await vi.waitFor(() => expect(events).toContain('transfer stalled'))

    await expect(device.ui.deleteFromServer(id)).rejects.toMatchObject({
      deletionOutcome: 'unknown',
    })
    // Nothing of the running sync may still be talking to the server when the deletion goes out.
    expect(events.indexOf('transfer stopped')).toBeGreaterThan(-1)
    expect(events.indexOf('transfer stopped')).toBeLessThan(events.indexOf('deletion sent'))
    expect(device.ui.runtimes.has(id)).toBe(false)
    // A host restart of the other connections never brings the stopped one back.
    await device.ui.connectionsChanged()
    expect(device.ui.runtimes.has(id)).toBe(false)
    expect(device.registry.records().some((one) => one.id === id)).toBe(true)

    stall = false
    await device.ui.deleteFromServer(id)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
    expect(device.registry.records().some((one) => one.id === id)).toBe(false)
    expect(await app.vault.adapter.read('Field Notes/first.md')).toBe('first sample note')
    const audit = await server.db
      .selectFrom('audit')
      .select('action')
      .where('action', '=', 'connection.delete')
      .execute()
    expect(audit).toHaveLength(1)
    expect((await root.manifest()).items.some((one) => one.path.startsWith('Field Notes/'))).toBe(
      false
    )
  } finally {
    await device?.host.close().catch(() => {})
    await server.close()
    vi.unstubAllGlobals()
  }
}, 60000)

/** A real staged write must drain before any server deletion or lifecycle inspection. */
it('keeps an overdue writer owned and retries the exact deletion after it drains', async () => {
  const server = await v2Server()
  const app = buildFakeVault([])
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('document', { visibilityState: 'visible' })
  let device: Awaited<ReturnType<typeof nativeTokenFixture>> | undefined
  let release: (() => void) | undefined
  let holdWrites = false
  let loseAnswer = true
  const keys: (string | null)[] = []
  const original = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  app.vault.adapter.writeBinary = async (path, data) => {
    if (holdWrites && path.endsWith('.tmp'))
      await new Promise<void>((done) => {
        release = done
      })
    return original(path, data)
  }
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    if (url.pathname.endsWith('/connection/delete')) {
      keys.push(new Headers(init?.headers).get('Idempotency-Key'))
      const response = await network(input, init)
      if (loseAnswer) {
        loseAnswer = false
        throw new TypeError('The response was lost')
      }
      return response
    }
    return network(input, init)
  }
  try {
    const user = await createUser(
      { db: server.db, pepper: server.config.tokenPepper },
      'Sample user',
      server.address
    )
    const root = new V2SyncClient(user.token)
    const folder = (await root.commit([{ op: 'mkdir', path: 'Field Notes' }])).results[0] as {
      file_id: string
    }
    await root.create('Field Notes/first.md', 'first sample note')
    const owner = AccessClient.fromToken(user.token, { fetch: network })
    const issued = await owner.issue({
      scope: { kind: 'folder', id: folder.file_id },
      label: 'Sample device',
    })
    device = await nativeTokenFixture(app, issued.token, transport)
    const { ui, id, registry } = device
    await root.create('Field Notes/sample.js', 'export const sample = 1')
    await ui.sync(id)
    await ui.refreshReviews()
    const candidate = ui.candidates.value.find((one) => one.path === 'Field Notes/sample.js')!
    expect(candidate).toBeDefined()
    const otherFolder = (await root.commit([{ op: 'mkdir', path: 'Other Notes' }])).results[0] as {
      file_id: string
    }
    await root.create('Other Notes/sample.js', 'export const other = 2')
    const otherToken = await owner.issue({
      scope: { kind: 'folder', id: otherFolder.file_id },
      label: 'Other sample device',
    })
    await ui.connect(otherToken.token)
    const otherId = registry.records().find((one) => one.scope?.id === otherFolder.file_id)!.id
    await ui.connectionsChanged()
    await ui.sync(otherId)
    await ui.refreshReviews()
    const otherCandidate = ui.candidates.value.find((one) => one.path === 'Other Notes/sample.js')!
    expect(otherCandidate).toBeDefined()
    ui.runtimeStopLimitMs = 50
    await root.create('Field Notes/late.md', 'late sample note')
    holdWrites = true
    const syncing = ui.sync(id).catch(() => {})
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const guard = vi.spyOn(ui, 'connectionChangeGuard')
    const attempt = () =>
      registry.storage(id).loadLocalStorage('abele-sync-token-state:server-delete') as {
        key: string
      }
    await expect(ui.deleteFromServer(id)).rejects.toThrow('still stopping')
    expect(guard).not.toHaveBeenCalled()
    const key = attempt().key
    expect(keys).toEqual([])
    expect(registry.records().some((one) => one.id === id)).toBe(true)
    await expect(ui.deleteFromServer(id)).rejects.toThrow('still stopping')
    expect(attempt().key).toBe(key)
    expect(keys).toEqual([])
    await expect(ui.sync(id)).rejects.toThrow('awaiting confirmation')
    holdWrites = false
    release!()
    await syncing
    await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(false))
    const retry = vi.spyOn(ui, 'retryConnection')
    await ui.approve(candidate, { background: true })
    expect(retry).not.toHaveBeenCalled()
    await expect(ui.retryConnection(id, () => {})).rejects.toThrow('awaiting confirmation')
    expect(ui.runtimes.has(id)).toBe(false)
    expect(await app.vault.adapter.exists('Field Notes/sample.js')).toBe(false)
    await ui.approve(otherCandidate)
    expect(await app.vault.adapter.read('Other Notes/sample.js')).toBe('export const other = 2')
    await expect(ui.deleteFromServer(id)).rejects.toMatchObject({ deletionOutcome: 'unknown' })
    await ui.deleteFromServer(id)
    expect(keys).toEqual([key, key])
    expect(registry.records().some((one) => one.id === id)).toBe(false)
    expect(await app.vault.adapter.read('Field Notes/first.md')).toBe('first sample note')
    const audit = await server.db
      .selectFrom('audit')
      .select('action')
      .where('action', '=', 'connection.delete')
      .execute()
    expect(audit).toHaveLength(1)
  } finally {
    holdWrites = false
    release?.()
    await device?.host.close().catch(() => {})
    await server.close()
    vi.unstubAllGlobals()
  }
}, 15000)

it('materializes offloaded bytes before stopping their authenticated runtime and deleting', async () => {
  const server = await v2Server()
  const app = buildFakeVault([])
  Object.assign(app.workspace, { iterateAllLeaves: () => {} })
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('document', { visibilityState: 'visible' })
  let device: Awaited<ReturnType<typeof nativeTokenFixture>> | undefined
  try {
    const user = await createUser(
      { db: server.db, pepper: server.config.tokenPepper },
      'Sample user',
      server.address
    )
    const root = new V2SyncClient(user.token)
    await root.create('sample.bin', 'sample attachment bytes')
    device = await nativeTokenFixture(app, user.token, network)
    expect((await device.host.evict(device.id, 'sample.bin')).status).toBe('complete')
    expect(await app.vault.adapter.exists('sample.bin')).toBe(false)
    await device.ui.deleteFromServer(device.id)
    expect(await app.vault.adapter.read('sample.bin')).toBe('sample attachment bytes')
    expect(device.registry.records()).toEqual([])
  } finally {
    await device?.host.close().catch(() => {})
    await server.close()
    vi.unstubAllGlobals()
  }
}, 15000)
