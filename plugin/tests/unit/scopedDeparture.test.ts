import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { AbeleError } from '@abele/sync-protocol'
import { Notice } from 'obsidian'
import { ScopedPluginHost } from '@/sync/scoped/scopedPluginHost'
import {
  SCOPED_CONNECTION_KEY,
  SCOPED_JOIN_KEY,
  type ScopedLocalConnection,
} from '@/sync/scoped/scopedJoin'
import { scopedSecretPort } from '@/sync/scoped/scopedSecretSlots'
import { AbeleConfig } from '@/services/AbeleConfig'
import { secrets, setSecrets } from '@/secrets/SecretStore'
import { useVault } from '../helpers/testEnv'

let host: ScopedPluginHost
const c: ScopedLocalConnection = {
  version: 4,
  facet: 'scoped',
  issuer: 'https://sync.example',
  vaultId: 'sample-vault',
  grantId: 'sample-grant',
  memberId: 'sample-member',
  principalId: 'sample-install',
  principalKind: 'installation',
  role: 'editor',
  rootFileId: 'sample-root',
  tokenId: 'abele-scoped-installation-sample',
  ledgerId: 'sample-ledger',
  scriptPolicy: 'refuse',
}
async function setup(connection = c, legacy = false, fetcher: typeof fetch = vi.fn() as never) {
  const app = useVault([{ path: 'Shared/sample-root.md', content: 'local files stay' }])
  setSecrets(null)
  AbeleConfig.getInstance().applySettings()
  const road = scopedSecretPort(secrets()),
    token = 'absi_' + 'a'.repeat(43)
  road.set(connection.tokenId, token)
  const proof = JSON.stringify({ connection, token })
  if (legacy) secrets().setLocal(connection.tokenId + '-binding', proof)
  else road.set(connection.tokenId + ':binding', proof)
  app.saveLocalStorage(SCOPED_CONNECTION_KEY, connection)
  const factory = new IDBFactory(),
    status = vi.fn()
  host = new ScopedPluginHost(app as never, fetcher, factory, status)
  const r = await (host as any).open(connection, true)
  vi.spyOn(r.state, 'getKnown').mockResolvedValue({ path: 'Shared/sample-root.md' })
  const state = vi.spyOn(r.client, 'state').mockResolvedValue({
    state: 'preparing',
    role: 'editor',
    selector: { kind: 'group', root_file_id: c.rootFileId },
  })
  return { app, factory, status, r, state, road }
}
afterEach(async () => {
  await host?.close()
  setSecrets(null)
  vi.restoreAllMocks()
})

it('persists owner-removed access, tells the collaborator, and stops automatic polls across reload', async () => {
  const s = await setup()
  await host.start()
  expect((host as any).clock).not.toBeNull()
  s.state.mockRejectedValue(new AbeleError('unauthorized', 'scoped authority is unavailable'))
  await expect(host.sync()).rejects.toThrow('unavailable')
  expect(host.accessRemoved.value).toBe('Access to Shared/sample-root.md was removed by its owner.')
  expect(s.status).toHaveBeenLastCalledWith('error', host.accessRemoved.value)
  expect((host as any).clock).toBeNull()
  expect((host as any).unwatch).toBeNull()
  const calls = s.state.mock.calls.length
  await host.sync()
  expect(s.state).toHaveBeenCalledTimes(calls)
  await host.close()
  const fetcher = vi.fn()
  host = new ScopedPluginHost(s.app as never, fetcher as never, s.factory, s.status)
  await host.start()
  expect(host.accessRemoved.value).toContain('removed by its owner')
  expect(fetcher).not.toHaveBeenCalled()
})

it.each(['offline', 'scope_updating', 'scope_unavailable'] as const)(
  'does not call temporary %s evidence owner revocation',
  async (code) => {
    const s = await setup()
    s.state.mockRejectedValue(
      code === 'offline' ? new Error('offline') : new AbeleError(code, 'view not ready')
    )
    await expect(host.start()).rejects.toThrow()
    expect(host.accessRemoved.value).toBe('')
    expect((host as any).clock).not.toBeNull()
  }
)

it('leaves a connection with a pre-release UUID binding and removes every readable legacy token copy', async () => {
  const connection = {
    ...c,
    tokenId: 'abele-scoped-installation-12345678-1234-4234-8234-123456789abc',
  }
  const s = await setup(connection, true)
  vi.spyOn(s.r.client, 'revokeSelf').mockResolvedValue('revoked')
  const invitationId = 'abele-scoped-invitation-87654321-4321-4321-8321-cba987654321'
  for (const suffix of ['', ':binding', ':accepted']) {
    secrets().setLocal((invitationId + suffix).replaceAll(':', '-'), 'retained-token-copy')
    s.road.set(invitationId + suffix, 'current-token-copy')
  }
  s.app.saveLocalStorage(SCOPED_JOIN_KEY, { connection, invitationId })
  await host.leave()
  expect(host.connection.value).toBeNull()
  expect(s.app.loadLocalStorage(SCOPED_CONNECTION_KEY)).toBeNull()
  expect(s.app.loadLocalStorage(SCOPED_JOIN_KEY)).toBeNull()
  for (const id of [
    connection.tokenId,
    connection.tokenId + ':binding',
    ...['', ':binding', ':accepted'].map((suffix) => invitationId + suffix),
  ]) {
    expect(s.road.get(id)).toBe('')
    expect(secrets().getLocal(id.replaceAll(':', '-'))).toBe('')
  }
  expect(await s.factory.databases()).toEqual([])
  expect(await s.app.vault.adapter.read('Shared/sample-root.md')).toBe('local files stay')
})

