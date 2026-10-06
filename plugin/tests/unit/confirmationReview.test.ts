// @vitest-environment node
import { it, expect, vi } from 'vitest'
import { MemoryStateStore, sha256 } from '@abele/sync-core'
import { NativeOwnerPublication } from '@/sync/publication/nativeOwnerPublication'
import { existingPublicationQuestion } from '@/sync/publication/publicationDecision'
import { PublicationPrompt } from '@/sync/publicationPrompt'
import { buildFakeVault } from '../helpers/fakeVault'
const link = '[[private.png]]'
async function fixture(receivedLink = false, delayedPull = false) {
  const source = receivedLink ? link : 'shared baseline\n'
  const app = buildFakeVault([
    { path: 'Shared/board.md', content: source },
    { path: 'Assets/private.png', content: '' },
  ])
  const bytes = new Uint8Array([11, 12, 13]),
    meta = new MemoryStateStore(),
    state = new MemoryStateStore()
  await app.vault.adapter.writeBinary('Assets/private.png', bytes.buffer)
  const target = {
    path: 'Assets/private.png',
    wirePath: 'Assets/private.png',
    fileId: 'sample-target',
    versionId: 'target-v1',
    sha: await sha256(bytes),
    size: bytes.length,
    mtime: 1,
  }
  let sponsor = {
    path: 'Shared/board.md',
    wirePath: 'Shared/board.md',
    fileId: 'sample-note',
    versionId: 'note-v1',
    sha: await sha256(new TextEncoder().encode(source)),
    size: source.length,
    mtime: 1,
  }
  await state.put(target)
  await state.put(sponsor)
  let destination = target.path
  vi.spyOn(app.metadataCache, 'getFirstLinkpathDest').mockImplementation(
    () => app.vault.getAbstractFileByPath(destination) as any
  )
  const options = {
    app: app as any,
    meta,
    state,
    client: { commitRaw: vi.fn() } as any,
    binding: {
      localVault: 'sample-local',
      issuer: 'https://sync.example',
      vaultId: 'sample-vault',
      principal: 'sample-owner',
      facet: 'personal' as const,
      grantId: null,
    },
    grants: ['sample-grant'],
    token: () => 'absd_' + 'a'.repeat(43),
    fetch: vi.fn() as any,
    enabled: () => true,
    held: () => true,
    configurationRoots: () => ['.obsidian', 'Scripts'],
    eventTarget: { addEventListener: () => {}, removeEventListener: () => {} } as any,
  }
  let runtime = new NativeOwnerPublication(options)
  const installPorts = () => {
    const assets = (runtime as any).assets
    const visibility = vi.spyOn(assets, 'visibility').mockResolvedValue({
      grantId: 'sample-grant',
      label: 'Sample audience',
      targetFileId: target.fileId,
      visible: false,
      targetVersionId: null,
      scopeRevision: 1,
      revision: 0,
      withdrawalGeneration: 0,
    })
    vi.spyOn(assets, 'sponsorProof').mockImplementation(async () => ({
      fileId: sponsor.fileId,
      versionId: sponsor.versionId,
      admissionGeneration: 1,
      inScope: true,
      intrinsic: true,
    }))
    return { add: vi.spyOn(assets, 'add').mockResolvedValue({}), visibility }
  }
  let ports = installPorts()
  await runtime.start(true)
  const changed = async (text: string) => {
    const start = text.indexOf(link)
    const cache = {
      links:
        start < 0
          ? []
          : [
              {
                link: 'private.png',
                original: link,
                position: { start: { offset: start }, end: { offset: start + link.length } },
              },
            ],
    }
    app.emit('metadataCache', 'changed', app.vault.getAbstractFileByPath(sponsor.path), text, cache)
    await runtime.flush()
  }
  const pull = () =>
    runtime.hooks.onPersonalNoteApplied(
      {
        deliveryId: sponsor.fileId + ':' + sponsor.versionId,
        fileId: sponsor.fileId,
        versionId: sponsor.versionId,
        path: sponsor.path,
        sha: sponsor.sha,
        size: sponsor.size,
        source: 'personal',
        automatic: 'enabled',
      },
      new TextEncoder().encode(source)
    )
  if (!receivedLink && !delayedPull) {
    await changed(source)
    await pull()
  }
  const local = async (
    text: string,
    creation?: 'novel' | 'adopted' | 'collision',
    indexed: boolean | 'settlement' = true
  ) => {
    if (creation) {
      await state.delete(sponsor.path)
      app.emit('vault', 'create', app.vault.getAbstractFileByPath(sponsor.path))
      await runtime.flush()
    }
    await app.vault.modify(app.vault.getAbstractFileByPath(sponsor.path)!, text)
    if (indexed === true) await changed(text)
    const sha = await sha256(new TextEncoder().encode(text))
    const op = creation
      ? { op: 'create' as const, path: sponsor.path, sha, size: text.length, mtime: 2 }
      : {
          op: 'modify' as const,
          file_id: sponsor.fileId,
          base_version_id: sponsor.versionId,
          sha,
          size: text.length,
          mtime: 2,
        }
    await runtime.hooks.beforeUpload!({
      operations: [{ op, index: 0, handle: 'sample-handle' }],
      idempotencyKey: 'sample-request',
    } as any)
    if (indexed === 'settlement') await changed(text)
    sponsor = {
      ...sponsor,
      fileId: creation ? 'sample-created-note' : sponsor.fileId,
      sha,
      size: text.length,
      versionId: 'note-v2',
    }
    await state.put(sponsor)
    await runtime.hooks.onSettled!(
      {
        op,
        creation: creation ?? 'unknown',
        fileId: sponsor.fileId,
        versionId: sponsor.versionId,
        path: sponsor.path,
        sha,
        handle: 'sample-handle',
        result: { status: 'applied' },
      } as any,
      new TextEncoder().encode(text),
      'sample-request'
    )
  }
  const shadow = async (notify = true) => {
    const from = 'Other/alternate.png',
      to = 'Shared/private.png'
    const file = await app.vault.create(from, 'alternate file')
    await state.put({
      ...target,
      path: from,
      wirePath: from,
      fileId: 'sample-shadow',
      versionId: 'shadow-v1',
    })
    await app.fileManager.renameFile(file, to)
    destination = to
    if (notify) app.emit('vault', 'rename', file, from)
    await runtime.flush()
    await state.put({
      ...target,
      path: to,
      wirePath: to,
      fileId: 'sample-shadow',
      versionId: 'shadow-v2',
    })
    await state.delete(from)
    expect(await app.vault.read(app.vault.getAbstractFileByPath(sponsor.path)!)).toBe(link)
    expect(await state.byFileId(target.fileId)).toEqual(target)
  }
  return {
    app,
    state,
    meta,
    target,
    changed,
    pull,
    local,
    shadow,
    runtime: () => runtime,
    ports: () => ports,
    reopen: async () => {
      runtime.close()
      runtime = new NativeOwnerPublication(options)
      ports = installPorts()
      await runtime.start(false)
    },
    close: () => runtime.close(),
  }
}
it.each([false, 'settlement'] as const)(
  'does not lose an own link when indexing arrives at %s instead of before upload',
  async (indexed) => {
    const f = await fixture()
    try {
      await f.local(link, undefined, indexed)
      await f.reopen()
      await f.changed(link)
      await f.runtime().refreshPublication()
      expect(await f.runtime().confirmation.questions()).toHaveLength(1)
      expect(f.ports().add).not.toHaveBeenCalled()
    } finally {
      f.close()
    }
  }
)
it('recovers an exact delayed received base across restart before comparing an own new link', async () => {
  const f = await fixture(false, true)
  try {
    await f.pull()
    expect(await (f.runtime() as any).snapshots.get('sample-note')).toMatchObject({
      kind: 'unknown',
    })
    await f.reopen()
    await f.changed('shared baseline\n')
    expect(await (f.runtime() as any).snapshots.get('sample-note')).toMatchObject({
      kind: 'complete',
      origin: 'pull',
      versionId: 'note-v1',
      facts: [],
    })
    await f.local(link)
    await f.runtime().refreshPublication()
    expect(await f.runtime().confirmation.questions()).toHaveLength(1)
    expect(f.ports().add).not.toHaveBeenCalled()
  } finally {
    f.close()
  }
})
it('initial private links in a proven novel local note ask from the empty base', async () => {
  const f = await fixture(false, true)
  try {
    await f.local(link, 'novel')
    await f.runtime().refreshPublication()
    expect(await f.runtime().confirmation.questions()).toHaveLength(1)
    expect(f.ports().add).not.toHaveBeenCalled()
  } finally {
    f.close()
  }
})
it('retains a proven novel create until its first exact callback supplies initial links', async () => {
  const f = await fixture(false, true)
  try {
    await f.local(link, 'novel', false)
    await f.reopen()
    await f.changed(link)
    await f.runtime().refreshPublication()
    expect(await f.runtime().confirmation.questions()).toHaveLength(1)
    expect(f.ports().add).not.toHaveBeenCalled()
  } finally {
    f.close()
  }
})
it.each(['adopted', 'collision', 'received'] as const)(
  'does not give %s creates an empty owner base',
  async (creation) => {
    const f = await fixture(false, true)
    try {
      if (creation === 'received') await f.runtime().beforeRemote(['Shared/board.md'])
      await f.local(link, creation === 'received' ? 'novel' : creation)
      await f.runtime().refreshPublication()
      expect(await f.runtime().confirmation.questions()).toEqual([])
      expect(f.ports().add).not.toHaveBeenCalled()
    } finally {
      f.close()
    }
  }
)
it('a delayed base callback cannot overwrite a newer settled version', async () => {
  const f = await fixture(false, true)
  try {
    await f.pull()
    await f.local('ordinary new version without a link')
    await f.changed('shared baseline\n')
    expect(await (f.runtime() as any).snapshots.get('sample-note')).toMatchObject({
      kind: 'complete',
      versionId: 'note-v2',
    })
  } finally {
    f.close()
  }
})
it.each(['refresh', 'review'] as const)(
  'drops an early validated question before %s display if a later HTTP check spans a rename',
  async (mode) => {
    const f = await fixture()
    try {
      await f.local(link)
      await f.runtime().refreshPublication()
      const coordinator = f.runtime().confirmation
      const [first] = await coordinator.questions()
      const second = (await existingPublicationQuestion({
        ...first.observation,
        audience: { ...first.observation.audience, grantId: 'sample-second-grant' },
      }))!
      await (coordinator as any).store.rememberExisting({ ...second, state: 'pending' })
      let enter!: () => void, release!: () => void
      const started = new Promise<void>((resolve) => {
          enter = resolve
        }),
        delayed = new Promise<void>((resolve) => {
          release = resolve
        })
      f.ports().visibility.mockImplementation(async (grantId: string) => {
        if (grantId === 'sample-second-grant') {
          enter()
          await delayed
        }
        return {
          grantId,
          label: 'Sample audience',
          targetFileId: f.target.fileId,
          visible: false,
          targetVersionId: null,
          scopeRevision: 1,
          revision: 0,
          withdrawalGeneration: 0,
        }
      })
      const prompt = new PublicationPrompt(() => true),
        detach = prompt.attach(coordinator)
      const showing = mode === 'refresh' ? prompt.refresh() : prompt.open(first)
      await started
      await f.shadow()
      release()
      await showing
      expect(prompt.asking.value).toBeNull()
      expect(prompt.pending.value).toEqual([])
      expect(f.ports().add).not.toHaveBeenCalled()
      detach()
    } finally {
      f.close()
    }
  }
)
it('re-resolves before proposing a question when a sibling rename shadows the short link', async () => {
  const f = await fixture()
  try {
    await f.local(link)
    await f.shadow()
    await f.runtime().refreshPublication()
    expect(await f.runtime().confirmation.questions()).toEqual([])
    expect(f.ports().add).not.toHaveBeenCalled()
    expect((f.runtime() as any).observations.get('Shared/board.md').facts[0].targetId).toBe(
      'sample-shadow'
    )
  } finally {
    f.close()
  }
})
it('re-resolves pending questions and rejects the stale open answer even without a new cache callback', async () => {
  const f = await fixture()
  try {
    await f.local(link)
    await f.runtime().refreshPublication()
    const [q] = await f.runtime().confirmation.questions()
    await f.shadow(false) // The index changes, but no note/rename callback reaches this runtime.
    expect(await f.runtime().confirmation.questions()).toEqual([])
    expect(await f.runtime().confirmation.answer(q, true)).toBe(false)
    expect(f.ports().add).not.toHaveBeenCalled()
  } finally {
    f.close()
  }
})
it('re-resolves again between durable approval and the first send', async () => {
  const f = await fixture()
  try {
    await f.local(link)
    await f.runtime().refreshPublication()
    const [q] = await f.runtime().confirmation.questions()
    const store = (f.runtime().confirmation as any).store,
      remember = store.rememberExisting.bind(store)
    vi.spyOn(store, 'rememberExisting').mockImplementation(async (decision: any) => {
      await remember(decision)
      if (decision.state === 'approved' && !decision.completed) await f.shadow(false)
    })
    expect(await f.runtime().confirmation.answer(q, true)).toBe(true)
    expect(f.ports().add).not.toHaveBeenCalled()
  } finally {
    f.close()
  }
})
it('checks resolution at the transport boundary even if it changes after the final observation', async () => {
  const f = await fixture()
  try {
    await f.local(link)
    await f.runtime().refreshPublication()
    const [q] = await f.runtime().confirmation.questions()
    const coordinator = f.runtime().confirmation as any,
      current = coordinator.current.bind(coordinator)
    let calls = 0
    vi.spyOn(coordinator, 'current').mockImplementation(async (question: any) => {
      const observation = await current(question)
      if (++calls === 2) await f.shadow(false)
      return observation
    })
    await expect(coordinator.answer(q, true)).rejects.toThrow('reference changed')
    expect(f.ports().add).not.toHaveBeenCalled()
  } finally {
    f.close()
  }
})
it('never retries an unsent approval after the unchanged short link resolves to a different file', async () => {
  const f = await fixture()
  try {
    await f.local(link)
    await f.runtime().refreshPublication()
    const [q] = await f.runtime().confirmation.questions()
    f.ports().add.mockRejectedValueOnce(new Error('Transport failed before sending'))
    await expect(f.runtime().confirmation.answer(q, true)).rejects.toThrow('before sending')
    await f.shadow()
    await f.runtime().refreshPublication()
    expect(f.ports().add).toHaveBeenCalledTimes(1) // Only the original unsent attempt.
    const saved = await (f.runtime().confirmation as any).store.getExisting(q.exposureKey)
    expect(saved).toMatchObject({ state: 'approved', completed: true })
  } finally {
    f.close()
  }
})
it('keeps an unsent approval through restart without cache evidence, then sends its exact request after indexing', async () => {
  const f = await fixture()
  try {
    await f.local(link)
    await f.runtime().refreshPublication()
    const [q] = await f.runtime().confirmation.questions()
    f.ports().add.mockRejectedValueOnce(new Error('Transport failed before sending'))
    await expect(f.runtime().confirmation.answer(q, true)).rejects.toThrow('before sending')
    const stored = await (f.runtime().confirmation as any).store.getExisting(q.exposureKey)
    await f.reopen() // No in-memory observations survive; source/target bytes and versions do.
    await f.runtime().refreshPublication()
    const waiting = await (f.runtime().confirmation as any).store.getExisting(q.exposureKey)
    expect(waiting.state).toBe('approved')
    expect(waiting.completed).not.toBe(true)
    expect(waiting.request).toEqual(stored.request)
    expect(f.ports().add).not.toHaveBeenCalled()
    await f.changed(link)
    await f.runtime().refreshPublication()
    expect(f.ports().add).toHaveBeenCalledExactlyOnceWith(stored.request)
    expect(await (f.runtime().confirmation as any).store.getExisting(q.exposureKey)).toMatchObject({
      completed: true,
    })
  } finally {
    f.close()
  }
})
it('keeps approval pending when evidence disappears between persistence and the first send', async () => {
  const f = await fixture()
  try {
    await f.local(link)
    await f.runtime().refreshPublication()
    const [q] = await f.runtime().confirmation.questions()
    const store = (f.runtime().confirmation as any).store,
      remember = store.rememberExisting.bind(store)
    vi.spyOn(store, 'rememberExisting').mockImplementation(async (decision: any) => {
      await remember(decision)
      if (decision.state === 'approved' && !decision.completed)
        (f.runtime() as any).observations.clear()
    })
    expect(await f.runtime().confirmation.answer(q, true)).toBe(true)
    const waiting = await store.getExisting(q.exposureKey)
    expect(waiting.completed).not.toBe(true)
    expect(waiting.state).toBe('approved')
    expect(f.ports().add).not.toHaveBeenCalled()
    await f.changed(link)
    await f.runtime().refreshPublication()
    expect(f.ports().add).toHaveBeenCalledExactlyOnceWith(waiting.request)
  } finally {
    f.close()
  }
})
it('a pulled private link with late indexing never prompts after an unrelated body edit', async () => {
  const f = await fixture(true)
  try {
    await f.pull()
    expect(await (f.runtime() as any).snapshots.get('sample-note')).toMatchObject({
      kind: 'unknown',
    })
    await f.changed(link) // The real received callback arrives only AFTER the pull hook.
    await f.local(link + '\nordinary text only\n')
    await f.runtime().refreshPublication()
    expect(await f.runtime().confirmation.questions()).toEqual([])
    expect(f.ports().add).not.toHaveBeenCalled()
    expect(await (f.runtime() as any).snapshots.get('sample-note')).toMatchObject({
      kind: 'complete',
      versionId: 'note-v2',
    })
  } finally {
    f.close()
  }
})
