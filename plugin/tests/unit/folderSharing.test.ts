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
    prepare: vi.fn(),
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
  it('completes multi-step preparation on the first confirmation without recreating the share', async () => {
    const { flow, port } = setup()
    const grant = {
      id: 'sample-grant',
      prefix: 'Agents/',
      role: 'editor',
      revision: 1,
      state: 'preparing',
      preparation: { ok: true, state: 'preparing' },
    }
    port.create.mockResolvedValue(grant as any)
    port.prepare.mockResolvedValueOnce(grant).mockResolvedValueOnce({ ...grant, state: 'active' })
    await flow.review('Agents/', 'editor', 'Sample')
    expect(await flow.confirm('invented-password')).toMatchObject({ grantId: grant.id })
    expect(port.create).toHaveBeenCalledTimes(1)
    expect(port.prepare).toHaveBeenCalledTimes(2)
    expect(port.issue).toHaveBeenCalledTimes(1)
  })

  it('reports unfinished bounded preparation without blaming the folder or issuing a key', async () => {
    const { flow, port } = setup()
    const grant = {
      id: 'sample-grant',
      prefix: 'Agents/',
      role: 'editor',
      revision: 1,
      state: 'preparing',
      preparation: { ok: true, state: 'preparing' },
    }
    port.create.mockResolvedValue(grant as any)
    port.prepare.mockResolvedValue(grant)
    await flow.review('Agents/', 'editor', 'Sample')
    await expect(flow.confirm('invented-password')).rejects.toMatchObject({
      code: 'scope_updating',
    })
    expect(port.create).toHaveBeenCalledTimes(1)
    expect(port.prepare).toHaveBeenCalledTimes(100)
    expect(port.issue).not.toHaveBeenCalled()
  })
  it('retains a committed grant when preparation fails and retries preparation, not creation', async () => {
    const { flow, port } = setup()
    port.create.mockResolvedValue({
      id: 'sample-grant',
      prefix: 'Agents/',
      role: 'editor',
      revision: 1,
      state: 'preparing',
      preparation: { ok: false, error: { code: 'scope_updating', message: 'try preparation' } },
    } as any)
    port.prepare.mockRejectedValueOnce(new Error('preparation unavailable')).mockResolvedValue({
      id: 'sample-grant',
      prefix: 'Agents/',
      role: 'editor',
      revision: 1,
      state: 'active',
    })
    await flow.review('Agents/', 'editor', 'Sample')
    await expect(flow.confirm('invented-password')).rejects.toThrow('preparation unavailable')
    expect(port.issue).not.toHaveBeenCalled()
    expect(await flow.confirm('invented-password')).toMatchObject({ grantId: 'sample-grant' })
    expect(port.create).toHaveBeenCalledTimes(1)
    expect(port.prepare).toHaveBeenCalledTimes(2)
  })
  it('rejects a closed late preview instead of replacing the newly displayed folder', async () => {
    const { flow, port } = setup()
    let finish!: (p: ReturnType<typeof preview>) => void
    port.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const old = flow.review('Private/', 'editor', 'Old').catch((e) => e)
    flow.clear()
    port.preview.mockImplementation(async (prefix) => ({ ...preview(), prefix, files: [] }))
    const shown = await flow.review('Public/', 'editor', 'Visible')
    finish({ ...preview(), prefix: 'Private/', files: [] })
    expect(await old).toBeInstanceOf(Error)
    expect(flow.preview?.prefix).toBe('Public/')
    port.create.mockImplementation(async (_session, request) => ({
      id: 'sample-grant',
      prefix: request.prefix,
      role: request.role,
      revision: 0,
    }))
    await flow.confirm('invented-password', undefined, shown)
    expect(port.create).toHaveBeenCalledWith(expect.anything(), {
      prefix: 'Public/',
      role: 'editor',
      label: 'Visible',
    })
  })
  it('binds confirmation to the exact preview shown, not another current draft', async () => {
    const { flow, port } = setup()
    const shown = await flow.review('Agents/', 'editor', 'Shown')
    port.preview.mockImplementation(async (prefix) => ({ ...preview(), prefix, files: [] }))
    await flow.review('Other/', 'editor', 'Other')
    await expect(flow.confirm('invented-password', undefined, shown)).rejects.toThrow(
      /preview|review/i
    )
    expect(port.authorize).not.toHaveBeenCalled()
    expect(port.create).not.toHaveBeenCalled()
  })
  it('refuses an earlier displayed review even when paths/cache are identical but rights changed', async () => {
    const { flow, port } = setup()
    const shown = await flow.review('Agents/', 'editor', 'Earlier')
    flow.clear()
    await flow.review('Agents/', 'reader', 'Current')
    await expect(flow.confirm('invented-password', undefined, shown)).rejects.toThrow(
      /review|preview/i
    )
    expect(port.authorize).not.toHaveBeenCalled()
    expect(port.create).not.toHaveBeenCalled()
  })
  it('does not cross from a closed authentication into a new review', async () => {
    const { flow, port } = setup()
    await flow.review('Agents/', 'editor', 'Original')
    let finish!: (s: Awaited<ReturnType<typeof port.authorize>>) => void
    port.authorize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const confirmation = flow.confirm('invented-password').catch((e) => e)
    flow.clear()
    await flow.review('Agents/', 'editor', 'Replacement')
    finish({
      facet: 'account',
      ownerVaultId: 'sample-vault',
      authenticatedAt: 1000,
      expiresAt: 100000,
    })
    expect(await confirmation).toBeInstanceOf(Error)
    expect(port.create).not.toHaveBeenCalled()
  })
  it('allows owner sharing through the production default after review and authorization', async () => {
    const { port } = setup()
    port.authorize.mockResolvedValue({
      facet: 'account',
      ownerVaultId: 'sample-vault',
      authenticatedAt: Date.now() - 1000,
      expiresAt: Date.now() + 100000,
    })
    const flow = new FolderSharingFlow('sample-vault', port)
    await flow.review('Agents/', 'editor', 'Sample')
    const result = await flow.confirm('invented-password')
    expect(result.token).toMatch(/^absk_/)
    expect(port.authorize).toHaveBeenCalledWith('invented-password')
    expect(port.create).toHaveBeenCalledTimes(1)
  })
  it('refuses remote mutations behind the explicitly disabled fence', async () => {
    const { port } = setup()
    const flow = new FolderSharingFlow('sample-vault', port, () => false)
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
  it('rejects malformed freshness fields before any grant is created', async () => {
    const { flow, port } = setup()
    await flow.review('Agents/', 'editor', 'Sample')
    port.authorize.mockResolvedValue({
      facet: 'account',
      ownerVaultId: 'sample-vault',
      authenticatedAt: NaN,
      expiresAt: 100000,
    })
    await expect(flow.confirm('invented-password')).rejects.toThrow(/owner/)
    expect(port.create).not.toHaveBeenCalled()
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
