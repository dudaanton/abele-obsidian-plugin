import { describe, expect, it, vi } from 'vitest'
import { OwnerFolderHttpPort } from '@/sync/sharing/ownerHttp'
describe('concrete fenced owner HTTP port', () => {
  it('sends nothing while activation is disabled', async () => {
    const fetch = vi.fn()
    const p = new OwnerFolderHttpPort({
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