it.each([
  ['headers', false],
  ['body', false],
  ['headers', true],
  ['body', true],
] as const)(
  'finishes local Leave with hung %s, including queued sync=%s, and aborts transport',
  async (phase, queued) => {
    let hanging = true
    const releases: Array<() => void> = []
    const signals: AbortSignal[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal)
      const data = String(input).endsWith('/self')
        ? { revoked: true }
        : {
            endpoint_identity: c.issuer,
            vault_id: c.vaultId,
            grant_id: c.grantId,
            principal_kind: c.principalKind,
            principal_id: c.principalId,
            state: 'preparing',
            role: c.role,
            selector: { kind: 'group', root_file_id: c.rootFileId },
          }
      const response = new Response(JSON.stringify(data))
      if (!hanging) return response
      // Deliberately ignore AbortSignal: the host must still release its queue and
      // prevent a late response from reviving the departed connection.
      if (phase === 'headers')
        return new Promise<Response>((resolve) => releases.push(() => resolve(response)))
      vi.spyOn(response, 'text').mockImplementation(
        () => new Promise<string>((resolve) => releases.push(() => resolve(JSON.stringify(data))))
      )
      return response
    })
    const s = await setup(c, false, fetcher)
    await host.start()
    let syncing = Promise.resolve()
    if (queued) {
      s.state.mockRestore()
      syncing = host.sync().catch(() => {})
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
      if (phase === 'body') await vi.waitFor(() => expect(releases).toHaveLength(1))
    }
    const notices = (Notice as any).shown as string[]
    const beforeNotices = notices.length
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const leaving = host.leave()
    try {
      await vi.advanceTimersByTimeAsync(6000)
      await vi.waitFor(() => expect(host.connection.value).toBeNull(), { timeout: 1000 })
      await leaving
      expect(signals).toHaveLength(queued ? 2 : 1)
      expect(signals.every((signal) => signal.aborted)).toBe(true)
      expect(notices.slice(beforeNotices).join(' ')).toContain('server could not be told')
      expect(s.road.get(c.tokenId)).toBe('')
      expect(await s.factory.databases()).toEqual([])
      expect(await s.app.vault.adapter.read('Shared/sample-root.md')).toBe('local files stay')
    } finally {
      hanging = false
      for (const release of releases) release()
      vi.useRealTimers()
      await syncing
      await leaving
    }
    expect(host.connection.value).toBeNull()
    expect(s.app.loadLocalStorage(SCOPED_CONNECTION_KEY)).toBeNull()
  }
)

it('leaves idempotently without cancelling a future invitation transport', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ revoked: true })))
  await setup(c, false, fetcher)
  await host.leave()
  await host.leave()
  await expect(
    (host as any).transport('https://sync.example/v1/auth/login')
  ).resolves.toMatchObject({ status: 200 })
})

it.each(['active', 'revoked', 'offline'] as const)(
  'leaves a %s connection, clearing only scoped keys/state and keeping local files',
  async (mode) => {
    const s = await setup()
    await host.start()
    const revoke = vi.spyOn(s.r.client, 'revokeSelf').mockImplementation(async () => {
      if (mode === 'offline') throw new Error('offline')
      return mode === 'revoked' ? 'already' : 'revoked'
    })
    if (mode === 'revoked') {
      s.state.mockRejectedValue(new AbeleError('unauthorized', 'scoped authority is unavailable'))
      await expect(host.sync()).rejects.toThrow()
    }
    const invitationId = 'abele-scoped-invitation-sample'
    for (const suffix of ['', ':binding', ':accepted'])
      s.road.set(invitationId + suffix, 'retained')
    s.app.saveLocalStorage(SCOPED_JOIN_KEY, { connection: c, invitationId })
    s.app.saveLocalStorage('abele-sync-ledger', { stateId: '', vaultId: '' })
    s.app.saveLocalStorage('abele-script-provenance', { keep: true })
    await host.leave()
    expect(revoke).toHaveBeenCalledOnce()
    expect(host.connection.value).toBeNull()
    expect(host.active).toBe(false)
    expect((host as any).clock).toBeNull()
    expect(s.app.loadLocalStorage(SCOPED_CONNECTION_KEY)).toBeNull()
    expect(s.app.loadLocalStorage(SCOPED_JOIN_KEY)).toBeNull()
    expect(s.road.get(c.tokenId)).toBe('')
    expect(s.road.get(c.tokenId + ':binding')).toBe('')
    for (const suffix of ['', ':binding', ':accepted'])
      expect(s.road.get(invitationId + suffix)).toBe('')
    expect(await s.factory.databases()).toEqual([])
    expect(s.app.loadLocalStorage('abele-sync-ledger')).toEqual({ stateId: '', vaultId: '' })
    expect(s.app.loadLocalStorage('abele-script-provenance')).toEqual({ keep: true })
    expect(await s.app.vault.adapter.read('Shared/sample-root.md')).toBe('local files stay')
    expect(s.status).toHaveBeenLastCalledWith('disconnected')
  }
)
