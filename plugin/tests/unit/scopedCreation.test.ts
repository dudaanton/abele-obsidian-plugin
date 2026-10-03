import { describe, it, expect, vi } from 'vitest'
import { ScopedCreationFlow, type CreationScope } from '@/sync/scoped/scopedCreation'
function setup() {
  const scope: CreationScope = {
      issuer: 'https://sync.example',
      vaultId: 'sample-vault',
      grantId: 'sample-grant',
      principalId: 'sample-install',
      role: 'editor',
      state: 'active',
      generation: '1',
      selector: {
        kind: 'group',
        roots: [
          {
            fileId: 'sample-root',
            versionId: 'root-v1',
            label: 'Sample project',
            spelling: 'Sample project',
            approved: true,
          },
        ],
      },
    },
    local = new Map<string, string>(),
    meta = {
      getMeta: (k: string) => local.get(k) ?? null,
      setMeta: (k: string, v: string | null) => {
        if (v === null) local.delete(k)
        else local.set(k, v)
      },
    },
    port = {
      scope: vi.fn(async () => structuredClone(scope)),
      exists: vi.fn(async () => false),
      sponsorCurrent: vi.fn(async () => true),
      place: vi.fn(async () => {}),
      upload: vi.fn(async () => ({
        principalId: scope.principalId,
        grantId: scope.grantId,
        sha: '',
        entitlementId: 'sample-own-upload',
      })),
      create: vi.fn(async () => ({ fileId: 'sample-new', versionId: 'new-v1', created: true })),
      link: vi.fn(async () => {}),
    }
  return {
    scope,
    local,
    meta,
    port,
    flow: new ScopedCreationFlow(
      meta,
      port,
      () => true,
      () => true
    ),
  }
}
describe('fenced exact-path native creation choices', () => {
  it('default fence performs no local create/upload', async () => {
    const s = setup()
    await expect(
      new ScopedCreationFlow(s.meta, s.port).review({
        kind: 'note',
        path: 'Scattered/new.md',
        text: 'sample',
        rootId: 'sample-root',
      })
    ).rejects.toThrow(/disabled/)
    expect(s.port.place).not.toHaveBeenCalled()
    expect(s.port.upload).not.toHaveBeenCalled()
  })
  it('reader or lost writer cannot place/upload a new file', async () => {
    const s = setup()
    s.scope.role = 'reader'
    await expect(
      s.flow.review({
        kind: 'note',
        path: 'Scattered/new.md',
        text: 'sample',
        rootId: 'sample-root',
      })
    ).rejects.toThrow(/editor/)
    await expect(
      new ScopedCreationFlow(
        s.meta,
        s.port,
        () => true,
        () => false
      ).review({ kind: 'note', path: 'Scattered/new.md', text: 'sample' })
    ).rejects.toThrow(/writer/)
    expect(s.port.place).not.toHaveBeenCalled()
    expect(s.port.upload).not.toHaveBeenCalled()
  })
  it('reviews an exact new scattered note with only the approved root field and durable handle', async () => {
    const s = setup()
    s.port.upload.mockImplementation(async (_path, bytes: any) => ({
      principalId: s.scope.principalId,
      grantId: s.scope.grantId,
      sha: bytes.sha,
      entitlementId: 'sample-own-upload',
    }))
    const review = await s.flow.review({
      kind: 'note',
      path: 'Scattered/new.md',
      text: 'sample',
      rootId: 'sample-root',
    })
    expect(review.text).toBe('---\ngroups:\n  - "[[Sample project]]"\n---\nsample')
    await s.flow.confirm(review)
    expect(s.local.size).toBeGreaterThan(0)
    expect(s.port.place).toHaveBeenCalledWith(
      'Scattered/new.md',
      expect.anything(),
      expect.any(String)
    )
    expect(s.port.create).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'Scattered/new.md',
        root: expect.objectContaining({ fileId: 'sample-root', versionId: 'root-v1' }),
      })
    )
  })
  it('root-folder paste keeps the exact target path but requires current intrinsic sponsor and this principal upload proof', async () => {
    const s = setup()
    s.port.upload.mockImplementation(async (_p, bytes: any) => ({
      principalId: s.scope.principalId,
      grantId: s.scope.grantId,
      sha: bytes.sha,
      entitlementId: 'sample-own-upload',
    }))
    const review = await s.flow.review({
      kind: 'asset',
      path: 'sample-image.png',
      bytes: new Uint8Array([0, 255, 1]),
      sponsor: {
        fileId: 'sample-note',
        versionId: 'note-v1',
        inScope: true,
        intrinsic: true,
        admissionGeneration: 1,
      },
    })
    await s.flow.confirm(review)
    expect(s.port.create).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'sample-image.png',
        sponsor: expect.objectContaining({ fileId: 'sample-note' }),
      })
    )
    expect(s.port.link).toHaveBeenCalledWith('sample-note', 'sample-image.png')
  })
  it('a changed root/view, reader role, stale choice or foreign upload proof cannot create/link', async () => {
    const s = setup()
    const r = await s.flow.review({
      kind: 'note',
      path: 'Scattered/new.md',
      text: 'sample',
      rootId: 'sample-root',
    })
    s.scope.generation = '2'
    await expect(s.flow.confirm(r)).rejects.toThrow(/scope|review/)
    expect(s.port.place).not.toHaveBeenCalled()
    s.scope.generation = '1'
    const t = setup(),
      image = await t.flow.review({
        kind: 'asset',
        path: 'sample-image.png',
        bytes: new Uint8Array([1]),
        sponsor: {
          fileId: 'sample-note',
          versionId: 'note-v1',
          inScope: true,
          intrinsic: true,
          admissionGeneration: 1,
        },
      })
    t.port.upload.mockResolvedValue({
      principalId: 'foreign',
      grantId: t.scope.grantId,
      sha: image.sha,
      entitlementId: 'sample-own-upload',
    })
    await expect(t.flow.confirm(image)).rejects.toThrow(/upload|principal/)
    expect(t.port.create).not.toHaveBeenCalled()
    expect(t.port.link).not.toHaveBeenCalled()
  })
  it('scope/root revision changed during upload cannot authorize the earlier choice', async () => {
    const s = setup()
    s.port.upload.mockImplementation(async (_p, bytes: any) => {
      s.scope.generation = '2'
      return {
        principalId: s.scope.principalId,
        grantId: s.scope.grantId,
        sha: bytes.sha,
        entitlementId: 'sample-upload',
      }
    })
    const r = await s.flow.review({
      kind: 'note',
      path: 'Scattered/new.md',
      text: 'sample',
      rootId: 'sample-root',
    })
    await expect(s.flow.confirm(r)).rejects.toThrow(/scope|root/)
    expect(s.port.create).not.toHaveBeenCalled()
  })
  it('occupied/default disallowed path is a generic hold, never a received-file remap or replacement', async () => {
    const s = setup()
    s.scope.selector = { kind: 'folder', prefix: 'Agents/' }
    await expect(s.flow.review({ kind: 'note', path: 'new.md', text: 'sample' })).rejects.toThrow(
      /choose|path/
    )
    s.port.exists.mockResolvedValue(true)
    await expect(
      s.flow.review({ kind: 'note', path: 'Agents/new.md', text: 'sample' })
    ).rejects.toThrow(/occupied/)
    expect(s.port.place).not.toHaveBeenCalled()
  })
  it('reopens the durable native create without placing another file and holds a stale sponsor', async () => {
    const s = setup()
    s.port.upload.mockImplementation(async (_p, bytes: any) => ({
      principalId: s.scope.principalId,
      grantId: s.scope.grantId,
      sha: bytes.sha,
      entitlementId: 'sample-own-upload',
    }))
    const r = await s.flow.review({
      kind: 'asset',
      path: 'sample-image.png',
      bytes: new Uint8Array([1]),
      sponsor: {
        fileId: 'sample-note',
        versionId: 'note-v1',
        inScope: true,
        intrinsic: true,
        admissionGeneration: 1,
      },
    })
    s.port.create.mockRejectedValueOnce(new Error('lost reply'))
    await expect(s.flow.confirm(r)).rejects.toThrow(/lost/)
    const resumed = new ScopedCreationFlow(
        s.meta,
        s.port,
        () => true,
        () => true
      ),
      shown = await resumed.resume(r.id)
    s.port.sponsorCurrent.mockResolvedValue(false)
    await expect(resumed.confirm(shown)).rejects.toThrow(/sponsor/)
    expect(s.port.place).toHaveBeenCalledTimes(1)
    expect(s.port.create).toHaveBeenCalledTimes(1)
    expect(s.port.link).not.toHaveBeenCalled()
  })
  it('lost native create reply retries the exact handle/bytes, not a second file or changed link', async () => {
    const s = setup()
    s.port.upload.mockImplementation(async (_p, bytes: any) => ({
      principalId: s.scope.principalId,
      grantId: s.scope.grantId,
      sha: bytes.sha,
      entitlementId: 'sample-own-upload',
    }))
    const r = await s.flow.review({
      kind: 'note',
      path: 'Scattered/new.md',
      text: 'sample',
      rootId: 'sample-root',
    })
    s.port.create.mockRejectedValueOnce(new Error('lost reply'))
    await expect(s.flow.confirm(r)).rejects.toThrow(/lost/)
    const body = structuredClone(s.port.create.mock.calls[0][0])
    await s.flow.confirm(r)
    expect(s.port.create.mock.calls[1][0]).toEqual(body)
    expect(s.port.place).toHaveBeenCalledTimes(1)
  })
})
