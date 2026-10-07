// @vitest-environment node
import { it, expect, vi } from 'vitest'
import { MemoryStateStore, sha256 } from '@abele/sync-core'
import { NativeOwnerPublication } from '@/sync/publication/nativeOwnerPublication'
import { buildFakeVault } from '../helpers/fakeVault'
async function setup() {
  const source = 'received sample\n',
    bytes = new TextEncoder().encode(source),
    sha = await sha256(bytes),
    app = buildFakeVault([{ path: 'Received.md', content: source }]),
    events = new Map<string, (...args: any[]) => void>(),
    meta = new MemoryStateStore(),
    state = new MemoryStateStore()
  ;(app.metadataCache as any).on = (name: string, fn: (...args: any[]) => void) => {
    events.set(name, fn)
    return {}
  }
  ;(app.metadataCache as any).offref = () => {}
  vi.spyOn(state, 'byFileId').mockResolvedValue({
    path: 'Received.md',
    wirePath: 'Received.md',
    fileId: 'sample-received',
    versionId: 'received-v2',
    sha,
    size: bytes.length,
    mtime: 1,
  } as any)
  const p = new NativeOwnerPublication({
    app: app as any,
    meta,
    state,
    client: { commitRaw: vi.fn() } as any,
    binding: {
      localVault: 'sample-local',
      issuer: 'https://sync.example',
      vaultId: 'sample-vault',
      principal: 'sample-owner',
      facet: 'personal',
      grantId: null,
    },
    grants: ['sample-grant'],
    token: () => 'absd_' + 'a'.repeat(43),
    fetch: vi.fn() as any,
    configurationRoots: () => ['.obsidian', 'Scripts'],
    enabled: () => true,
    held: () => true,
    eventTarget: { addEventListener: () => {}, removeEventListener: () => {} } as any,
  })
  await p.start(true)
  events.get('changed')!({ path: 'Received.md' }, source, { links: [], embeds: [] })
  await p.flush()
  return {
    p,
    events,
    state,
    sha,
    bytes,
    event: {
      deliveryId: 'sample-received:received-v2',
      fileId: 'sample-received',
      versionId: 'received-v2',
      path: 'Received.md',
      sha,
      size: bytes.length,
      source: 'personal' as const,
      automatic: 'enabled' as const,
    },
  }
}
it('records an exact received last-synced baseline through the reviewed personal pull hook', async () => {
  const s = await setup()
  try {
    await (s.p.hooks as any).onPersonalNoteApplied(s.event, s.bytes)
    const snapshot = await (s.p as any).snapshots.get(s.event.fileId)
    expect(snapshot).toMatchObject({
      kind: 'complete',
      origin: 'pull',
      versionId: 'received-v2',
      sha: s.sha,
      facts: [],
    })
  } finally {
    s.p.close()
  }
})
it.each([true, false])(
  'a received link (resolved=%s) plus an ordinary edit never proposes a question',
  async (resolved) => {
    const s = await setup()
    try {
      const source = '[[private.png]]',
        sha = await sha256(new TextEncoder().encode(source))
      const app = (s.p as any).options.app
      app.metadataCache.getFirstLinkpathDest = () =>
        resolved ? { path: 'Assets/private.png' } : null
      const cache = {
        links: [
          {
            link: 'private.png',
            original: source,
            position: { start: { offset: 0 }, end: { offset: source.length } },
          },
        ],
      }
      const entry = {
        path: 'Received.md',
        wirePath: 'Received.md',
        fileId: s.event.fileId,
        versionId: s.event.versionId,
        sha,
        size: source.length,
        mtime: 1,
      }
      vi.mocked(s.state.byFileId).mockResolvedValue(entry)
      s.events.get('changed')!({ path: entry.path }, source, cache)
      await s.p.flush()
      await s.p.hooks.onPersonalNoteApplied(
        { ...s.event, sha, size: source.length },
        new TextEncoder().encode(source)
      )
      await s.state.put({
        path: 'Assets/private.png',
        wirePath: 'Assets/private.png',
        fileId: 'private-id',
        versionId: 'private-v1',
        sha: 'a'.repeat(64),
        size: 1,
        mtime: 1,
      })
      app.metadataCache.getFirstLinkpathDest = () => ({ path: 'Assets/private.png' })
      const edited = source + '\nordinary body edit',
        editedSha = await sha256(new TextEncoder().encode(edited))
      s.events.get('changed')!({ path: entry.path }, edited, cache)
      await s.p.flush()
      const op = {
        op: 'update',
        file_id: entry.fileId,
        base_version_id: entry.versionId,
        sha: editedSha,
        size: edited.length,
        mtime: 2,
      }
      await s.p.hooks.beforeUpload!({
        operations: [{ op, index: 0, handle: 'sample-handle' }],
        idempotencyKey: 'sample-request',
      } as any)
      await s.p.hooks.onSettled!(
        {
          op,
          fileId: entry.fileId,
          versionId: 'edited-v3',
          path: entry.path,
          sha: editedSha,
          handle: 'sample-handle',
          result: { status: 'applied' },
        } as any,
        new TextEncoder().encode(edited),
        'sample-request'
      )
      expect(await (s.p as any).read('existing-candidates')).toBeNull()
    } finally {
      s.p.close()
    }
  }
)
it.each(['applied', 'merged'])(
  'compares saved local facts before %s settlement, not merged facts',
  async (status) => {
    const s = await setup()
    try {
      await s.p.hooks.onPersonalNoteApplied(s.event, s.bytes)
      await s.state.put({
        path: 'Assets/private.png',
        wirePath: 'Assets/private.png',
        fileId: 'private-id',
        versionId: 'private-v1',
        sha: 'a'.repeat(64),
        size: 1,
        mtime: 1,
      })
      const app = (s.p as any).options.app
      app.metadataCache.getFirstLinkpathDest = () => ({ path: 'Assets/private.png' })
      const source = '[[private.png]]',
        sha = await sha256(new TextEncoder().encode(source))
      const cache = {
        links: [
          {
            link: 'private.png',
            original: source,
            position: { start: { offset: 0 }, end: { offset: source.length } },
          },
        ],
      }
      s.events.get('changed')!({ path: 'Received.md' }, source, cache)
      await s.p.flush()
      const op = {
        op: 'update',
        file_id: s.event.fileId,
        base_version_id: s.event.versionId,
        sha,
        size: source.length,
        mtime: 2,
      }
      await s.p.hooks.beforeUpload!({
        operations: [{ op, index: 0, handle: 'sample-handle' }],
        idempotencyKey: 'sample-request',
      } as any)
      // The merge may contain someone else's newly received link: do not count it as local.
      const merged = source + '\n[[received.png]]'
      app.metadataCache.getFirstLinkpathDest = (link: string) => ({
        path: link === 'received.png' ? 'received.png' : 'Assets/private.png',
      })
      await s.state.put({
        path: 'received.png',
        wirePath: 'received.png',
        fileId: 'received-asset',
        versionId: 'asset-v1',
        sha: 'b'.repeat(64),
        size: 1,
        mtime: 1,
      })
      const settledSource = status === 'merged' ? merged : source
      const settledSha = await sha256(new TextEncoder().encode(settledSource))
      s.events.get('changed')!(
        { path: 'Received.md' },
        settledSource,
        status === 'merged'
          ? {
              links: [
                ...cache.links,
                {
                  link: 'received.png',
                  original: '[[received.png]]',
                  position: {
                    start: { offset: source.length + 1 },
                    end: { offset: merged.length },
                  },
                },
              ],
            }
          : cache
      )
      await s.p.flush()
      await s.p.hooks.onSettled!(
        {
          op,
          fileId: s.event.fileId,
          versionId: 'local-v3',
          path: 'Received.md',
          sha: settledSha,
          handle: 'sample-handle',
          result: { status },
        } as any,
        new TextEncoder().encode(settledSource),
        'sample-request'
      )
      expect(await (s.p as any).read('existing-candidates')).toEqual([
        { sponsorId: s.event.fileId, targetId: 'private-id', targetPath: 'Assets/private.png' },
      ])
      expect(await (s.p as any).snapshots.get(s.event.fileId)).toMatchObject({
        kind: 'complete',
        versionId: 'local-v3',
      })
    } finally {
      s.p.close()
    }
  }
)
it('wires vault rename events to stable ledger identity without rewriting the baseline', async () => {
  const s = await setup()
  try {
    const app = (s.p as any).options.app
    await s.state.put({
      path: 'Assets/private.png',
      wirePath: 'Assets/private.png',
      fileId: 'private-id',
      versionId: 'private-v1',
      sha: 'a'.repeat(64),
      size: 1,
      mtime: 1,
    })
    app.emit('vault', 'rename', { path: 'Assets/renamed.png' }, 'Assets/private.png')
    await s.p.flush()
    expect(await (s.p as any).snapshots.renames()).toEqual({
      complete: true,
      items: [{ fileId: 'private-id', from: 'Assets/private.png', to: 'Assets/renamed.png' }],
    })
  } finally {
    s.p.close()
  }
})
it('settles personal uploads without publication HTTP, then asks and publishes outside the transaction', async () => {
  const s = await setup()
  try {
    await s.p.hooks.onPersonalNoteApplied(s.event, s.bytes)
    const app = (s.p as any).options.app,
      assets = (s.p as any).assets
    const targetBytes = new Uint8Array([1, 2, 3]),
      targetSha = await sha256(targetBytes)
    await app.vault.createBinary('Assets/private.png', targetBytes.buffer)
    await app.vault.adapter.writeBinary('Assets/private.png', targetBytes.buffer)
    const target = {
      path: 'Assets/private.png',
      wirePath: 'Assets/private.png',
      fileId: 'private-id',
      versionId: 'private-v1',
      sha: targetSha,
      size: 3,
      mtime: 1,
    }
    await s.state.put(target)
    const source = '[[private.png]]',
      sha = await sha256(new TextEncoder().encode(source))
    const note = {
      path: 'Received.md',
      wirePath: 'Received.md',
      fileId: s.event.fileId,
      versionId: 'note-v3',
      sha,
      size: source.length,
      mtime: 2,
    }
    vi.mocked(s.state.byFileId).mockImplementation(async (id) =>
      id === target.fileId ? target : id === note.fileId ? note : null
    )
    await app.vault.modify(app.vault.getAbstractFileByPath(note.path), source)
    app.metadataCache.getFirstLinkpathDest = () => ({ path: target.path })
    s.events.get('changed')!({ path: note.path }, source, {
      links: [
        {
          link: 'private.png',
          original: source,
          position: { start: { offset: 0 }, end: { offset: source.length } },
        },
      ],
    })
    await s.p.flush()
    let transaction = false
    const visibility = vi.spyOn(assets, 'visibility').mockImplementation(async () => {
      expect(transaction).toBe(false)
      return {
        grantId: 'sample-grant',
        label: 'Sample audience',
        targetFileId: target.fileId,
        visible: false,
        targetVersionId: null,
        revision: 0,
        scopeRevision: 1,
        withdrawalGeneration: 0,
      }
    })
    vi.spyOn(assets, 'sponsorProof').mockResolvedValue({
      fileId: note.fileId,
      versionId: note.versionId,
      admissionGeneration: 1,
      inScope: true,
      intrinsic: true,
    })
    const add = vi.spyOn(assets, 'add').mockImplementation(async () => {
      expect(transaction).toBe(false)
      return {}
    })
    const op = {
      op: 'update',
      file_id: note.fileId,
      base_version_id: s.event.versionId,
      sha,
      size: source.length,
      mtime: 2,
    }
    await expect(
      s.p.hooks.beforeUpload!({
        operations: [
          { op, index: 0, handle: 'sample-handle' },
          {
            op: { op: 'update', file_id: target.fileId, sha: targetSha },
            index: 1,
            handle: 'private-handle',
          },
        ],
        idempotencyKey: 'sample-request',
      } as any)
    ).resolves.toBeUndefined()
    await s.state.transaction(async () => {
      transaction = true
      await s.p.hooks.onSettled!(
        {
          op,
          fileId: note.fileId,
          versionId: note.versionId,
          path: note.path,
          sha,
          handle: 'sample-handle',
          result: { status: 'applied' },
        } as any,
        new TextEncoder().encode(source),
        'sample-request'
      )
      transaction = false
    })
    expect(visibility).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
    await s.p.refreshPublication()
    const [question] = await s.p.confirmation.questions()
    expect(question.observation.audience.label).toBe('Sample audience')
    expect(add).not.toHaveBeenCalled()
    visibility.mockImplementationOnce(async () => {
      await app.vault.modify(
        app.vault.getAbstractFileByPath(note.path),
        'link removed while HTTP was in flight'
      )
      return {
        grantId: 'sample-grant',
        label: 'Sample audience',
        targetFileId: target.fileId,
        visible: false,
        targetVersionId: null,
        revision: 0,
        scopeRevision: 1,
        withdrawalGeneration: 0,
      }
    })
    expect(await s.p.confirmation.answer(question, true)).toBe(false)
    expect(add).not.toHaveBeenCalled()
    await app.vault.modify(app.vault.getAbstractFileByPath(note.path), source)
    expect(await s.p.confirmation.answer(question, true)).toBe(true)
    expect(add).toHaveBeenCalledTimes(1)
  } finally {
    s.p.close()
  }
})
it.each(['applied', 'merged'] as const)(
  'recovers late cache after %s settlement without assigning merged paste authorship',
  async (status) => {
    const s = await setup()
    try {
      await s.p.hooks.onPersonalNoteApplied(s.event, s.bytes)
      const p = s.p as any
      const source = s.bytes.length
        ? new TextDecoder().decode(s.bytes) + '![[sample-image.png]]'
        : ''
      const sha = await sha256(new TextEncoder().encode(source))
      const note = {
        path: 'Received.md',
        wirePath: 'Received.md',
        fileId: s.event.fileId,
        versionId: 'local-v3',
        sha,
        size: source.length,
        mtime: 2,
      }
      p.pastes.push({
        id: 'sample-paste',
        notePath: note.path,
        current: undefined,
        baseline: await p.snapshots.get(note.fileId),
        before: new TextDecoder().decode(s.bytes),
        start: s.bytes.length,
        end: s.bytes.length,
        epoch: 0,
      })
      const op = {
        op: 'modify',
        file_id: note.fileId,
        base_version_id: s.event.versionId,
        sha,
        size: source.length,
        mtime: 2,
      }
      await s.p.hooks.beforeUpload!({
        operations: [{ op, index: 0, handle: 'sample-handle' }],
        idempotencyKey: 'sample-request',
      } as any)
      vi.mocked(s.state.byFileId).mockResolvedValue(note)
      await s.p.hooks.onSettled!(
        {
          op,
          fileId: note.fileId,
          versionId: note.versionId,
          path: note.path,
          sha,
          handle: 'sample-handle',
          result: { status },
        } as any,
        new TextEncoder().encode(source),
        'sample-request'
      )
      s.events.get('changed')!({ path: note.path }, source, {
        embeds: [
          {
            link: 'sample-image.png',
            original: '![[sample-image.png]]',
            position: { start: { offset: s.bytes.length }, end: { offset: source.length } },
          },
        ],
      })
      await s.p.flush()
      if (status === 'applied')
        expect(p.pastes[0].sponsor).toEqual({ fileId: note.fileId, versionId: note.versionId, sha })
      else expect(p.pastes[0].sponsor).toBeUndefined()
      expect(await p.snapshots.get(note.fileId)).toMatchObject({
        kind: 'complete',
        versionId: note.versionId,
      })
    } finally {
      s.p.close()
    }
  }
)

