import { describe, it, expect, vi } from 'vitest'
import { ScopedJoinFlow, SCOPED_JOIN_KEY, SCOPED_CONNECTION_KEY } from '@/sync/scoped/scopedJoin'
function setup() {
  const local = new Map<string, unknown>(),
    secret = new Map<string, string>(),
    storage = {
      loadLocalStorage: (k: string) => local.get(k) ?? null,
      saveLocalStorage: (k: string, v: unknown) => local.set(k, v),
    },
    secrets = {
      get: (k: string) => secret.get(k) ?? '',
      set: (k: string, v: string) => secret.set(k, v),
    }
  const member = {
      grantId: 'sample-grant',
      memberId: 'sample-member',
      vaultId: 'sample-vault',
      role: 'editor' as const,
      rootFileId: 'sample-root',
      state: 'active',
    },
    port = {
      login: vi.fn(async () => 'abst_' + 'a'.repeat(43)),
      accept: vi.fn(async () => ({
        grantId: member.grantId,
        memberId: member.memberId,
        role: member.role,
      })),
      discover: vi.fn(async () => [member]),
      enrol: vi.fn(async () => ({
        installationId: 'sample-install',
        token: 'absi_' + 'a'.repeat(43),
        memberId: member.memberId,
      })),
      ledger: vi.fn(async () => true),
      viewState: vi.fn(async () => 'active' as const),
      manifest: vi.fn(async () => [
        {
          path: 'Scattered/shared.md',
          fileId: 'sample-note',
          versionId: 'sample-version',
          sha: 'a'.repeat(64),
        },
      ]),
      localPaths: vi.fn(async () => [] as string[]),
      pullOnly: vi.fn(async () => {}),
    }
  const make = (enabled = true) =>
    new ScopedJoinFlow(
      storage,
      secrets,
      port,
      () => enabled,
      () => 2000
    )
  return { local, secret, storage, secrets, port, make }
}
const invite = {
  issuer: 'https://sync.example',
  token: 'absinv_' + 'a'.repeat(43),
  email: 'sample@example.com',
  name: 'Sample device',
  role: 'editor' as const,
  platform: 'desktop' as const,
}
describe('disabled invitation single-connection join', () => {
  it('explicitly disabled fence sends/stores nothing', async () => {
    const s = setup(),
      flow = new ScopedJoinFlow(s.storage, s.secrets, s.port, () => false)
    await expect(flow.begin(invite)).rejects.toThrow(/disabled/)
    expect(s.local.size).toBe(0)
    expect(s.port.login).not.toHaveBeenCalled()
  })
  it('recovers an enrolment lost reply with the same persisted attempt and scoped-only token', async () => {
    const s = setup()
    await s.make().begin(invite)
    s.port.enrol.mockRejectedValueOnce(new Error('lost'))
    await expect(s.make().resume('invented-password')).rejects.toThrow(/lost/)
    const attempt = s.port.enrol.mock.calls[0][2]
    await s.make().resume('invented-password')
    expect(s.port.enrol.mock.calls[1][2]).toEqual(attempt)
    expect(s.local.get(SCOPED_CONNECTION_KEY)).toMatchObject({
      facet: 'scoped',
      principalKind: 'installation',
      scriptPolicy: 'refuse',
    })
    expect(JSON.stringify([...s.local])).not.toMatch(/abst_|absi_|absinv_|invented-password/)
    expect(s.port.pullOnly).toHaveBeenCalledWith(expect.anything(), {
      publishLocal: false,
      holdLocalCollisions: true,
    })
  })
  it('keeps an occupied local incoming path in a durable hold without moving or uploading it', async () => {
    const s = setup()
    s.port.localPaths.mockResolvedValue(['Scattered/shared.md', 'Unrelated/local.md'])
    await s.make().begin(invite)
    expect(await s.make().resume('invented-password')).toMatchObject({
      phase: 'collision-hold',
      collisions: ['Scattered/shared.md'],
    })
    expect(s.port.pullOnly).not.toHaveBeenCalled()
    expect(s.local.get(SCOPED_JOIN_KEY)).not.toBeNull()
  })
  it('missing retained ledger never initializes another one or enrolls another principal', async () => {
    const s = setup()
    await s.make().begin(invite)
    await s.make().resume('invented-password')
    s.port.ledger.mockResolvedValue(false)
    await expect(s.make().resume('invented-password')).rejects.toThrow(/ledger|recovery/)
    expect(s.port.enrol).toHaveBeenCalledTimes(1)
  })
  it('refuses personal/retained state before login and never accepts wrong-facet installation', async () => {
    const s = setup()
    s.local.set('abele-sync-ledger', { stateId: 'retained' })
    await expect(s.make().begin(invite)).rejects.toThrow(/retained|connection/)
    expect(s.port.login).not.toHaveBeenCalled()
    s.local.clear()
    await s.make().begin(invite)
    s.port.enrol.mockResolvedValue({
      installationId: 'sample-install',
      token: 'absd_' + 'a'.repeat(43),
      memberId: 'sample-member',
    })
    await expect(s.make().resume('invented-password')).rejects.toThrow(/scoped/)
    expect(s.port.pullOnly).not.toHaveBeenCalled()
  })
  it('tampered local issuer cannot rebind the same installation secret', async () => {
    const s = setup()
    await s.make().begin(invite)
    await s.make().resume('invented-password')
    const p = structuredClone(s.local.get(SCOPED_JOIN_KEY)) as any
    p.issuer = 'https://other.example'
    p.connection.issuer = p.issuer
    s.local.set(SCOPED_JOIN_KEY, p)
    s.local.set(SCOPED_CONNECTION_KEY, p.connection)
    const calls = s.port.ledger.mock.calls.length
    await expect(s.make().resume('invented-password')).rejects.toThrow(/binding|identity/)
    expect(s.port.ledger).toHaveBeenCalledTimes(calls)
  })
  it('closed async acceptance cannot install a connection and resumes the stored attempt later', async () => {
    const s = setup(),
      flow = s.make()
    await flow.begin(invite)
    let finish!: (value: any) => void
    s.port.accept.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = flow.resume('invented-password').catch((e) => e)
    await new Promise((r) => setTimeout(r, 0))
    flow.close()
    finish({ grantId: 'sample-grant', memberId: 'sample-member', role: 'editor' })
    expect(await pending).toBeInstanceOf(Error)
    expect(s.port.enrol).not.toHaveBeenCalled()
    await s.make().resume('invented-password')
    expect(s.port.enrol).toHaveBeenCalledTimes(1)
  })
})
