import { describe, expect, it, vi } from 'vitest'
import { FolderSharingFlow } from '@/sync/sharing/folderSharing'
const preview = () => ({
  prefix: 'Agents/',
  generation: 'sample-generation',
  complete: true,
  files: [
    {
      path: 'Agents/sample.md',
      fileId: 'sample-file',
      versionId: 'sample-version',
      eligible: true,
    },
  ],
})
function setup(enabled = true) {
  const port = {
    preview: vi.fn(async () => preview()),
    authorize: vi.fn(async (_password: string) => ({
      facet: 'account' as const,
      ownerVaultId: 'sample-vault',
      authenticatedAt: 1000,
      expiresAt: 100000,
    })),
    create: vi.fn(async () => ({
      id: 'sample-grant',
      prefix: 'Agents/',
      role: 'editor' as const,
      revision: 1,
    })),
    issue: vi.fn(async () => ({
      grantId: 'sample-grant',
      token: 'absk_' + 'a'.repeat(43),
      facet: 'scoped' as const,
      role: 'editor' as const,
    })),
  }
  return {
    port,
    flow: new FolderSharingFlow(
      'sample-vault',
      port,
      () => enabled,
      () => 2000
    ),
  }
}
describe('disabled owner folder sharing contract', () => {
  it('refuses remote mutations behind the default disabled fence', async () => {
    const { port } = setup()
    const flow = new FolderSharingFlow('sample-vault', port)
    await expect(flow.review('Agents/', 'editor', 'Sample')).rejects.toThrow(/disabled/)
    expect(port.preview).not.toHaveBeenCalled()
  })
  it('revalidates exact current folder preview before creating a password-authenticated scoped key', async () => {
    const { flow, port } = setup()
    await flow.review('Agents/', 'editor', 'Sample')
    const result = await flow.confirm('invented-password')
    expect(result.token).toMatch(/^absk_/)
    expect(port.authorize).toHaveBeenCalledWith('invented-password')
    expect(port.create).toHaveBeenCalledTimes(1)
    expect(port.issue).toHaveBeenCalledTimes(1)
  })
  it('refuses changed preview after password authentication', async () => {
    const { flow, port } = setup()
    await flow.review('Agents/', 'editor', 'Sample')
    port.authorize.mockImplementation(async () => {
      port.preview.mockResolvedValue({ ...preview(), generation: 'changed' })
      return {
        facet: 'account',
        ownerVaultId: 'sample-vault',
        authenticatedAt: 1000,
        expiresAt: 100000,
      }
    })
    await expect(flow.confirm('invented-password')).rejects.toThrow(/preview changed/)
    expect(port.create).not.toHaveBeenCalled()
  })
  it('never exposes a personal token or mismatched folder grant', async () => {
    const { flow, port } = setup()
    await flow.review('Agents/', 'editor', 'Sample')
    port.issue.mockResolvedValue({
      grantId: 'sample-grant',
      token: 'absd_' + 'a'.repeat(43),
      facet: 'scoped',
      role: 'editor',
    })
    await expect(flow.confirm('invented-password')).rejects.toThrow(/scoped/)
    expect(flow.secret).toBeNull()
  })
  it('rejects unproven/stale owner authentication, dangerous prefix and incomplete preview', async () => {
    const { flow, port } = setup()
    await expect(flow.review('../Private/', 'editor', 'Sample')).rejects.toThrow()
    await flow.review('Agents/', 'editor', 'Sample')
    port.authorize.mockResolvedValue({
      facet: 'account',
      ownerVaultId: 'other-vault',
      authenticatedAt: 1000,
      expiresAt: 100000,
    })
    await expect(flow.confirm('invented-password')).rejects.toThrow(/owner/)
    expect(port.create).not.toHaveBeenCalled()
    port.preview.mockResolvedValue({ ...preview(), complete: false })
    await expect(flow.review('Agents/', 'editor', 'Sample')).rejects.toThrow(/complete/)
  })
})
