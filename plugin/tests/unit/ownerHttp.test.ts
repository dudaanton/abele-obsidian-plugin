import { describe, expect, it, vi } from 'vitest'
import { OwnerFolderHttpPort } from '@/sync/sharing/ownerHttp'
describe('concrete fenced owner HTTP port', () => {
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
