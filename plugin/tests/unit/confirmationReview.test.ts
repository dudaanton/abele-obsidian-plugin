// @vitest-environment node
import { it, expect, vi } from 'vitest'
import { MemoryStateStore, sha256 } from '@abele/sync-core'
import { NativeOwnerPublication } from '@/sync/publication/nativeOwnerPublication'
import { buildFakeVault } from '../helpers/fakeVault'
const link = '[[private.png]]'
async function fixture(receivedLink = false) {
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
    const visibility = vi
      .spyOn(assets, 'visibility')
      .mockResolvedValue({
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
  if (!receivedLink) {
    await changed(source)
    await pull()
  }
  const local = async (text: string) => {
    await app.vault.modify(app.vault.getAbstractFileByPath(sponsor.path)!, text)
    await changed(text)
    const sha = await sha256(new TextEncoder().encode(text))
    const op = {
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
    sponsor = { ...sponsor, sha, size: text.length, versionId: 'note-v2' }
    await state.put(sponsor)
    await runtime.hooks.onSettled!(
      {
        op,
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
  const shadow = async () => {
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
    app.emit('vault', 'rename', file, from)
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