it.each(['identity', 'resolution'] as const)(
  'asks about a new image when its %s is ready only after the note cache and upload',
  async (delayed) => {
    const s = await setup()
    try {
      await s.p.hooks.onPersonalNoteApplied(s.event, s.bytes)
      const p = s.p as any,
        app = p.options.app
      const image = new Uint8Array([4, 5, 6])
      await app.vault.createBinary('Assets/sample-image.png', image.buffer)
      await app.vault.adapter.writeBinary('Assets/sample-image.png', image.buffer)
      const source = '![[sample-image.png]]'
      const sha = await sha256(new TextEncoder().encode(source))
      const note = {
        path: 'Received.md',
        wirePath: 'Received.md',
        fileId: s.event.fileId,
        versionId: 'local-v3',
        sha,
        size: source.length,
        mtime: 2,
      }
      app.metadataCache.getFirstLinkpathDest = () =>
        delayed === 'resolution' ? null : { path: 'Assets/sample-image.png' }
      await app.vault.modify(app.vault.getAbstractFileByPath(note.path), source)
      s.events.get('changed')!({ path: note.path }, source, {
        embeds: [
          {
            link: 'sample-image.png',
            original: source,
            position: { start: { offset: 0 }, end: { offset: source.length } },
          },
        ],
      })
      await s.p.flush()
      const op = {
        op: 'modify',
        file_id: note.fileId,
        base_version_id: s.event.versionId,
        sha,
        size: source.length,
        mtime: 2,
      }
      await s.p.hooks.beforeUpload!({
        operations: [{ op, index: 0, handle: 'sample-handle' }],
        idempotencyKey: 'sample-request',
      } as any)
      vi.mocked(s.state.byFileId).mockResolvedValue(note)
      await s.p.hooks.onSettled!(
        {
          op,
          fileId: note.fileId,
          versionId: note.versionId,
          path: note.path,
          sha,
          handle: 'sample-handle',
          result: { status: 'applied' },
        } as any,
        new TextEncoder().encode(source),
        'sample-request'
      )
      const target = {
        path: 'Assets/sample-image.png',
        wirePath: 'Assets/sample-image.png',
        fileId: 'sample-image',
        versionId: 'image-v1',
        sha: await sha256(image),
        size: image.length,
        mtime: 2,
      }
      await s.state.put(target)
      vi.mocked(s.state.byFileId).mockImplementation(async (id) =>
        id === note.fileId ? note : id === target.fileId ? target : null
      )
      if (delayed === 'resolution') {
        app.metadataCache.getFirstLinkpathDest = () => ({ path: target.path })
        s.events.get('resolved')!()
      }
      vi.spyOn(p.assets, 'visibility').mockResolvedValue({
        grantId: 'sample-grant',
        label: 'Sample group',
        targetFileId: target.fileId,
        visible: false,
        targetVersionId: null,
        revision: 0,
        scopeRevision: 1,
        withdrawalGeneration: 0,
      })
      vi.spyOn(p.assets, 'sponsorProof').mockResolvedValue({
        fileId: note.fileId,
        versionId: note.versionId,
        admissionGeneration: 1,
        inScope: true,
        intrinsic: true,
      })
      const add = vi.spyOn(p.assets, 'add').mockResolvedValue({})
      await s.p.refreshPublication()
      const [question] = await s.p.confirmation.questions()
      expect(question?.observation.target.fileId).toBe(target.fileId)
      expect(add).not.toHaveBeenCalled()
      expect(await s.p.confirmation.answer(question, true)).toBe(true)
      expect(add).toHaveBeenCalledTimes(1)
    } finally {
      s.p.close()
    }
  }
)

it('a mismatched received delivery cannot certify a baseline', async () => {
  const s = await setup()
  try {
    await expect(
      (s.p.hooks as any).onPersonalNoteApplied({ ...s.event, versionId: 'wrong-version' }, s.bytes)
    ).rejects.toThrow(/delivery|personal version/)
    expect(await (s.p as any).snapshots.get(s.event.fileId)).toMatchObject({ kind: 'unknown' })
  } finally {
    s.p.close()
  }
})
