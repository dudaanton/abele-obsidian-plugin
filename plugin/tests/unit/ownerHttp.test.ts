import { describe, expect, it, vi } from 'vitest'
import { OwnerFolderHttpPort } from '@/sync/sharing/ownerHttp'
describe('concrete fenced owner HTTP port', () => {
  it.each(['folder', 'group'] as const)(
    'lists and revokes a reviewed %s through the existing owner CAS route',
    async (kind) => {
      const wire = {
        id: 'sample-share',
        vault_id: 'sample-vault',
        label: 'Sample sharing',
        selector_kind: kind,
        folder_prefix: kind === 'folder' ? 'Shared/' : null,
        root_file_id: kind === 'group' ? 'sample-root' : null,
        role: 'editor',
        acl_revision: 4,
        state: 'active',
        revoked_at: null,
      }
      const sends: { path: string; body: any }[] = []
      const fetcher: typeof fetch = async (url, init) => {
        const path = new URL(String(url)).pathname
        expect(new Headers(init?.headers).get('authorization')).toBe(
          path === '/v1/auth/login'
            ? null
            : path.includes('/assets/visibility/')
              ? 'Bearer absd_' + 'b'.repeat(43)
              : 'Bearer abst_' + 'a'.repeat(43)
        )
        const value =
          path === '/v1/auth/login'
            ? {
                account_token: 'abst_' + 'a'.repeat(43),
                expires_at: new Date(Date.now() + 100000).toISOString(),
              }
            : init?.method === 'PATCH'
              ? {
                  ...wire,
                  acl_revision: 5,
                  state: 'unavailable',
                  revoked_at: new Date(1000).toISOString(),
                }
              : path.includes('/assets/visibility/')
                ? {
                    grantId: wire.id,
                    label: wire.label,
                    targetFileId: wire.root_file_id,
                    visible: true,
                    targetVersionId: 'sample-root-version',
                    revision: 27,
                    scopeRevision: 3,
                    withdrawalGeneration: 0,
                  }
                : kind === 'folder'
                  ? [wire]
                  : []
        if (init?.method === 'PATCH') sends.push({ path, body: JSON.parse(String(init.body)) })
        return new Response(JSON.stringify(value))
      }
      const port = new OwnerFolderHttpPort({
        baseUrl: 'https://sync.example',
        vaultId: 'sample-vault',
        deviceToken: () => 'absd_' + 'b'.repeat(43),
        fetch: fetcher,
      })
      const session = await port.authorize('invented-password', 'sample@example.com')
      const [share] = await port.list(
        session,
        kind === 'group'
          ? [
              {
                id: wire.id,
                label: wire.label,
                rootId: wire.root_file_id!,
                role: 'editor',
                revision: 4,
                state: 'active',
              },
            ]
          : []
      )
      expect(share).toMatchObject({ id: wire.id, label: wire.label, revision: 4, kind })
      await port.revoke(session, share)
      expect(sends).toEqual([
        {
          path: '/v1/vaults/sample-vault/grants/' + (kind === 'group' ? 'groups/' : '') + wire.id,
          body: { expected_revision: 4, revoke: true },
        },
      ])
    }
  )

  it.each(['folder', 'group'] as const)(
    'retains %s mutation id/revision and retries only preparation after create and PATCH',
    async (kind) => {
      const calls: { method: string; path: string }[] = []
      const grant = {
        id: 'sample-grant',
        vault_id: 'sample-vault',
        selector_kind: kind,
        folder_prefix: 'Agents/',
        root_file_id: 'sample-root',
        role: 'editor',
        acl_revision: 2,
        state: 'preparing',
        preparation: { ok: false, error: { code: 'scope_updating', message: 'retry preparation' } },
      }
      const fetcher: typeof fetch = async (url, init) => {
        const path = new URL(String(url)).pathname,
          method = init?.method ?? 'GET'
        calls.push({ method, path })
        let body: unknown = grant
        if (path === '/v1/auth/login')
          body = {
            account_token: 'abst_' + 'a'.repeat(43),
            expires_at: new Date(Date.now() + 100000).toISOString(),
          }
        else if (method === 'GET') body = []
        else if (path.endsWith('/prepare')) {
          expect(new Headers(init?.headers).get('authorization')).toBe(
            'Bearer ' + 'abst_' + 'a'.repeat(43)
          )
          body = kind === 'folder' ? { processed: 1, state: 'active' } : { ready: true }
        } else if (method === 'PATCH') body = { ...grant, acl_revision: 3 }
        return new Response(JSON.stringify(body))
      }
      const port = new OwnerFolderHttpPort({
        baseUrl: 'https://sync.example',
        vaultId: 'sample-vault',
        deviceToken: () => 'absd_' + 'b'.repeat(43),
        fetch: fetcher,
        enabled: () => true,
      })
      const session = await port.authorize('invented-password', 'sample@example.com')
      const created =
        kind === 'folder'
          ? await port.create(session, { label: 'Sample', prefix: 'Agents/', role: 'editor' })
          : await port.createGroup(session, {
              label: 'Sample',
              rootId: 'sample-root',
              rootVersion: 'root-v1',
              role: 'editor',
            })
      expect(created).toMatchObject({
        id: 'sample-grant',
        revision: 2,
        state: 'preparing',
        preparation: { ok: false },
      })
      const updated =
        kind === 'folder'
          ? await port.updateFolder(session, created as any, {
              expected_revision: 2,
              label: 'Updated',
            })
          : await port.updateGroup(session, created as any, {
              expected_revision: 2,
              label: 'Updated',
            })
      expect(updated).toMatchObject({ id: 'sample-grant', revision: 3, preparation: { ok: false } })
      const prepared =
        kind === 'folder'
          ? await port.prepare(session, updated as any)
          : await port.prepareGroup(session, updated as any)
      expect(prepared).toMatchObject({ id: 'sample-grant', revision: 3, state: 'active' })
      expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1)
      expect(
        calls.filter(
          (c) => c.method === 'POST' && c.path.includes('/grants') && !c.path.endsWith('/prepare')
        )
      ).toHaveLength(1)
      expect(calls.at(-1)?.path).toBe(
        kind === 'folder'
          ? '/v1/vaults/sample-vault/grants/sample-grant/prepare'
          : '/v1/vaults/sample-vault/grants/groups/prepare'
      )
    }
  )
  it('never turns an ordinary manifest kind into a server sharing verdict', async () => {
    const kinds = ['note', 'canvas', 'script', 'settings', 'attachment']
    const files = kinds.map((kind) => ({
      file_id: 'sample-' + kind,
      path: 'Shared/sample-' + kind + (kind === 'script' ? '.js' : '.md'),
      kind,
      version_id: 'sample-version',
      seq: 1,
      sha: 'a'.repeat(64),
      size: 1,
      mtime: 1,
    }))
    const state = {
      head_seq: 1,
      settings: {},
      usage: {
        live_bytes: 0,
        history_bytes: 0,
        trash_bytes: 0,
        quota_bytes: null,
        by_kind: Object.fromEntries(kinds.map((kind) => [kind, { live_bytes: 0, count: 0 }])),
      },
    }
    const port = new OwnerFolderHttpPort({
      baseUrl: 'https://sync.example',
      vaultId: 'sample-vault',
      deviceToken: () => 'absd_' + 'a'.repeat(43),
      fetch: async (url) =>
        new Response(
          JSON.stringify(
            String(url).includes('/manifest') ? { items: files, next: null, head_seq: 1 } : state
          )
        ),
    })
    const preview = await port.preview('Shared/')
    expect(preview.files.map((file) => file.eligibility)).toEqual(kinds.map(() => 'unknown'))
    expect(preview.files.map((file) => file.eligible)).toEqual(kinds.map(() => false))
    expect(preview.files.map((file) => file.path)).toEqual(files.map((file) => file.path))
  })
  it('sends nothing while activation is disabled', async () => {
    const fetch = vi.fn()
    const p = new OwnerFolderHttpPort({
      enabled: () => false,
      baseUrl: 'https://sync.example',
      vaultId: 'sample-vault',
      email: 'sample@example.com',
      deviceToken: () => 'absd_' + 'a'.repeat(43),
      fetch: fetch as any,
    })
    await expect(p.preview('Agents/')).rejects.toThrow(/disabled/)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('fails closed on an unbound session rather than substituting a personal device token', async () => {
    const fetch = vi.fn()
    const p = new OwnerFolderHttpPort({
      baseUrl: 'https://sync.example',
      vaultId: 'sample-vault',
      email: 'sample@example.com',
      deviceToken: () => 'absd_' + 'a'.repeat(43),
      fetch: fetch as any,
      enabled: () => true,
    })
    await expect(
      p.create(
        { facet: 'account', ownerVaultId: 'sample-vault', authenticatedAt: 0, expiresAt: 999999 },
        { label: 'Sample', prefix: 'Agents/', role: 'editor' }
      )
    ).rejects.toThrow(/session/)
    expect(fetch).not.toHaveBeenCalled()
  })
})
