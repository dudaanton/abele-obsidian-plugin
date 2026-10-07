// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { MemoryStateStore } from '@abele/sync-core'
import {
  NativeOwnerPublication,
  nativePasteIntroduction,
  nativeAssetEligible,
} from '@/sync/publication/nativeOwnerPublication'
import { buildFakeVault } from '../helpers/fakeVault'
function setup() {
  const app = buildFakeVault([]),
    events = new Map<string, (...args: any[]) => void>(),
    meta = new MemoryStateStore(),
    state = new MemoryStateStore(),
    client = { commitRaw: vi.fn() },
    binding = {
      localVault: 'sample-local',
      issuer: 'https://sync.example',
      vaultId: 'sample-vault',
      principal: 'sample-owner',
      facet: 'personal' as const,
      grantId: null,
    }
  ;(app.workspace as any).on = (name: string, fn: (...args: any[]) => void) => {
    events.set(name, fn)
    return {}
  }
  ;(app.workspace as any).offref = () => {}
  ;(app.metadataCache as any).on = (name: string, fn: (...args: any[]) => void) => {
    events.set(name, fn)
    return {}
  }
  ;(app.metadataCache as any).offref = () => {}
  const make = (enabled = true) =>
    new NativeOwnerPublication({
      app: app as any,
      eventTarget: {
        addEventListener: (name: string, fn: (...args: any[]) => void) => events.set(name, fn),
        removeEventListener: () => {},
      } as unknown as Document,
      meta,
      state,
      client: client as any,
      binding,
      token: () => 'absd_' + 'a'.repeat(43),
      grants: ['sample-grant'],
      fetch: vi.fn() as any,
      enabled: () => enabled,
      held: () => true,
    })
  return { app, events, meta, state, client, make }
}
describe('native owner paste preflight, not note-wide authorship', () => {
  it('unknown/configuration/script paths never become eligible native publication targets', () => {
    expect(nativeAssetEligible('Images/sample.png', ['.obsidian', 'Scripts'])).toBe(true)
    for (const path of [
      '.obsidian/sample.png',
      'Scripts/sample.png',
      'Images/../sample.png',
      'Images/sample.js',
    ])
      expect(nativeAssetEligible(path, ['.obsidian', 'Scripts'])).toBe(false)
    expect(nativeAssetEligible('Images/sample.png', undefined)).toBe(false)
  })
  it('certifies only the exact paste-range embed insertion, never a foreign rewrite with unrelated owner body edit', () => {
    const before = 'owner body\n![[foreign.png]]\n',
      token = '![[native.png]]',
      source = before + token,
      fact = {
        kind: 'embed' as const,
        spelling: 'native.png',
        original: token,
        start: before.length,
        end: source.length,
        resolvedPath: 'Images/native.png',
        targetId: null,
        resolution: 'resolved' as const,
      }
    expect(
      nativePasteIntroduction(
        before,
        before.length,
        before.length,
        source,
        'Images/native.png',
        fact
      )
    ).toBe(true)
    expect(
      nativePasteIntroduction(
        before,
        before.length,
        before.length,
        source.replace('owner body', 'owner edited body'),
        'Images/native.png',
        { ...fact, start: before.length + 7, end: source.length + 7 }
      )
    ).toBe(false)
    expect(
      nativePasteIntroduction(
        before,
        before.length,
        before.length,
        before.replace('foreign.png', 'native.png'),
        'Images/native.png',
        { ...fact, start: 11, end: 25 }
      )
    ).toBe(false)
  })
  it('missing or modified retained native evidence stops reopen without minting another baseline', async () => {
    const s = setup(),
      p = s.make()
    await p.start(true)
    p.close()
    const key =
        'native-owner-v1:' +
        JSON.stringify({
          localVault: 'sample-local',
          issuer: 'https://sync.example',
          vaultId: 'sample-vault',
          principal: 'sample-owner',
          facet: 'personal',
          grantId: null,
        }) +
        ':pastes',
      raw = (await s.meta.getMeta(key))!
    const edited = JSON.parse(raw)
    edited.value = [{ id: 'forged' }]
    await s.meta.setMeta(key, JSON.stringify(edited))
    await expect(s.make().start(false)).rejects.toThrow(/evidence.*checksum|evidence.*corrupt/i)
    vi.spyOn(s.meta, 'getMeta').mockResolvedValue(null)
    await expect(s.make().start(false)).rejects.toThrow(/evidence missing/)
    expect(s.client.commitRaw).not.toHaveBeenCalled()
  })
  it('does not retain empty link evidence for an ordinary binary upload', async () => {
    const s = setup(),
      owner = s.make()
    await owner.start(true)
    try {
      const op = {
        op: 'create' as const,
        path: 'Images/sample.png',
        sha: 'a'.repeat(64),
        size: 1,
        mtime: 1,
      }
      await owner.hooks.beforeUpload!({
        idempotencyKey: 'sample-binary-request',
        operations: [{ index: 0, handle: 'sample-binary-handle', op }],
      } as never)
      const key =
        'native-owner-v1:' +
        JSON.stringify((owner as any).options.binding) +
        ':link-unit:sample-binary-request'
      expect(await s.meta.getMeta(key)).toBeNull()
      for (const retained of [{}, { facts: {}, localCreates: [], delayed: {} }]) {
        await (owner as any).persisted('link-unit:sample-binary-request', retained)
        await owner.hooks.onSettled!(
          {
            op,
            path: op.path,
            handle: 'sample-binary-handle',
            fileId: 'sample-file',
            versionId: 'sample-version',
            sha: op.sha,
            result: { status: 'applied' },
          } as never,
          new Uint8Array([1]),
          'sample-binary-request'
        )
        expect(await s.meta.getMeta(key)).toBeNull()
      }
    } finally {
      owner.close()
    }
  })

  it('default disabled activation performs no event installation or storage bootstrap', async () => {
    const s = setup()
    await expect(s.make(false).start(true)).rejects.toThrow(/disabled/)
    expect(s.events.size).toBe(0)
    expect(s.client.commitRaw).not.toHaveBeenCalled()
  })
  it('untrusted synthetic paste cannot acquire owner introduction or new asset intent', async () => {
    const s = setup(),
      p = s.make()
    await p.start(true)
    s.events.get('paste')!(
      {
        isTrusted: false,
        defaultPrevented: false,
        clipboardData: {
          files: [{ type: 'image/png', arrayBuffer: async () => new Uint8Array([1]).buffer }],
        },
      },
      { getValue: () => '' },
      { file: { path: 'Agents/sample.md' } }
    )
    await p.flush()
    expect(p.diagnostics().pastes).toEqual([])
    p.close()
  })
  it('callback source/cache offsets mismatch is unknown, never fabricated complete evidence', async () => {
    const s = setup(),
      p = s.make()
    await p.start(true)
    s.events.get('changed')!({ path: 'Agents/sample.md' }, 'sample', {
      embeds: [
        {
          link: 'sample.png',
          original: '![[sample.png]]',
          position: { start: { offset: 0 }, end: { offset: 15 } },
        },
      ],
    })
    await p.flush()
    expect(p.diagnostics().cacheErrors).toBeGreaterThan(0)
    p.close()
  })
})
