import { describe, it, expect, vi } from 'vitest'
import { BooxBooksSetup, booxPermission } from '@/sync/scoped/booxSetup'
import { SCOPED_CONNECTION_KEY } from '@/sync/scoped/scopedJoin'
const input = {
  issuer: 'https://sync.example',
  vaultId: 'sample-vault',
  grantId: 'sample-books-grant',
  principalId: 'sample-books-key',
  token: 'absk_' + 'a'.repeat(43),
  rootFileId: 'sample-books-root',
  rootVersionId: 'books-v1',
}
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
    },
    state = {
      issuer: input.issuer,
      vaultId: input.vaultId,
      grantId: input.grantId,
      principalId: input.principalId,
      selector: 'group',
      rootFileId: input.rootFileId,
      rootVersionId: input.rootVersionId,
      role: 'editor',
      state: 'active',
      transportVerified: true,
    },
    port = {
      localPaths: vi.fn(async () => [] as string[]),
      negotiate: vi.fn(async () => state),
      ledger: vi.fn(async () => true),
      pullManifest: vi.fn(async () => ({ known: 4, materialized: 2, omitted: 2 })),
      revoke: vi.fn(async () => {}),
    }
  return {
    local,
    secret,
    storage,
    secrets,
    state,
    port,
    flow: new BooxBooksSetup(storage, secrets, port, () => true),
  }
}
describe('fenced untrusted Books scoped-only setup', () => {
  it('default fence sends no secret and stores no connection', async () => {
    const s = setup()
    await expect(new BooxBooksSetup(s.storage, s.secrets, s.port).setup(input)).rejects.toThrow(
      /disabled/
    )
    expect(s.port.negotiate).not.toHaveBeenCalled()
    expect(s.local.size).toBe(0)
  })
  it.each(['abst_', 'absd_'])('refuses %s before any network request', async (facet) => {
    const s = setup()
    await expect(s.flow.setup({ ...input, token: facet + 'a'.repeat(43) })).rejects.toThrow(
      /scoped/
    )
    expect(s.port.negotiate).not.toHaveBeenCalled()
  })
  it('cold group-only editor setup never fetches full-vault frontmatter or treats omitted content as deletion', async () => {
    const s = setup()
    expect(await s.flow.setup(input)).toMatchObject({
      status: 'ready',
      role: 'editor',
      known: 4,
      materialized: 2,
      omitted: 2,
    })
    expect(s.local.get(SCOPED_CONNECTION_KEY)).toMatchObject({
      facet: 'scoped',
      purpose: 'books-untrusted',
      scriptPolicy: 'refuse',
      rootFileId: input.rootFileId,
    })
    expect(JSON.stringify([...s.local])).not.toMatch(/absk_|absd_|abst_/)
    expect(s.port.pullManifest).toHaveBeenCalledTimes(1)
    expect(booxPermission('editor', 'active', 'edit-note')).toBe(true)
    expect(booxPermission('editor', 'active', 'publish-extra')).toBe(false)
    expect(booxPermission('editor', 'active', 'edit-imported-asset')).toBe(false)
  })
  it('wrong group/root/issuer and reader-only ceiling do not silently become full or editor setup', async () => {
    for (const field of ['selector', 'rootFileId', 'issuer', 'role']) {
      const s = setup()
      s.port.negotiate.mockResolvedValue({
        ...s.state,
        [field]: field === 'role' ? 'reader' : field === 'selector' ? 'folder' : 'wrong',
      })
      await expect(s.flow.setup(input)).rejects.toThrow(/Books|editor|binding/)
      expect(s.port.pullManifest).not.toHaveBeenCalled()
    }
  })
  it('existing local files/personal state refuse before sending scoped credentials', async () => {
    const s = setup()
    s.port.localPaths.mockResolvedValue(['Unrelated/private.md'])
    await expect(s.flow.setup(input)).rejects.toThrow(/empty/)
    expect(s.port.negotiate).not.toHaveBeenCalled()
    const t = setup()
    t.local.set('abele-sync-connection', { vaultId: 'personal' })
    await expect(t.flow.setup(input)).rejects.toThrow(/personal/)
    expect(t.port.negotiate).not.toHaveBeenCalled()
  })
  it('missing retained ledger never allocates or reconnects another identity; unsupported transport remains a hold', async () => {
    const s = setup()
    await s.flow.setup(input)
    s.port.ledger.mockResolvedValue(false)
    await expect(s.flow.resume()).rejects.toThrow(/ledger|recovery/)
    expect(s.port.negotiate).toHaveBeenCalledTimes(1)
    const t = setup()
    t.state.transportVerified = false
    await expect(t.flow.setup(input)).rejects.toThrow(/transport/)
    expect(t.port.pullManifest).not.toHaveBeenCalled()
  })
  it('revocation makes all network writes unavailable while preserving downloaded bytes/descriptor', () => {
    expect(booxPermission('editor', 'revoked', 'edit-note')).toBe(false)
    expect(booxPermission('editor', 'revoked', 'read-local')).toBe(true)
    expect(booxPermission('reader', 'active', 'edit-note')).toBe(false)
    expect(booxPermission('editor', 'active', 'execute-script')).toBe(false)
  })
})
