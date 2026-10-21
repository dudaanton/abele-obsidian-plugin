import { expect, it, vi } from 'vitest'
import {
  EngineError,
  GENERATION_KEY,
  MemoryFileSystem,
  MemoryStateStore,
  sha256,
} from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { TokenEngineRuntime, type TokenEngineOptions } from '@/sync/tokenEngineRuntime'
import type { TransferSnapshot } from '@/sync/transferProgress'
import { PathCoordinator, coordinatedFileSystem } from '@/sync/pathCoordinator'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { ignoreFor } from '@/sync/scope'
import { TokenAttachmentHost } from '@/sync/tokenAttachmentHost'
import { useVault } from '../helpers/testEnv'
import { NativeSyncFailure } from '@/sync/mobileTransport'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import type { App } from 'obsidian'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { mount, flushPromises } from '@vue/test-utils'
import TokenDialogs from '@/components/sync/TokenDialogs.vue'
import Button from '@/components/obsidian/Button.vue'
import { TokenUi } from '@/sync/tokenUi'
import { tokenUiFixture } from '@/testing/tokenUiFixture'

it.each(['network', 'staging', 'trusted'])(
  'installs an approved candidate during a blocked first pull without completing the pull (%s)',
  async (blockedAt) => {
    const fixture = tokenUiFixture(),
      source = fixture.candidates.value[0].source
    const wire = await server('Scripts/sample.js', '// approved bytes', source.address)
    const send = wire.fetch.getMockImplementation()!
    let downloading = false
    let release!: () => void
    wire.fetch.mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname === '/v2/manifest' && url.searchParams.has('next')) {
        downloading = true
        await new Promise<void>((resolve, reject) => {
          release = resolve
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true }
          )
        })
        return Response.json({ items: [], cursor: 1, next: null })
      }
      const response = await send(input, init)
      if (url.pathname === '/v2/connection')
        return Response.json({ ...(await response.json()), token_id: source.tokenId })
      if (url.pathname === '/v2/manifest')
        return Response.json({ items: [wire.item], cursor: 1, next: 'next-page' })
      return response
    })
    const fs = new MemoryFileSystem(),
      one = runtime(wire, fs, undefined, undefined, null, { id: source.id })
    const ui = new TokenUi(
      fixture.registry,
      { get: () => null, set: () => {}, remove: () => {} },
      wire.fetch,
      one.reviews
    )
    ui.bind(source.id, one.runtime)
    let staged = false,
      finishStaging!: () => void
    const staging = new Promise<void>((resolve) => {
      finishStaging = resolve
    })
    const stage = one.reviews.executables.stage.bind(one.reviews.executables)
    if (blockedAt === 'staging')
      vi.spyOn(one.reviews.executables, 'stage').mockImplementation(async (input) => {
        const result = await stage(input)
        staged = true
        await staging
        return result
      })
    let install!: () => void
    const installing = new Promise<void>((resolve) => {
      install = resolve
    })
    const apply = one.runtime.apply.bind(one.runtime)
    const installCall = vi.spyOn(one.runtime, 'apply').mockImplementation(async (candidate) => {
      await installing
      await apply(candidate)
    })
    let view: ReturnType<typeof mount> | undefined
    const pull = one.runtime.sync().catch(() => {})
    try {
      await vi.waitFor(() => expect(blockedAt === 'staging' ? staged : downloading).toBe(true))
      const [candidate] = await one.reviews.executables.pending()
      view = mount(TokenDialogs, {
        props: { ui, mode: 'review', candidate },
        global: {
          stubs: {
            Modal: { template: '<main><slot /><footer><slot name="footer" /></footer></main>' },
          },
        },
      })
      if (blockedAt === 'trusted') {
        ui.setTrusted(source.id, true)
        void ui.refreshReviews()
        await vi.waitFor(() => expect(installCall).toHaveBeenCalledTimes(1))
      }
      await view
        .findAllComponents(Button)
        .find((button) => button.props('text') === 'Approve')!
        .trigger('click')
      await flushPromises()
      expect((await one.reviews.executables.state())[0].status).toBe('queued')
      expect(view.get('[role=status]').text()).toContain('Approved —')
      expect(await one.state.getCursor()).toBe(0)
      install()
      // Let the installation request stop the engine before its staged page finishes.
      await flushPromises()
      finishStaging()
      await vi.waitFor(async () => expect(await fs.stat(candidate.path)).not.toBeNull())
      expect(new TextDecoder().decode(await fs.read(candidate.path))).toBe('// approved bytes')
      expect(await one.state.getCursor()).toBe(0)
      await vi.waitFor(() =>
        expect(view!.get('[role=status]').text()).toBe('Approved and installed.')
      )
      expect(installCall).toHaveBeenCalledTimes(1)
    } finally {
      install()
      finishStaging()
      view?.unmount()
      release?.()
      await pull
      await one.runtime.close()
    }
  }
)

it.each(['manifest page', 'note download'])(
  'a caller waiting on sync gets the real result of the run restarted after an approved installation (%s)',
  async (blockedAt) => {
    const fixture = tokenUiFixture(),
      source = fixture.candidates.value[0].source
    const wire = await server('Scripts/sample.js', '// approved bytes', source.address)
    const noteBytes = new TextEncoder().encode('sample note')
    const note = {
      ...wire.item,
      file_id: 'note-file',
      version_id: 'note-version',
      path: 'Notes/sample.md',
      sha: await sha256(noteBytes),
      size: noteBytes.length,
      kind: 'note',
    }
    const send = wire.fetch.getMockImplementation()!
    let blocked = 0
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    wire.fetch.mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      if (blockedAt === 'manifest page' && url.pathname === '/v2/manifest') {
        if (url.searchParams.has('next')) {
          // The first read blocks until the installation cancels it; the restarted run reads freely.
          if (blocked++ === 0)
            await new Promise<void>((_, reject) =>
              init?.signal?.addEventListener(
                'abort',
                () => reject(new DOMException('Cancelled', 'AbortError')),
                { once: true }
              )
            )
          return Response.json({ items: [note], cursor: 1, next: null })
        }
        return Response.json({ items: [wire.item], cursor: 1, next: 'next-page' })
      }
      if (url.pathname === '/v2/manifest')
        return Response.json({ items: [wire.item, note], cursor: 1, next: null })
      if (url.pathname === '/v2/files/note-file/content') {
        // A transport that does not honour cancellation: only the engine's stop ends the wait.
        if (blocked++ === 0) await held
        return new Response(noteBytes)
      }
      const response = await send(input, init)
      if (url.pathname === '/v2/connection')
        return Response.json({ ...(await response.json()), token_id: source.tokenId })
      return response
    })
    const failed = vi.fn(),
      events: string[] = []
    const fs = new MemoryFileSystem(),
      one = runtime(wire, fs, undefined, undefined, null, {
        id: source.id,
        failed,
        event: (text) => events.push(text),
      })
    let outcome: unknown = 'pending'
    const pull = one.runtime.sync().then(
      () => (outcome = 'synced'),
      (error: unknown) => (outcome = error)
    )
    try {
      await vi.waitFor(() => expect(blocked).toBe(1))
      const [candidate] = await one.reviews.executables.pending()
      await one.reviews.executables.approve([candidate.id], {
        apply: (approved) => one.runtime.apply(approved),
      })
      expect(new TextDecoder().decode(await fs.read(candidate.path))).toBe('// approved bytes')
      await pull
      expect(outcome).toBe('synced')
      expect(new TextDecoder().decode(await fs.read(note.path))).toBe('sample note')
      expect(await one.state.getCursor()).toBe(1)
      expect(failed).not.toHaveBeenCalled()
      expect(events.filter((text) => text.startsWith('Error:'))).toEqual([])
    } finally {
      release()
      await pull
      await one.runtime.close()
    }
  }
)

it('rejects a changed manifest generation before placement and reviews, then handshakes again', async () => {
  const wire = await server('Notes/sample.md', 'remote bytes')
  const original = wire.fetch.getMockImplementation()!
  let generation = 'first'
  let changeManifest = true
  wire.fetch.mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname
    const response = await original(input, init)
    if (path === '/v2/manifest' && changeManifest) generation = 'second'
    response.headers.set('abele-restore-generation', generation)
    return response
  })
  const state = new MemoryStateStore(),
    metadata = new MemoryStateStore(),
    fs = new MemoryFileSystem()
  const placement = vi.fn(async () => {})
  const recover = vi.fn(async () => {
    expect(await state.getMeta(GENERATION_KEY)).toBe(generation)
  })
  const one = new TokenEngineRuntime({
    id: 'restore-sample',
    encoded: token(wire.address),
    state,
    fs,
    reviews: {
      executables: new ExecutableReview(metadata),
      attachments: new AttachmentConsent(metadata),
      close: () => {},
    },
    fetch: wire.fetch,
    preparePlacement: placement,
    recoverPlacement: recover,
    changed: () => {},
    failed: () => {},
    covers: async () => false,
  })
  try {
    await expect(one.sync()).rejects.toMatchObject({ code: 'conflict' })
    expect(placement).not.toHaveBeenCalled()
    expect(await fs.stat('Notes/sample.md')).toBeNull()
    expect(await state.getMeta(GENERATION_KEY)).toBe('first')
    changeManifest = false
    await one.sync()
    expect(await state.getMeta(GENERATION_KEY)).toBe('second')
    expect(await state.getMeta('retired-generation:first')).not.toBeNull()
    expect(new TextDecoder().decode(await fs.read('Notes/sample.md'))).toBe('remote bytes')
  } finally {
    await one.disconnect()
  }
})

it.each([
  { size: 10, readsPerCycle: 16 },
  { size: 2 * 1024 * 1024, readsPerCycle: 8 },
  { size: 20 * 1024 * 1024, readsPerCycle: 1 },
])(
  'bounds rolling reads in a 12000-file vault and resumes the durable sweep (size=$size)',
  async ({ size, readsPerCycle }) => {
    const wire = await server('unused.md', 'unused')
    const original = wire.fetch.getMockImplementation()!
    wire.fetch.mockImplementation(async (input, init) => {
      const response = await original(input, init)
      if (new URL(String(input)).pathname !== '/v2/connection') return response
      const body = await response.json()
      body.limits.max_file_bytes = 64 * 1024 * 1024
      return Response.json(body)
    })
    const app = buildFakeVault(
      Array.from({ length: 12000 }, (_, i) => ({
        path: `file-${String(i).padStart(5, '0')}.bin`,
        content: 'same bytes',
      }))
    )
    // Virtual files share one payload instead of allocating a multi-gigabyte fixture.
    const payload = new Uint8Array(size).fill(90)
    for (const file of app.vault.getFiles()) file.stat.size = size
    const originalStat = app.vault.adapter.stat.bind(app.vault.adapter)
    vi.spyOn(app.vault.adapter, 'stat').mockImplementation(async (path) => {
      const stat = await originalStat(path)
      return stat?.type === 'file' && path.startsWith('file-') ? { ...stat, size } : stat
    })
    const originalRead = app.vault.adapter.readBinary.bind(app.vault.adapter)
    vi.spyOn(app.vault.adapter, 'readBinary').mockImplementation((path) =>
      path.startsWith('file-') ? Promise.resolve(payload.slice().buffer) : originalRead(path)
    )
    const fs = new ObsidianFileSystem(app as unknown as App)
    const state = new MemoryStateStore()
    // Keep large synthetic row setup independent of fake-indexeddb's index insertion cost.
    // Exercise sweep-cursor persistence through the production durable adapter.
    const factory = new IDBFactory()
    let durableMetadata = await IndexedDbStateStore.open(factory, 'rolling-metadata')
    const getMeta = state.getMeta.bind(state),
      setMeta = state.setMeta.bind(state)
    state.getMeta = (key) =>
      key === 'content-sweep-after' ? durableMetadata.getMeta(key) : getMeta(key)
    state.setMeta = (key, value) =>
      key === 'content-sweep-after' ? durableMetadata.setMeta(key, value) : setMeta(key, value)
    const sha = await sha256(payload)
    await state.transaction(async () => {
      for (const file of app.vault.getFiles())
        await state.put({
          path: file.path,
          wirePath: file.path,
          fileId: file.path,
          versionId: 'version',
          sha,
          size: file.stat.size,
          mtime: file.stat.mtime,
        })
      await state.setCursor(1)
    })
    const metadata = new MemoryStateStore()
    const make = () =>
      new TokenEngineRuntime({
        id: 'rolling-sample',
        encoded: token(wire.address),
        fs,
        state,
        reviews: {
          executables: new ExecutableReview(metadata),
          attachments: new AttachmentConsent(metadata),
          close: () => {},
        },
        fetch: wire.fetch,
        changed: () => {},
        failed: () => {},
        covers: async () => false,
      })
    let one = make()
    const reads = vi.spyOn(app.vault.adapter, 'readBinary')
    const listings = vi.spyOn(app.vault.adapter, 'list')
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        reads.mockClear()
        const previous = await state.getMeta('content-sweep-after')
        await one.sync()
        expect(reads.mock.calls.length).toBe(readsPerCycle)
        expect(
          reads.mock.calls.reduce(
            (bytes, [path]) =>
              bytes + (app.vault.getAbstractFileByPath(path) as import('obsidian').TFile).stat.size,
            0
          )
        ).toBeLessThanOrEqual(Math.max(16 * 1024 * 1024, size))
        expect(await state.getMeta('content-sweep-after')).not.toBe(previous)
        if (cycle === 0) {
          const cursor = await state.getMeta('content-sweep-after')
          await one.disconnect()
          durableMetadata.close()
          durableMetadata = await IndexedDbStateStore.open(factory, 'rolling-metadata')
          expect(await state.getMeta('content-sweep-after')).toBe(cursor)
          one = make()
        }
      }
      expect(listings.mock.calls.every(([path]) => path === '.obsidian')).toBe(true)
    } finally {
      await one.disconnect()
      durableMetadata.close()
    }
  }
)

it('keeps attachments offline while a reconnect is in flight and restores availability after success', async () => {
  const wire = await server('Notes/sample.md', 'note')
  const send = wire.fetch.getMockImplementation()!
  const one = runtime(wire, new MemoryFileSystem())
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  let started!: () => void
  const retryStarted = new Promise<void>((resolve) => {
    started = resolve
  })
  let retry: Promise<void> | undefined
  try {
    expect(one.runtime.available).toBe(true)
    wire.fetch.mockRejectedValueOnce(new EngineError('offline', 'Sample network unavailable'))
    await expect(one.runtime.sync()).rejects.toMatchObject({ code: 'offline' })
    expect(one.runtime.available).toBe(false)
    wire.fetch.mockImplementationOnce(async (...args) => {
      started()
      await blocked
      return send(...args)
    })
    retry = one.runtime.sync()
    await retryStarted
    expect(one.runtime.engine.status.state).toBe('syncing')
    expect(one.runtime.available).toBe(false)
    release()
    await retry
    expect(one.runtime.available).toBe(true)
  } finally {
    release()
    await retry?.catch(() => {})
    await one.runtime.disconnect()
  }
})

it('reviews canonical executable content through its known physical identity', async () => {
  const wire = await server('Café/Café.js', '// remote', undefined, { ...scope, path: 'Café' })
  const physical = 'Café/Cafe\u0301.js',
    fs = new MemoryFileSystem(),
    state = new MemoryStateStore()
  const old = new TextEncoder().encode('// old'),
    privateBytes = new TextEncoder().encode('// unrelated sibling')
  await fs.writeAtomic(physical, old, 1000)
  await fs.writeAtomic(wire.item.path, privateBytes, 1000)
  await state.put({
    path: physical,
    wirePath: wire.item.path,
    fileId: wire.item.file_id,
    versionId: 'old-version',
    sha: await sha256(old),
    size: old.length,
    mtime: 1000,
  })
  const one = runtime(wire, fs, state)
  try {
    await one.runtime.sync()
    const [candidate] = await one.reviews.executables.pending()
    expect(candidate.previousPath).toBeNull()
    await one.runtime.apply(candidate)
    expect(await fs.read(physical)).toEqual(wire.bytes)
    expect(await fs.read(wire.item.path)).toEqual(privateBytes)
  } finally {
    await one.runtime.close()
  }
})

it('pulls a canonical wire path through its retained local identity without touching its Unicode sibling', async () => {
  const wire = await server('Café/Café.md', 'remote bytes', undefined, { ...scope, path: 'Café' })
  const physical = 'Café/Cafe\u0301.md',
    fs = new MemoryFileSystem(),
    state = new MemoryStateStore()
  const old = new TextEncoder().encode('old bytes'),
    privateBytes = new TextEncoder().encode('unrelated sibling')
  await fs.writeAtomic(physical, old, 1000)
  await fs.writeAtomic(wire.item.path, privateBytes, 1000)
  await state.put({
    path: physical,
    wirePath: wire.item.path,
    fileId: wire.item.file_id,
    versionId: 'old-version',
    sha: await sha256(old),
    size: old.length,
    mtime: 1000,
  })
  const one = runtime(wire, fs, state)
  try {
    await one.runtime.sync()
    expect(await fs.read(physical)).toEqual(wire.bytes)
    expect(await fs.read(wire.item.path)).toEqual(privateBytes)
    expect(await state.byFileId(wire.item.file_id)).toMatchObject({
      path: physical,
      wirePath: wire.item.path,
    })
  } finally {
    await one.runtime.close()
  }
})

it('does not authorize a Unicode sibling through a retained group asset path', async () => {
  const group = { kind: 'group' as const, id: 'sample-group', path: 'Groups/sample.md' }
  const wire = await server('Groups/sample.md', 'sample', undefined, group as typeof scope)
  const one = runtime(wire, new MemoryFileSystem())
  try {
    const paths = Reflect.get(one.runtime, 'assetPaths') as Map<string, string>
    paths.set('Café.bin', 'sample-asset')
    expect(one.runtime.client.includes('Café.bin')).toBe(true)
    expect(one.runtime.client.includes('Cafe\u0301.bin')).toBe(false)
  } finally {
    await one.runtime.close()
  }
})

it.each(
  [
    'Cafe\u0301/secret.js',
    'CAFÉ/secret.js',
    'Café2/secret.js',
    'Café/../Private/secret.js',
    '',
    'Café//secret.js',
    'Café/secret.js/',
  ].flatMap((path) => [false, true].map((caseInsensitive) => ({ path, caseInsensitive })))
)(
  'rejects raw review and filesystem path $path (case insensitive $caseInsensitive)',
  async ({ path, caseInsensitive }) => {
    const wire = await server('Café/sample.js', '// sample', undefined, { ...scope, path: 'Café' })
    const fs = new MemoryFileSystem({ caseInsensitive }),
      one = runtime(wire, fs)
    try {
      await one.runtime.sync()
      const [candidate] = await one.reviews.executables.pending()
      const read = vi.spyOn(fs, 'read'),
        stat = vi.spyOn(fs, 'stat')
      await expect(one.runtime.apply({ ...candidate, path })).rejects.toMatchObject({
        code: 'protocol',
      })
      await expect(Reflect.get(one.runtime, 'options').fs.read(path)).rejects.toMatchObject({
        code: 'protocol',
      })
      expect(read).not.toHaveBeenCalled()
      expect(stat).not.toHaveBeenCalled()
    } finally {
      await one.runtime.close()
    }
  }
)

it('never reads or uploads private siblings during folder discovery', async () => {
  const wire = await server('Shared/sample.md', 'sample', undefined, { ...scope, path: 'Shared' })
  const fs = new MemoryFileSystem()
  await fs.writeAtomic('Shared/local.md', new TextEncoder().encode('local bytes'), 1000)
  await fs.writeAtomic('Private/secret.md', new TextEncoder().encode('private bytes'), 1000)
  const read = vi.spyOn(fs, 'read'),
    stat = vi.spyOn(fs, 'stat')
  const one = runtime(wire, fs)
  try {
    await one.runtime.sync()
    expect(read.mock.calls.some(([path]) => path.startsWith('Private/'))).toBe(false)
    expect(stat.mock.calls.some(([path]) => path.startsWith('Private/'))).toBe(false)
    const commits = wire.fetch.mock.calls.filter(
      ([url]) => new URL(String(url)).pathname === '/v2/commit'
    )
    expect(commits.length).toBeGreaterThan(0)
    const operations = commits.flatMap(([, init]) => JSON.parse(String(init?.body)).ops)
    expect(operations.some((op: { path?: string }) => op.path === 'Shared/local.md')).toBe(true)
    expect(JSON.stringify(operations)).not.toContain('Private')
    expect(one.runtime.acceptsLocal('Private/secret.md', 10)).toBe(false)
  } finally {
    await one.runtime.disconnect()
  }
})

it.each(
  [undefined, 'Shared'].flatMap((localRoot) =>
    [false, true].map((connected) => ({ localRoot, connected }))
  )
)(
  'stops a server scope rename with pinned root $localRoot (connected $connected)',
  async ({ localRoot, connected }) => {
    const shared = { ...scope, path: 'Shared' }
    const wire = await server('Shared/sample.md', 'sample', undefined, shared)
    const fs = new MemoryFileSystem()
    await fs.writeAtomic('Shared/sample.md', wire.bytes, 1000)
    await fs.writeAtomic('Private/secret.md', new TextEncoder().encode('private bytes'), 1000)
    const one = runtime(wire, fs, undefined, undefined, null, {
      localRoot,
      encoded: encodeAccessToken({
        v: 1,
        address: wire.address,
        key: 'a'.repeat(43),
        scope: shared,
      }),
    })
    if (connected) await one.runtime.sync()
    shared.path = 'Private'
    wire.item.path = 'Private/sample.md'
    const read = vi.spyOn(fs, 'read'),
      stat = vi.spyOn(fs, 'stat')
    try {
      await expect(one.runtime.sync()).rejects.toThrow(/renamed on the server: Shared → Private/)
      expect(one.runtime.folderScope()).toBe('Shared')
      expect(read.mock.calls.some(([path]) => path.startsWith('Private/'))).toBe(false)
      expect(stat.mock.calls.some(([path]) => path.startsWith('Private/'))).toBe(false)
      const commits = wire.fetch.mock.calls.filter(
        ([url]) => new URL(String(url)).pathname === '/v2/commit'
      )
      expect(commits.map(([, init]) => String(init?.body)).join('')).not.toContain('secret.md')
    } finally {
      await one.runtime.close()
    }
  }
)

it.each(
  [
    'manifest-note',
    'manifest-script',
    'manifest-directory',
    'content-note',
    'content-script',
    'content-directory',
    'delete',
    'removal',
    'move-from',
    'move-to',
    'event-path',
  ].flatMap((mode) => [undefined, 'Shared'].map((localRoot) => ({ mode, localRoot })))
)(
  'rejects an out-of-scope $mode page before local access (placement $localRoot)',
  async ({ mode, localRoot }) => {
    const wire = await server('Shared/sample.md', 'sample', undefined, { ...scope, path: 'Shared' })
    const fs = new MemoryFileSystem()
    await fs.writeAtomic('Private/secret.md', new TextEncoder().encode('private bytes'), 1000)
    const preparePlacement = vi.fn(async () => {})
    const one = runtime(wire, fs, undefined, undefined, null, {
      localRoot,
      preparePlacement,
      encoded: encodeAccessToken({
        v: 1,
        address: wire.address,
        key: 'a'.repeat(43),
        scope: { ...scope, path: 'Shared' },
      }),
    })
    const original = wire.fetch.getMockImplementation()!
    try {
      if (!mode.startsWith('manifest')) await one.runtime.sync()
      const path =
        mode === 'move-from' || mode === 'event-path' ? 'Shared/other.md' : 'Private/secret.md'
      const item = mode.endsWith('directory')
        ? { file_id: 'bad-file', version_id: 'bad-version', path, kind: 'directory', mtime: 1000 }
        : {
            ...wire.item,
            file_id: 'bad-file',
            version_id: 'bad-version',
            path,
            kind: mode.endsWith('script') ? 'script' : 'note',
          }
      wire.fetch.mockImplementation(async (url, init) => {
        const route = new URL(String(url)).pathname
        if (mode.startsWith('manifest') && route === '/v2/manifest')
          return Response.json({ items: [wire.item, item], cursor: 2, next: null })
        if (!mode.startsWith('manifest') && route === '/v2/changes') {
          const event = {
            cursor: 2,
            file_id: 'bad-file',
            path: mode === 'event-path' ? 'Private/secret.md' : path,
            at: new Date(1000).toISOString(),
          }
          return Response.json({
            items: [
              mode === 'delete'
                ? { ...event, type: 'delete', version_id: 'bad-version' }
                : mode === 'removal'
                  ? { ...event, type: 'removal' }
                  : {
                      ...event,
                      type: 'content',
                      item,
                      prev_path:
                        mode === 'move-from'
                          ? 'Private/secret.md'
                          : mode === 'move-to'
                            ? 'Shared/other.md'
                            : null,
                    },
            ],
            cursor: 2,
            next: null,
          })
        }
        return original(url, init)
      })
      preparePlacement.mockClear()
      const before = fs.snapshot(),
        read = vi.spyOn(fs, 'read'),
        stat = vi.spyOn(fs, 'stat')
      await expect(one.runtime.sync()).rejects.toMatchObject({ code: 'protocol' })
      expect(preparePlacement).not.toHaveBeenCalled()
      expect(read.mock.calls.some(([path]) => path.startsWith('Private/'))).toBe(false)
      expect(stat.mock.calls.some(([path]) => path.startsWith('Private/'))).toBe(false)
      expect(fs.snapshot()).toEqual(before)
      expect(await one.reviews.executables.pending()).toEqual([])
    } finally {
      await one.runtime.close()
    }
  }
)

it.each([undefined, 'Shared'])(
  'never follows a server scope rename into a private local folder (saved root %s)',
  async (localRoot) => {
    const shared = { ...scope, path: 'Shared' }
    const wire = await server('Shared/sample.md', 'sample', undefined, shared)
    const fs = new MemoryFileSystem()
    await fs.writeAtomic('Shared/sample.md', wire.bytes, 1000)
    await fs.writeAtomic('Private/secret.md', new TextEncoder().encode('private bytes'), 1000)
    const one = runtime(wire, fs, undefined, undefined, null, { localRoot })
    shared.path = 'Private'
    wire.item.path = 'Private/sample.md'
    const read = vi.spyOn(fs, 'read'),
      stat = vi.spyOn(fs, 'stat')
    try {
      await expect(one.runtime.sync()).rejects.toThrow(/Shared.*Private/)
      expect(read.mock.calls.some(([path]) => path.startsWith('Private/'))).toBe(false)
      expect(stat.mock.calls.some(([path]) => path.startsWith('Private/'))).toBe(false)
      const commits = wire.fetch.mock.calls.filter(
        ([url]) => new URL(String(url)).pathname === '/v2/commit'
      )
      expect(commits.map(([, init]) => String(init?.body)).join('')).not.toContain('secret.md')
    } finally {
      await one.runtime.close()
    }
  }
)

it.each(
  [
    'manifest-note',
    'manifest-script',
    'manifest-directory',
    'content-note',
    'content-script',
    'content-directory',
    'delete',
    'removal',
    'move-from',
    'move-to',
    'event-path',
  ].flatMap((mode) => [undefined, 'Moved'].map((localRoot) => ({ mode, localRoot })))
)(
  'rejects an out-of-scope $mode page before local access (placement $localRoot)',
  async ({ mode, localRoot }) => {
    const wire = await server('Shared/sample.md', 'sample', undefined, { ...scope, path: 'Shared' })
    const fs = new MemoryFileSystem()
    await fs.writeAtomic('Private/secret.md', new TextEncoder().encode('private bytes'), 1000)
    const preparePlacement = vi.fn(async () => {})
    const one = runtime(wire, fs, undefined, undefined, null, { localRoot, preparePlacement })
    const original = wire.fetch.getMockImplementation()!
    try {
      if (!mode.startsWith('manifest')) await one.runtime.sync()
      const path =
        mode === 'move-from' || mode === 'event-path' ? 'Shared/other.md' : 'Private/secret.md'
      const item = mode.endsWith('directory')
        ? { file_id: 'bad-file', version_id: 'bad-version', path, kind: 'directory', mtime: 1000 }
        : {
            ...wire.item,
            file_id: 'bad-file',
            version_id: 'bad-version',
            path,
            kind: mode.endsWith('script') ? 'script' : 'note',
          }
      wire.fetch.mockImplementation(async (url, init) => {
        const route = new URL(String(url)).pathname
        if (mode.startsWith('manifest') && route === '/v2/manifest')
          return Response.json({ items: [wire.item, item], cursor: 2, next: null })
        if (!mode.startsWith('manifest') && route === '/v2/changes') {
          const event = {
            cursor: 2,
            file_id: 'bad-file',
            path: mode === 'event-path' ? 'Private/secret.md' : path,
            at: new Date(1000).toISOString(),
          }
          return Response.json({
            items: [
              mode === 'delete'
                ? { ...event, type: 'delete', version_id: 'bad-version' }
                : mode === 'removal'
                  ? { ...event, type: 'removal' }
                  : {
                      ...event,
                      type: 'content',
                      item,
                      prev_path:
                        mode === 'move-from'
                          ? 'Private/secret.md'
                          : mode === 'move-to'
                            ? 'Shared/other.md'
                            : null,
                    },
            ],
            cursor: 2,
            next: null,
          })
        }
        return original(url, init)
      })
      preparePlacement.mockClear()
      const before = fs.snapshot(),
        read = vi.spyOn(fs, 'read'),
        stat = vi.spyOn(fs, 'stat')
      await expect(one.runtime.sync()).rejects.toMatchObject({ code: 'protocol' })
      expect(preparePlacement).not.toHaveBeenCalled()
      expect(read.mock.calls.some(([path]) => path.startsWith('Private/'))).toBe(false)
      expect(stat.mock.calls.some(([path]) => path.startsWith('Private/'))).toBe(false)
      expect(fs.snapshot()).toEqual(before)
      expect(await one.reviews.executables.pending()).toEqual([])
    } finally {
      await one.runtime.close()
    }
  }
)

it('blocks root-loss deletes before any request, coalescing a thousand events', async () => {
  const wire = await server('Shared/sample.md', 'sample')
  const one = runtime(wire, new MemoryFileSystem())
  try {
    await one.runtime.sync()
    wire.fetch.mockClear()
    const started = performance.now()
    for (let i = 0; i < 1000; i++) one.runtime.scopeRootGone({ kind: 'deleted' })
    await expect(one.runtime.sync()).rejects.toMatchObject({ code: 'scope_unavailable' })
    expect(wire.fetch).not.toHaveBeenCalled()
    expect(performance.now() - started).toBeLessThan(250)
  } finally {
    await one.runtime.close()
  }
})

it('detects a missing established root on disk before scanning or contacting the server', async () => {
  const wire = await server('Shared/sample.md', 'sample', undefined, { ...scope, path: 'Shared' })
  const fs = new MemoryFileSystem(),
    state = new MemoryStateStore()
  await state.setCursor(1)
  const rootExists = vi.fn(async () => false),
    rootChanged = vi.fn(),
    list = vi.spyOn(fs, 'list')
  const one = runtime(wire, fs, state, undefined, null, { rootExists, rootChanged })
  try {
    await expect(one.runtime.sync()).rejects.toMatchObject({ code: 'scope_unavailable' })
    expect(rootExists).toHaveBeenCalledOnce()
    expect(rootChanged).toHaveBeenCalledExactlyOnceWith({ kind: 'deleted' })
    expect(list).not.toHaveBeenCalled()
    expect(wire.fetch).not.toHaveBeenCalled()
  } finally {
    await one.runtime.close()
  }
})

it('restores a missing folder from a fresh server snapshot without sending deletes', async () => {
  const wire = await server('Shared/sample.md', 'sample', undefined, { ...scope, path: 'Shared' })
  const fs = new MemoryFileSystem()
  let one = runtime(wire, fs)
  try {
    await one.runtime.sync()
    await fs.remove(wire.item.path)
    await one.state.setMeta(
      'held-deletes',
      JSON.stringify([{ path: wire.item.path, fileId: wire.item.file_id }])
    )
    await one.runtime.close()
    one = runtime(wire, fs, one.state)
    one.runtime.scopeRootGone({ kind: 'deleted' })
    wire.requests.length = 0
    await one.runtime.restoreRoot()
    expect(new TextDecoder().decode(await fs.read(wire.item.path))).toBe('sample')
    expect(wire.requests).not.toContain('/v2/commit')
    expect(await one.runtime.engine.heldDeletes()).toEqual([])
  } finally {
    await one.runtime.close()
  }
})

it('keeps an unresolved server journal when restore is requested', async () => {
  const wire = await server('Shared/sample.md', 'sample'),
    one = runtime(wire, new MemoryFileSystem())
  try {
    await one.runtime.sync()
    const pending = {
      batchId: 'pending',
      idempotencyKey: 'pending',
      startedAt: new Date().toISOString(),
      ops: [],
    }
    await one.state.setJournal(pending)
    one.runtime.scopeRootGone({ kind: 'deleted' })
    await expect(one.runtime.restoreRoot()).rejects.toThrow('unresolved')
    expect(await one.state.getJournal()).toEqual(pending)
    await expect(one.runtime.sync()).rejects.toMatchObject({ code: 'scope_unavailable' })
  } finally {
    await one.runtime.close()
  }
})

it('follows a moved folder locally without changing the server namespace', async () => {
  const wire = await server('Shared/sample.md', 'sample', undefined, { ...scope, path: 'Shared' })
  const fs = new MemoryFileSystem(),
    localRootChanged = vi.fn()
  const one = runtime(wire, fs, undefined, undefined, null, { localRootChanged })
  try {
    await one.runtime.sync()
    await fs.move('Shared/sample.md', 'Moved/sample.md')
    one.runtime.scopeRootGone({ kind: 'moved', path: 'Moved' })
    wire.requests.length = 0
    await one.runtime.followRoot()
    await one.runtime.sync()
    expect(wire.requests).not.toContain('/v2/commit')
    expect(wire.item.path).toBe('Shared/sample.md')
    expect(localRootChanged).toHaveBeenCalledWith('Moved')
    expect(new TextDecoder().decode(await fs.read('Moved/sample.md'))).toBe('sample')
    expect(await fs.stat('Shared/sample.md')).toBeNull()
    expect((await one.state.get('Shared/sample.md'))?.wirePath).toBe('Shared/sample.md')
  } finally {
    await one.runtime.close()
  }
})

it('keeps an unresolved legacy server move when local follow is requested', async () => {
  const wire = await server('Shared/sample.md', 'sample', undefined, { ...scope, path: 'Shared' })
  const fs = new MemoryFileSystem(),
    one = runtime(wire, fs)
  try {
    await one.runtime.sync()
    await fs.move('Shared/sample.md', 'Moved/sample.md')
    one.runtime.scopeRootGone({ kind: 'moved', path: 'Moved' })
    const pending = JSON.stringify({ key: 'saved-request', op: { op: 'move_directory' } })
    await one.state.setMeta('plugin:scope-root-follow', pending)
    wire.requests.length = 0
    await expect(one.runtime.followRoot()).rejects.toThrow('unresolved')
    expect(await one.state.getMeta('plugin:scope-root-follow')).toBe(pending)
    await expect(one.runtime.restoreRoot()).rejects.toThrow('unresolved')
    expect(wire.requests).toEqual([])
    expect(new TextDecoder().decode(await fs.read('Moved/sample.md'))).toBe('sample')
  } finally {
    await one.runtime.close()
  }
})

it('pulls into a persisted local placement while keeping canonical ledger paths', async () => {
  const wire = await server('Shared/fresh.md', 'fresh', undefined, { ...scope, path: 'Shared' })
  const fs = new MemoryFileSystem(),
    one = runtime(wire, fs, undefined, undefined, null, { localRoot: 'Moved' })
  try {
    await one.runtime.sync()
    expect(new TextDecoder().decode(await fs.read('Moved/fresh.md'))).toBe('fresh')
    expect(await fs.stat('Shared/fresh.md')).toBeNull()
    expect((await one.state.get('Shared/fresh.md'))?.wirePath).toBe('Shared/fresh.md')
    expect(one.runtime.covers('Moved/fresh.md')).toBe(true)
    expect(one.runtime.covers('Shared/fresh.md')).toBe(false)
    expect(await one.runtime.pathFor(wire.item.file_id)).toBe('Moved/fresh.md')
  } finally {
    await one.runtime.close()
  }
})

it('refuses a reused moved destination without known synced file identities', async () => {
  const wire = await server('Shared/sample.md', 'sample', undefined, { ...scope, path: 'Shared' })
  const fs = new MemoryFileSystem(),
    changed = vi.fn(),
    one = runtime(wire, fs, undefined, undefined, null, { localRootChanged: changed })
  try {
    await one.runtime.sync()
    await fs.move('Shared/sample.md', 'Final/sample.md')
    await fs.writeAtomic('Moved/private.md', new TextEncoder().encode('private'), 1000)
    one.runtime.scopeRootGone({ kind: 'moved', path: 'Moved' })
    wire.requests.length = 0
    await expect(one.runtime.followRoot()).rejects.toThrow(/aren.t part|missing/i)
    expect(changed).not.toHaveBeenCalled()
    expect(wire.requests).toEqual([])
    await expect(one.runtime.sync()).rejects.toMatchObject({ code: 'scope_unavailable' })
  } finally {
    await one.runtime.close()
  }
})

it.each(
  ['extra-file', 'extra-folder', 'missing-file', 'missing-folder', 'edited-known-file'].flatMap(
    (kind) => [true, false].map((restart) => ({ kind, restart }))
  )
)('checks the exact known set for $kind with restart=$restart', async ({ kind, restart }) => {
  const wire = await server('Shared/sample.md', 'sample', undefined, { ...scope, path: 'Shared' })
  const fs = new MemoryFileSystem()
  let one = runtime(wire, fs)
  try {
    await one.runtime.sync()
    await fs.move('Shared/sample.md', 'Moved/sample.md')
    if (kind === 'extra-file')
      await fs.writeAtomic('Moved/private.md', new TextEncoder().encode('private'), 1000)
    if (kind === 'extra-folder')
      Object.assign(fs, {
        listDirectories: async function* () {
          yield { path: 'Moved/unknown', identity: 'unknown', mtime: 1000 }
        },
      })
    if (kind === 'missing-file') await fs.remove('Moved/sample.md')
    if (kind === 'missing-folder') {
      await one.state.setMeta(
        'v2-directories',
        JSON.stringify({ directories: [{ path: 'Shared/empty' }], removals: [] })
      )
      Object.assign(fs, {
        listDirectories: async function* () {
          yield { path: 'Moved', identity: 'root', mtime: 1000 }
        },
      })
    }
    if (kind === 'edited-known-file')
      await fs.writeAtomic('Moved/sample.md', new TextEncoder().encode('ordinary edit'), 2000)
    if (restart) {
      await one.runtime.close()
      one = runtime(wire, fs, one.state, undefined, null, {
        rootIssue: { kind: 'moved', path: 'Moved' },
      })
    } else one.runtime.scopeRootGone({ kind: 'moved', path: 'Moved' })
    wire.requests.length = 0
    if (kind === 'edited-known-file') {
      await one.runtime.followRoot()
      expect(await fs.stat('Moved/sample.md')).not.toBeNull()
    } else {
      await expect(one.runtime.followRoot()).rejects.toThrow(/aren.t part|missing/i)
      expect(wire.requests).toEqual([])
      await expect(one.runtime.sync()).rejects.toMatchObject({ code: 'scope_unavailable' })
    }
  } finally {
    await one.runtime.close()
  }
})

it('uses local paths for history, trash and held work while sending canonical keep-local paths', async () => {
  const wire = await server('Shared/sample.md', 'sample', undefined, { ...scope, path: 'Shared' })
  const fs = new MemoryFileSystem(),
    one = runtime(wire, fs, undefined, undefined, null, { localRoot: 'Moved' })
  try {
    await one.runtime.sync()
    expect(await one.runtime.entryFor('Moved/sample.md')).toMatchObject({
      path: 'Moved/sample.md',
      wirePath: 'Shared/sample.md',
    })
    vi.spyOn(one.runtime.client, 'trash').mockResolvedValue([
      { path: 'Shared/deleted.md', file_id: 'deleted' },
    ] as never)
    vi.spyOn(one.runtime.client, 'versions').mockResolvedValue([
      { path: 'Shared/sample.md', version_id: 'old' },
    ] as never)
    expect(await one.runtime.historyClient().trash()).toEqual([
      { path: 'Moved/deleted.md', file_id: 'deleted' },
    ])
    expect(await one.runtime.historyClient().versions('sample-file')).toEqual([
      { path: 'Moved/sample.md', version_id: 'old' },
    ])
    vi.spyOn(one.runtime.engine, 'heldDeletes').mockResolvedValue([
      { path: 'Shared/deleted.md', fileId: 'deleted' },
    ] as never)
    vi.spyOn(one.runtime.engine, 'deferred').mockResolvedValue([
      { path: 'Shared/code.js', prev_path: 'Shared/old.js' },
    ] as never)
    expect(await one.runtime.heldDeletes()).toEqual([
      { path: 'Moved/deleted.md', fileId: 'deleted' },
    ])
    expect(await one.runtime.deferred()).toEqual([
      { path: 'Moved/code.js', prev_path: 'Moved/old.js' },
    ])
    const keep = vi.spyOn(one.runtime.engine, 'keepLocal').mockResolvedValue(undefined as never)
    await one.runtime.keepLocal(['Moved/code.js'], ['version'])
    expect(keep).toHaveBeenCalledWith(['Shared/code.js'], ['version'])
  } finally {
    await one.runtime.close()
  }
})

it('reports local conflict and refused publication paths without changing wire metadata', async () => {
  const wire = await server('Shared/sample.md', 'sample', undefined, { ...scope, path: 'Shared' }),
    changed = vi.fn()
  const one = runtime(wire, new MemoryFileSystem(), undefined, undefined, null, {
    localRoot: 'Moved',
    changed,
  })
  try {
    const report = {
      push: {
        committed: { results: [{ status: 'conflict', conflict_path: 'Shared/conflict.md' }] },
        rejected: [{ op: { path: 'Shared/refused.md' }, code: 'quota_exceeded' }],
      },
      pull: { applied: 0 },
    }
    Reflect.get(one.runtime.engine, 'opts').onSync(report)
    expect(changed.mock.lastCall?.[1]).toMatchObject({
      push: {
        committed: { results: [{ conflict_path: 'Moved/conflict.md' }] },
        rejected: [{ op: { path: 'Moved/refused.md' } }],
      },
    })
    expect(report.push.rejected[0].op.path).toBe('Shared/refused.md')
  } finally {
    await one.runtime.close()
  }
})

it('preserves a forbidden error and stopped state when saving local placement fails', async () => {
  const wire = await server('Shared/sample.md', 'sample', undefined, { ...scope, path: 'Shared' })
  const fs = new MemoryFileSystem(),
    one = runtime(wire, fs, undefined, undefined, null, {
      localRootChanged: () => {
        throw new EngineError('forbidden', 'placement refused')
      },
    })
  try {
    await one.runtime.sync()
    await fs.move('Shared/sample.md', 'Moved/sample.md')
    one.runtime.scopeRootGone({ kind: 'moved', path: 'Moved' })
    const baseline = await one.state.get('Shared/sample.md')
    wire.requests.length = 0
    await expect(one.runtime.followRoot()).rejects.toMatchObject({ code: 'forbidden' })
    expect(await one.state.get('Shared/sample.md')).toEqual(baseline)
    expect(wire.requests).toEqual([])
    await expect(one.runtime.sync()).rejects.toMatchObject({ code: 'scope_unavailable' })
  } finally {
    await one.runtime.close()
  }
})

it('rejects an entire remote root-deletion page before deleting any local child', async () => {
  const wire = await server('Shared/sample.md', 'sample', undefined, { ...scope, path: 'Shared' })
  const fs = new MemoryFileSystem(),
    one = runtime(wire, fs)
  try {
    await one.runtime.sync()
    const original = wire.fetch.getMockImplementation()!
    wire.fetch.mockImplementation(async (input, init) => {
      if (new URL(String(input)).pathname === '/v2/changes')
        return Response.json({
          cursor: 3,
          next: null,
          items: [
            {
              type: 'delete',
              cursor: 2,
              file_id: wire.item.file_id,
              version_id: 'deleted-child',
              path: wire.item.path,
              at: new Date().toISOString(),
            },
            {
              type: 'delete',
              cursor: 3,
              file_id: 'root',
              version_id: 'deleted-root',
              path: 'Shared',
              at: new Date().toISOString(),
            },
          ],
        })
      return original(input, init)
    })
    await expect(one.runtime.sync()).rejects.toMatchObject({ code: 'scope_unavailable' })
    expect(new TextDecoder().decode(await fs.read(wire.item.path))).toBe('sample')
    expect(await one.state.getCursor()).toBe(1)
  } finally {
    await one.runtime.close()
  }
})

it.each(['scope_unavailable', 'forbidden'] as const)(
  'keeps local files when the server reports %s',
  async (code) => {
    const wire = await server('Shared/sample.md', 'sample', undefined, { ...scope, path: 'Shared' })
    const fs = new MemoryFileSystem(),
      one = runtime(wire, fs)
    try {
      await one.runtime.sync()
      wire.requests.length = 0
      wire.fetch.mockImplementation(async (input) => {
        wire.requests.push(new URL(String(input)).pathname)
        return Response.json(
          { error: { code, message: 'Scope is unavailable', details: {} } },
          { status: 403 }
        )
      })
      await expect(one.runtime.sync()).rejects.toMatchObject({ code })
      expect(new TextDecoder().decode(await fs.read(wire.item.path))).toBe('sample')
      expect(wire.requests).toEqual(['/v2/connection'])
      expect(await one.state.getCursor()).toBe(1)
    } finally {
      await one.runtime.close()
    }
  }
)

it('accepts permission metadata from the deletion server through the retained engine', async () => {
  const wire = await server('Notes/sample.md', 'sample')
  const send = wire.fetch.getMockImplementation()!
  wire.fetch.mockImplementation(async (input, init) => {
    const response = await send(input, init)
    if (String(input).endsWith('/v2/connection'))
      return Response.json({ ...(await response.json()), read_only: false })
    return response
  })
  const one = runtime(wire, new MemoryFileSystem())
  try {
    await one.runtime.sync()
  } finally {
    await one.runtime.disconnect()
  }
})

it('stops on scope_deleted without applying local deletes or uploading retained files', async () => {
  const wire = await server('Notes/sample.md', 'sample')
  wire.fetch.mockImplementation(async () =>
    Response.json({ error: { code: 'scope_deleted', message: 'Scope deleted' } }, { status: 401 })
  )
  const fs = new MemoryFileSystem()
  await fs.writeAtomic('Notes/local.md', new TextEncoder().encode('local'), 1000)
  const one = runtime(wire, fs)
  try {
    await expect(one.runtime.sync()).rejects.toBeDefined()
    expect(new TextDecoder().decode(await fs.read('Notes/local.md'))).toBe('local')
    expect(one.runtime.acceptsLocal('Notes/local.md', 5)).toBe(false)
    expect(wire.fetch.mock.calls.every(([input]) => String(input).endsWith('/v2/connection'))).toBe(
      true
    )
  } finally {
    await one.runtime.disconnect()
  }
})

it('names unsent local files after an offline attempt so the phone can show file and reason', async () => {
  const wire = await server('Notes/sample.md', 'note'),
    fs = new MemoryFileSystem()
  const one = runtime(wire, fs)
  try {
    await fs.writeAtomic('Notes/unsent.bin', new Uint8Array([1, 2]), 1000)
    wire.fetch.mockRejectedValueOnce(new EngineError('offline', 'Network unavailable'))
    await expect(one.runtime.sync()).rejects.toMatchObject({ code: 'offline' })
    expect(await one.runtime.pendingLocalDetails()).toEqual({
      count: 1,
      paths: ['Notes/unsent.bin'],
    })
  } finally {
    await one.runtime.disconnect()
  }
})

it('keeps native pre-send failure details and error status through the classified core transport', async () => {
  const metadata = new MemoryStateStore()
  const changed = vi.fn()
  const failed = vi.fn()
  const one = new TokenEngineRuntime({
    id: 'native-failure',
    encoded: token('https://sync.example'),
    fs: new MemoryFileSystem(),
    state: new MemoryStateStore(),
    reviews: {
      executables: new ExecutableReview(metadata),
      attachments: new AttachmentConsent(metadata),
      close: () => {},
    },
    fetch: async () => {
      throw new NativeSyncFailure('encoding', new Error('unsupported bytes'))
    },
    changed,
    failed,
    covers: async () => false,
  })
  try {
    await expect(one.sync()).rejects.toMatchObject({ code: 'io' })
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ code: 'io', phase: 'encoding' }))
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({
      state: 'error',
      lastError: expect.stringContaining("Couldn't send changes"),
    })
    expect(one.trace.snapshot().log).toContain(
      "Couldn't send changes. Native encoding (unknown): unsupported bytes"
    )
  } finally {
    await one.disconnect()
  }
})

it.each(['offline', 'sending', 'encoding', 'response'])(
  'recovers from one %s failure on the same 2s backoff without user action',
  async (phase) => {
    vi.useFakeTimers()
    const wire = await server('Notes/sample.md', 'note')
    wire.fetch.mockImplementationOnce(async () => {
      throw phase === 'offline'
        ? new EngineError('offline', 'network interrupted')
        : new NativeSyncFailure(phase, new Error('transient bridge failure'))
    })
    const one = runtime(wire, new MemoryFileSystem())
    try {
      await one.runtime.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(wire.fetch).toHaveBeenCalledTimes(1)
      expect(one.runtime.engine.status).toMatchObject({
        state: 'offline',
        lastError: expect.stringContaining(
          phase === 'offline'
            ? 'network interrupted'
            : phase === 'encoding'
              ? "Couldn't send changes"
              : 'Sync interrupted'
        ),
      })
      await vi.advanceTimersByTimeAsync(1999)
      expect(wire.fetch).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(wire.fetch.mock.calls.length).toBeGreaterThan(1)
      // Retry is triggered at exactly 2s; native digest promises settle outside fake timers.
      await vi.waitFor(() =>
        expect(one.runtime.engine.status).toMatchObject({ state: 'idle', lastError: null })
      )
      expect(one.runtime.trace.snapshot().log).toContain('sync: retry')
    } finally {
      await one.runtime.disconnect()
      vi.useRealTimers()
    }
  }
)

const scope = { kind: 'folder' as const, id: 'root', path: '/' }
it('aborts a blocked upload on close instead of waiting for its native timeout or retry', async () => {
  const wire = await server('Notes/sample.md', 'note')
  const send = wire.fetch.getMockImplementation()!
  let started!: () => void
  const uploading = new Promise<void>((resolve) => {
    started = resolve
  })
  wire.fetch.mockImplementation(async (input, init) => {
    if (String(input).includes('/v2/uploads/')) {
      started()
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Stopped', 'AbortError')),
          { once: true }
        )
      })
    }
    return send(input, init)
  })
  const fs = new MemoryFileSystem()
  const one = runtime(wire, fs)
  await one.runtime.start()
  await one.runtime.sync()
  await fs.writeAtomic('Notes/sample.md', new TextEncoder().encode('local edit'), 2000)
  const sync = one.runtime.sync().catch(() => {})
  await uploading
  await one.runtime.close()
  await sync
  expect(one.runtime.engine.status.state).not.toBe('syncing')
})
it('does not backoff-retry a deterministic unsupported request body', async () => {
  vi.useFakeTimers()
  const wire = await server('Notes/sample.md', 'note')
  wire.fetch.mockImplementation(async () => {
    throw new NativeSyncFailure('encoding', new Error('Unsupported native sync request body'))
  })
  const one = runtime(wire, new MemoryFileSystem())
  try {
    await one.runtime.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(one.runtime.engine.status).toMatchObject({
      state: 'error',
      lastError: expect.stringContaining("Couldn't send changes"),
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(wire.fetch).toHaveBeenCalledTimes(1)
    expect(one.runtime.trace.snapshot().log).not.toContain('sync: retry')
  } finally {
    await one.runtime.disconnect()
    vi.useRealTimers()
  }
})
const token = (address: string) => encodeAccessToken({ v: 1, address, key: 'a'.repeat(43), scope })
it('does not schedule watch exchanges for ignored activity between fallback polls', async () => {
  const wire = await server('Notes/sample.md', 'note')
  const fs = new MemoryFileSystem()
  let notify!: (paths: string[]) => void
  fs.watch = (callback) => {
    notify = callback
    return () => {}
  }
  const one = runtime(wire, fs, undefined, undefined, 'Private/**')
  try {
    await one.runtime.start()
    await one.runtime.sync()
    const count = wire.requests.length
    vi.useFakeTimers()
    notify(['Private/ignored.md'])
    await vi.advanceTimersByTimeAsync(2000)
    expect(wire.requests).toHaveLength(count)
    expect(one.runtime.trace.snapshot().firstSync).toMatchObject({ complete: true })
    expect(one.runtime.trace.snapshot().firstSync.stages.map((one) => one.stage)).toEqual(
      expect.arrayContaining(['scan', 'transfer'])
    )
    expect(one.runtime.trace.snapshot().log).not.toContain('sync: watch')
    expect(one.runtime.trace.snapshot().scans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'fs list',
          completed: expect.any(Number),
          durationMs: expect.any(Number),
        }),
      ])
    )
  } finally {
    vi.useRealTimers()
    await one.runtime.disconnect()
  }
})
it('a shadowed short link cannot send a newly resolved private file using persisted approval', async () => {
  const group = { kind: 'group' as const, id: 'group', path: 'Groups/sample.md' }
  const app = useVault([
    { path: group.path, content: '![[sample.png]]' },
    { path: 'Private/sample.png', content: 'approved bytes' },
    { path: 'Groups/sample.png', content: 'new private bytes' },
  ])
  let resolved = app.vault.getFileByPath('Private/sample.png')!
  vi.spyOn(app.metadataCache, 'getFirstLinkpathDest').mockImplementation(() => resolved)
  const local = new TokenAttachmentHost(app as never),
    metadata = new MemoryStateStore()
  const source = {
    id: 'connection',
    address: 'https://first.example',
    spaceId: 'sample-space',
    tokenId: 'sample-token',
    scope: group,
  }
  const consent = new AttachmentConsent(metadata),
    note = (await local.note(group.path))!
  await consent.observeNote(
    source,
    note.id,
    note.targets.map((one) => one.id)
  )
  const [question] = await consent.noteOpened(source, note.id, {
    resolve: async (id) => local.resolve(id),
  })
  expect(
    await consent.decide(question.id, true, { resolve: async (id) => local.resolve(id) })
  ).toBe(true)
  resolved = app.vault.getFileByPath('Groups/sample.png')!
  const changed = (await new TokenAttachmentHost(app as never).note(group.path))!
  const next = changed.targets[0]
  expect(next.id).not.toBe(question.fileId)
  const fs = new MemoryFileSystem(),
    wire = await server(group.path, '![[sample.png]]', source.address, group as typeof scope)
  await fs.writeAtomic(next.path, new TextEncoder().encode('new private bytes'), 100)
  const restarted = new AttachmentConsent(metadata)
  const engine = new TokenEngineRuntime({
    id: source.id,
    encoded: encodeAccessToken({
      v: 1,
      address: source.address,
      key: 'a'.repeat(43),
      scope: group,
    }),
    fs,
    state: new MemoryStateStore(),
    reviews: {
      executables: new ExecutableReview(metadata),
      attachments: restarted,
      close: () => {},
    },
    localFiles: { resolve: async (id) => local.resolve(id), note: async () => changed },
    fetch: wire.fetch,
    changed: () => {},
    failed: () => {},
    covers: async () => false,
    scopeInput: async () => ({ key: 'group', ignore: ignoreFor('.obsidian', null) }),
  })
  try {
    await engine.sync()
    wire.requests.length = 0
    await expect(engine.publishAttachment(next.id)).rejects.toThrow('not approved')
    expect(wire.requests).toEqual([])
    await restarted.observeNote(
      source,
      changed.id,
      changed.targets.map((one) => one.id)
    )
    const questions = await restarted.noteOpened(source, changed.id, {
      resolve: async (id) => local.resolve(id),
    })
    expect(questions).toHaveLength(1)
    expect(questions[0].fileId).toBe(next.id)
  } finally {
    await engine.disconnect()
  }
})
async function server(
  path: string,
  text: string,
  address = 'https://first.example',
  sharedScope = scope
) {
  const bytes = new TextEncoder().encode(text),
    sha = await sha256(bytes)
  const item = {
    file_id: 'sample-file',
    version_id: 'sample-version',
    path,
    sha,
    size: bytes.length,
    mtime: 1000,
    kind: path.endsWith('.js') ? 'script' : 'note',
  }
  const requests: string[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const route = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    ).pathname
    requests.push(route)
    if (route === '/v2/connection')
      return Response.json({
        protocol: 2,
        token_id: 'sample-token',
        space_id: 'sample-space',
        scope: sharedScope,
        status: 'active',
        limits: { max_file_bytes: 1000000, quota_bytes: null },
      })
    if (route === '/v2/manifest') return Response.json({ items: [item], cursor: 1, next: null })
    if (route === '/v2/changes') return Response.json({ items: [], cursor: 1, next: null })
    if (route.includes('/content')) return new Response(bytes)
    if (route.startsWith('/v2/uploads/')) return new Response(null, { status: 204 })
    if (route === '/v2/commit') {
      const ops = JSON.parse(String(init?.body)).ops
      return Response.json({
        cursor: 1,
        results: ops.map(() => ({
          status: 'rejected',
          code: 'quota_exceeded',
          message: 'sample quota',
        })),
      })
    }
    throw new Error('Unexpected route: ' + route)
  })
  return { fetch, requests, item, bytes, address, sharedScope, scope: sharedScope }
}
function runtime(
  wire: Awaited<ReturnType<typeof server>>,
  fs: MemoryFileSystem,
  state = new MemoryStateStore(),
  locks = new PathCoordinator(),
  ignoreText: string | null = null,
  progressOptions: Partial<TokenEngineOptions> = {}
) {
  const metadata = new MemoryStateStore()
  const reviews = {
    executables: new ExecutableReview(metadata),
    attachments: new AttachmentConsent(metadata),
    close: () => {},
  }
  return {
    runtime: new TokenEngineRuntime({
      id: wire.address,
      encoded: encodeAccessToken({
        v: 1,
        address: wire.address,
        key: 'a'.repeat(43),
        scope: wire.sharedScope,
      }),
      fs: coordinatedFileSystem(fs, locks),
      state,
      reviews,
      fetch: wire.fetch,
      changed: () => {},
      failed: () => {},
      covers: async () => false,
      scopeInput: async () => ({ key: 'sample-scope', ignore: ignoreFor('.obsidian', ignoreText) }),
      ...progressOptions,
    }),
    state,
    reviews,
  }
}
it('publishes growing inventory, settled files and received bytes across a paginated first pull', async () => {
  const wire = await server('Notes/first.md', 'first')
  const secondBytes = new TextEncoder().encode('second')
  const second = {
    ...wire.item,
    file_id: 'second-file',
    version_id: 'second-version',
    path: 'Notes/second.md',
    sha: await sha256(secondBytes),
    size: secondBytes.length,
  }
  const send = wire.fetch.getMockImplementation()!
  wire.fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/v2/manifest')
      return Response.json({
        items: [url.searchParams.has('next') ? second : wire.item],
        cursor: 2,
        next: url.searchParams.has('next') ? null : 'second-page',
      })
    if (url.pathname === '/v2/changes') return Response.json({ items: [], cursor: 2, next: null })
    if (url.pathname === '/v2/files/second-file/content') return new Response(secondBytes)
    return send(input, init)
  })
  const updates: (TransferSnapshot | undefined)[] = []
  const events: string[] = []
  const fs = new MemoryFileSystem()
  const one = runtime(wire, fs, new MemoryStateStore(), new PathCoordinator(), null, {
    progress: (value) => updates.push(value),
    event: (text) => events.push(text),
  })
  try {
    await one.runtime.sync()
    expect(updates).toContainEqual(
      expect.objectContaining({ stage: 'Downloading', total: 1, completed: 0, totalKnown: false })
    )
    expect(updates).toContainEqual(
      expect.objectContaining({
        stage: 'Downloading',
        total: 2,
        completed: 1,
        bytes: 5,
        totalBytes: 11,
        totalKnown: true,
      })
    )
    expect(updates).toContainEqual(
      expect.objectContaining({ stage: 'Downloading', total: 2, completed: 2, bytes: 11 })
    )
    expect(events).toContain('Downloaded Notes/second.md')
    expect(updates.at(-1)).toBeUndefined()
    expect(new TextDecoder().decode(await fs.read(second.path))).toBe('second')
  } finally {
    await one.runtime.close()
  }
})
it('reports a later changes-feed download with fresh byte and file counts', async () => {
  const wire = await server('Notes/sample.md', 'first')
  const send = wire.fetch.getMockImplementation()!
  const bytes = new TextEncoder().encode('second')
  const item = {
    ...wire.item,
    version_id: 'updated-version',
    sha: await sha256(bytes),
    size: bytes.length,
    mtime: 2000,
  }
  let updated = false
  wire.fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (updated && url.pathname === '/v2/changes')
      return Response.json({
        items:
          Number(url.searchParams.get('since')) < 2
            ? [
                {
                  type: 'content',
                  item,
                  file_id: item.file_id,
                  path: item.path,
                  cursor: 2,
                  prev_path: null,
                  at: '2025-01-01T00:00:00Z',
                },
              ]
            : [],
        cursor: 2,
        next: null,
      })
    if (updated && url.pathname.endsWith('/content')) return new Response(bytes)
    return send(input, init)
  })
  const updates: TransferSnapshot[] = []
  const one = runtime(
    wire,
    new MemoryFileSystem(),
    new MemoryStateStore(),
    new PathCoordinator(),
    null,
    {
      progress: (value) => {
        if (value) updates.push(value)
      },
    }
  )
  try {
    await one.runtime.sync()
    updates.length = 0
    updated = true
    await one.runtime.sync()
    expect(updates).toContainEqual(
      expect.objectContaining({
        stage: 'Downloading',
        completed: 0,
        total: 1,
        bytes: 0,
        totalBytes: 6,
      })
    )
    expect(updates).toContainEqual(
      expect.objectContaining({ stage: 'Downloading', completed: 1, total: 1, bytes: 6 })
    )
  } finally {
    await one.runtime.close()
  }
})

it('reports comparison phases and thirty-second updates while a local fingerprint is blocked', async () => {
  const wire = await server('Notes/unused.md', '')
  const send = wire.fetch.getMockImplementation()!
  wire.fetch.mockImplementation(async (input, init) =>
    new URL(String(input)).pathname === '/v2/manifest'
      ? Response.json({ items: [], cursor: 1, next: null })
      : send(input, init)
  )
  const fs = new MemoryFileSystem()
  await fs.writeAtomic('Notes/local.md', new TextEncoder().encode('local'), 2000)
  const read = fs.read.bind(fs)
  let release!: () => void,
    blocked = false
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  Object.assign(fs, {
    fingerprint: async (path: string) => {
      if (!blocked) {
        blocked = true
        await gate
      }
      const bytes = await read(path)
      return { size: bytes.length, sha: await sha256(bytes) }
    },
  })
  const events: string[] = []
  vi.useFakeTimers()
  const one = runtime(wire, fs, undefined, undefined, null, { event: (line) => events.push(line) })
  const sync = one.runtime.sync()
  try {
    await vi.waitFor(() => expect(blocked).toBe(true))
    expect(events).toContainEqual(expect.stringContaining('Comparing files: started'))
    await vi.advanceTimersByTimeAsync(31000)
    expect(events).toContainEqual(expect.stringMatching(/^Comparing files · 0 of 1 file$/))
    release()
    await sync
    expect(events).toContainEqual(expect.stringContaining('Comparing files: ended'))
  } finally {
    release()
    await sync.catch(() => {})
    await one.runtime.close()
    vi.useRealTimers()
  }
})

it('does not invent a local match when applying a new empty remote file', async () => {
  const wire = await server('Notes/empty.md', '')
  const fs = new ObsidianFileSystem(buildFakeVault([]) as unknown as App)
  const events: string[] = []
  expect(await fs.stat('Notes/empty.md')).toBeNull()
  const one = runtime(wire, fs as unknown as MemoryFileSystem, undefined, undefined, null, {
    event: (line) => events.push(line),
  })
  try {
    await one.runtime.sync()
    expect(await fs.stat('Notes/empty.md')).toMatchObject({ size: 0 })
    expect(events).not.toContain('Matched local file Notes/empty.md')
    expect(events).toContain('Applied remote file Notes/empty.md')
  } finally {
    await one.runtime.close()
  }
})

it('keeps automatic trigger reasons in diagnostics without adding them to recent activity', async () => {
  const wire = await server('Notes/sample.md', 'sample bytes')
  const events: string[] = []
  const one = runtime(wire, new MemoryFileSystem(), undefined, undefined, null, {
    event: (line) => events.push(line),
  })
  try {
    await one.runtime.start()
    await one.runtime.sync()
    expect(one.runtime.trace.snapshot().log).toContain('sync: start')
    expect(events).not.toContain('sync: start')
    expect(events).toContain('Downloaded Notes/sample.md')
  } finally {
    await one.runtime.close()
  }
})

it('logs confirmed downloads and aggregate phase boundaries through the runtime', async () => {
  const wire = await server('Notes/sample.md', 'sample bytes')
  const events: string[] = []
  const one = runtime(wire, new MemoryFileSystem(), undefined, undefined, null, {
    event: (line) => events.push(line),
  })
  try {
    await one.runtime.sync()
    expect(events.filter((line) => line === 'Downloaded Notes/sample.md')).toHaveLength(1)
    expect(events).toContainEqual(expect.stringContaining('Downloading: started'))
    expect(events).toContainEqual(expect.stringContaining('Downloading: ended'))
  } finally {
    await one.runtime.close()
  }
})

it('replaces an empty server download with comparison, then real upload counts', async () => {
  const wire = await server('Notes/remote.md', 'remote')
  const send = wire.fetch.getMockImplementation()!
  let transfer: TransferSnapshot | undefined
  const duringUpload: (TransferSnapshot | undefined)[] = []
  const duringCommit: (TransferSnapshot | undefined)[] = []
  const duringHandshake: (TransferSnapshot | undefined)[] = []
  wire.fetch.mockImplementation(async (input, init) => {
    const route = new URL(String(input)).pathname
    if (route === '/v2/manifest') return Response.json({ items: [], cursor: 1, next: null })
    if (route.startsWith('/v2/uploads/')) duringUpload.push(transfer)
    if (route === '/v2/commit') duringCommit.push(transfer)
    if (route === '/v2/connection') duringHandshake.push(transfer)
    return send(input, init)
  })
  const fs = new MemoryFileSystem()
  await fs.writeAtomic('Notes/local.md', new TextEncoder().encode('local'), 2000)
  const duringComparison: (TransferSnapshot | undefined)[] = []
  const one = runtime(wire, fs, new MemoryStateStore(), new PathCoordinator(), null, {
    progress: (value) => {
      transfer = value
    },
    comparing: (value) => {
      if (value) duringComparison.push(transfer)
    },
  })
  try {
    await one.runtime.sync()
    expect(duringComparison.length).toBeGreaterThan(0)
    expect(duringHandshake[0]?.stage).toBe('Checking the vault')
    expect(duringComparison).not.toContainEqual(expect.objectContaining({ stage: 'Downloading' }))
    expect(duringUpload.length).toBeGreaterThan(0)
    for (const value of duringUpload)
      expect(value).toMatchObject({ stage: 'Uploading', completed: 0, total: 1, totalBytes: 5 })
    expect(duringCommit).toContainEqual(
      expect.objectContaining({ stage: 'Committing changes', total: 1, bytes: 5 })
    )
  } finally {
    await one.runtime.close()
  }
})

it.each([true, false])(
  'counts upload bytes only after acknowledgement (acknowledged=%s)',
  async (acknowledged) => {
    const wire = await server('Notes/remote.md', 'remote')
    const send = wire.fetch.getMockImplementation()!
    wire.fetch.mockImplementation(async (input, init) => {
      if (!acknowledged && new URL(String(input)).pathname.startsWith('/v2/uploads/'))
        throw new EngineError('offline', 'sample interruption')
      return send(input, init)
    })
    const fs = new MemoryFileSystem()
    await fs.writeAtomic('Notes/local.md', new TextEncoder().encode('local'), 2000)
    const updates: TransferSnapshot[] = []
    const one = runtime(wire, fs, new MemoryStateStore(), new PathCoordinator(), null, {
      progress: (value) => {
        if (value?.stage === 'Uploading') updates.push(value)
      },
    })
    try {
      if (acknowledged) await one.runtime.sync()
      else await expect(one.runtime.sync()).rejects.toMatchObject({ code: 'offline' })
      expect(updates).toContainEqual(expect.objectContaining({ total: 1, totalBytes: 5, bytes: 0 }))
      expect(Math.max(...updates.map((one) => one.bytes ?? 0))).toBe(acknowledged ? 5 : 0)
    } finally {
      await one.runtime.close()
    }
  }
)

it('captures only included local edits, leaving ignored installed code outside every destination', async () => {
  const wire = await server('sample.md', 'incoming'),
    fs = new MemoryFileSystem()
  const one = runtime(
    wire,
    fs,
    new MemoryStateStore(),
    new PathCoordinator(),
    '.obsidian/\n!.obsidian/plugins/review/main.js'
  )
  await one.runtime.sync()
  expect(one.runtime.acceptsLocal('.obsidian/plugins/abele/main.js', 100)).toBe(false)
  expect(one.runtime.acceptsLocal('.obsidian/plugins/review/main.js', 100)).toBe(true)
  expect(one.runtime.acceptsLocal('sample.md', 100)).toBe(true)
})
it('retains a covering destination for local edits while an executable candidate waits for review', async () => {
  const wire = await server('sample.js', '// incoming code')
  const one = runtime(wire, new MemoryFileSystem())
  await one.runtime.sync()
  expect(await one.reviews.executables.pending()).toHaveLength(1)
  expect(one.runtime.acceptsLocal('sample.js', 100)).toBe(true)
})
it('never uploads or commits a local change outside a folder connection', async () => {
  const wire = await server('Shared/note.md', 'incoming', 'https://folder.example', {
    ...scope,
    path: 'Shared',
  })
  const fs = new MemoryFileSystem()
  await fs.writeAtomic('Private/note.md', new TextEncoder().encode('private original'), 1000)
  const one = runtime(wire, fs)
  try {
    await one.runtime.sync()
    wire.requests.length = 0
    await fs.writeAtomic('Private/note.md', new TextEncoder().encode('private edit'), 2000)
    await one.runtime.sync()
    expect(
      wire.requests.some((path) => path.startsWith('/v2/uploads/') || path === '/v2/commit')
    ).toBe(false)
    expect(await one.state.get('Private/note.md')).toBeNull()
  } finally {
    await one.runtime.disconnect()
  }
})

it('runs two production token engines through one coordinator with separate ledgers', async () => {
  const fs = new MemoryFileSystem(),
    locks = new PathCoordinator()
  const first = await server('First/first.md', 'first', 'https://first.example', {
      ...scope,
      path: 'First',
    }),
    second = await server('Second/second.md', 'second', 'https://second.example', {
      ...scope,
      path: 'Second',
    })
  // This fixture intentionally tests two independent pulls; ordinary forwarding is tested separately.
  const a = runtime(first, fs, undefined, locks),
    b = runtime(second, fs, undefined, locks)
  try {
    await Promise.all([a.runtime.sync(), b.runtime.sync()])
    expect(new TextDecoder().decode(await fs.read('First/first.md'))).toBe('first')
    expect(new TextDecoder().decode(await fs.read('Second/second.md'))).toBe('second')
    expect(await a.state.getCursor()).toBe(1)
    expect(await b.state.getCursor()).toBe(1)
    expect(first.requests.every((route) => route.startsWith('/v2/'))).toBe(true)
  } finally {
    await Promise.all([a.runtime.disconnect(), b.runtime.disconnect()])
  }
})
it('stages immutable executable bytes before cursor advance and approves without a network fetch', async () => {
  const wire = await server('Scripts/sample.js', 'sample executable'),
    fs = new MemoryFileSystem(),
    a = runtime(wire, fs)
  try {
    await a.runtime.sync()
    expect(await fs.stat('Scripts/sample.js')).toBeNull()
    expect(await a.state.getCursor()).toBe(1)
    const [candidate] = await a.reviews.executables.pending()
    expect(candidate.bytes).toEqual([...wire.bytes])
    const requests = wire.requests.length
    await a.reviews.executables.approve([candidate.id], a.runtime)
    expect(await fs.read(candidate.path)).toEqual(wire.bytes)
    expect((await fs.stat(candidate.path))?.mtime).toBe(1000)
    expect(wire.requests).toHaveLength(requests)
    expect(await a.reviews.executables.pending()).toEqual([])
  } finally {
    await a.runtime.disconnect()
  }
})
it('rechecks automatic code approval inside the engine lock before installing bytes', async () => {
  const wire = await server('Scripts/sample.js', 'sample executable'),
    fs = new MemoryFileSystem(),
    one = runtime(wire, fs)
  try {
    await one.runtime.sync()
    const [candidate] = await one.reviews.executables.pending()
    const revoked = new Error('Trust revoked')
    await expect(
      one.runtime.apply(candidate, () => {
        throw revoked
      })
    ).rejects.toBe(revoked)
    expect(await fs.stat(candidate.path)).toBeNull()
    expect(await one.reviews.executables.pending()).toHaveLength(1)
    await one.reviews.executables.approve([candidate.id], one.runtime)
    expect(await fs.read(candidate.path)).toEqual(wire.bytes)
  } finally {
    await one.runtime.disconnect()
  }
})

it.each(['cursor', 'file check'])(
  'revoking trust during a late %s await prevents executable installation',
  async (pause) => {
    const wire = await server('Scripts/sample.js', 'sample executable'),
      fs = new MemoryFileSystem(),
      one = runtime(wire, fs)
    try {
      await one.runtime.sync()
      const [candidate] = await one.reviews.executables.pending()
      let trusted = true
      if (pause === 'cursor') {
        const getCursor = one.state.getCursor.bind(one.state)
        vi.spyOn(one.state, 'getCursor').mockImplementation(async () => {
          trusted = false
          return getCursor()
        })
      } else {
        const stat = fs.stat.bind(fs)
        vi.spyOn(fs, 'stat').mockImplementation(async (path) => {
          trusted = false
          return stat(path)
        })
      }
      await expect(
        one.runtime.apply(candidate, () => {
          if (!trusted) throw new Error('Trust revoked')
        })
      ).rejects.toThrow('Trust revoked')
      expect(await fs.stat(candidate.path)).toBeNull()
      expect(await one.reviews.executables.pending()).toHaveLength(1)
    } finally {
      await one.runtime.disconnect()
    }
  }
)

it('revoking trust during directory metadata reads prevents directory publication', async () => {
  const wire = await server('Scripts/sample.js', 'sample executable')
  let created = false
  const mkdir = vi.fn(async () => {
    created = true
  })
  const fs = Object.assign(new MemoryFileSystem(), {
    mkdir,
    listDirectories: async function* () {
      if (created) yield { path: 'Scripts/new', identity: 'sample-folder', mtime: 1000 }
    },
  })
  const one = runtime(wire, fs)
  try {
    await one.runtime.sync()
    const [script] = await one.reviews.executables.pending()
    const { candidate } = await one.reviews.executables.stage({
      source: script.source,
      fileId: 'sample-directory',
      versionId: 'directory-version',
      path: 'Scripts/new',
      previousPath: 'Scripts/old',
      operation: 'move_directory',
      directory: true,
      receivedAt: 1000,
      mtime: 1000,
      sha: null,
      bytes: null,
    })
    let trusted = true
    const getMeta = one.state.getMeta.bind(one.state)
    vi.spyOn(one.state, 'getMeta').mockImplementation(async (key) => {
      if (key === 'v2-directories') trusted = false
      return getMeta(key)
    })
    mkdir.mockClear()
    await expect(
      one.runtime.apply(candidate!, () => {
        if (!trusted) throw new Error('Trust revoked')
      })
    ).rejects.toThrow('Trust revoked')
    expect(mkdir).not.toHaveBeenCalled()
  } finally {
    await one.runtime.disconnect()
  }
})

it('stages ordinary root settings for an explicit reload decision while normal notes keep moving', async () => {
  const wire = await server('.obsidian/app.json', '{"sample":true}'),
    fs = new MemoryFileSystem(),
    one = runtime(wire, fs)
  try {
    await one.runtime.sync()
    expect(await fs.stat(wire.item.path)).toBeNull()
    expect(await one.runtime.deferred()).toMatchObject([
      { path: wire.item.path, version_id: wire.item.version_id },
    ])
    expect(await one.reviews.executables.pending()).toEqual([])
    expect(await one.runtime.applyDeferred([wire.item.version_id])).toMatchObject({
      applied: [wire.item.path],
    })
    expect(await fs.read(wire.item.path)).toEqual(wire.bytes)
  } finally {
    await one.runtime.disconnect()
  }
})
it('does not bypass settings review at first contact with an existing local configuration file', async () => {
  const wire = await server('.obsidian/app.json', '{"sample":"remote"}'),
    fs = new MemoryFileSystem(),
    one = runtime(wire, fs)
  await fs.writeAtomic(wire.item.path, new TextEncoder().encode('{"sample":"local"}'), 2000)
  try {
    await one.runtime.sync()
    expect(new TextDecoder().decode(await fs.read(wire.item.path))).toBe('{"sample":"local"}')
    expect(await one.runtime.deferred()).toMatchObject([{ path: wire.item.path }])
  } finally {
    await one.runtime.disconnect()
  }
})
it('does not hold an ordinary configuration-folder creation as executable code', async () => {
  const wire = await server('.obsidian/app.json', '{"sample":true}'),
    send = wire.fetch.getMockImplementation()!
  wire.fetch.mockImplementation(async (input, init) => {
    if (new URL(String(input)).pathname === '/v2/manifest')
      return Response.json({
        items: [
          {
            file_id: 'sample-directory',
            version_id: 'sample-directory-version',
            kind: 'directory',
            path: '.obsidian',
            mtime: 1000,
          },
          wire.item,
        ],
        cursor: 1,
        next: null,
      })
    return send(input, init)
  })
  const fs = new MemoryFileSystem()
  let made = false
  Object.assign(fs, {
    mkdir: async () => {
      made = true
    },
    listDirectories: async function* () {
      if (made) yield { path: '.obsidian', identity: 'sample-local-directory', mtime: 1000 }
    },
  })
  const one = runtime(wire, fs)
  try {
    await one.runtime.sync()
    expect(await one.reviews.executables.pending()).toEqual([])
    expect(await one.runtime.deferred()).toMatchObject([{ path: '.obsidian/app.json' }])
  } finally {
    await one.runtime.disconnect()
  }
})

it('applies the older reviewed executable candidate while a newer immutable candidate stays pending', async () => {
  const wire = await server('Scripts/sample.js', 'original content'),
    fs = new MemoryFileSystem(),
    a = runtime(wire, fs)
  try {
    await a.runtime.sync()
    const [first] = await a.reviews.executables.pending()
    const nextBytes = new TextEncoder().encode('later candidate!'),
      nextSha = await sha256(nextBytes)
    const newer = {
      ...wire.item,
      version_id: 'later-version',
      sha: nextSha,
      size: nextBytes.length,
      mtime: 2000,
    }
    wire.fetch.mockImplementation(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/v2/connection')
        return Response.json({
          protocol: 2,
          token_id: 'sample-token',
          space_id: 'sample-space',
          scope,
          status: 'active',
          limits: { max_file_bytes: 1000000, quota_bytes: null },
        })
      if (url.pathname === '/v2/manifest')
        return Response.json({ items: [newer], cursor: 2, next: null })
      if (url.pathname === '/v2/changes') return Response.json({ items: [], cursor: 2, next: null })
      if (url.pathname.includes('/content')) return new Response(nextBytes)
      throw new Error('Unexpected route')
    })
    await a.runtime.engine.rescan()
    const [original, later] = await a.reviews.executables.pending()
    expect(original.id).toBe(first.id)
    expect(later.bytes).toEqual([...nextBytes])
    wire.fetch.mockRejectedValue(new Error('Approval must use no network'))
    await a.reviews.executables.approve([first.id], a.runtime)
    expect(await fs.read(first.path)).toEqual(wire.bytes)
    expect((await a.reviews.executables.pending()).map((one) => one.id)).toEqual([later.id])
    await a.reviews.executables.approve([later.id], a.runtime)
    expect(await fs.read(first.path)).toEqual(nextBytes)
  } finally {
    await a.runtime.disconnect()
  }
})

it('keeps group exchange closed while the server reports scope_updating', async () => {
  const wire = await server('Shared/sample.md', 'sample'),
    fs = new MemoryFileSystem(),
    a = runtime(wire, fs)
  wire.fetch.mockResolvedValue(
    Response.json({
      protocol: 2,
      token_id: 'sample-token',
      space_id: 'sample-space',
      scope,
      status: 'scope_updating',
      limits: { max_file_bytes: 1000000, quota_bytes: null },
    })
  )
  try {
    await expect(a.runtime.sync()).rejects.toMatchObject({ code: 'scope_updating' })
    expect(fs.snapshot().size).toBe(0)
    expect(await a.state.getCursor()).toBe(0)
  } finally {
    await a.runtime.disconnect()
  }
})
it.each([
  ['scope_updating', 'scope_updating'],
  ['scope_unavailable', 'scope_unavailable'],
  ['internal', 'offline'],
])('classifies a 503 %s response as %s', async (code, expected) => {
  const wire = await server('Shared/sample.md', 'sample'),
    fs = new MemoryFileSystem(),
    a = runtime(wire, fs)
  wire.fetch.mockImplementation(async () =>
    Response.json({ error: { code, message: 'Sample server refusal' } }, { status: 503 })
  )
  try {
    await expect(a.runtime.sync()).rejects.toMatchObject({ code: expected })
    expect(fs.snapshot().size).toBe(0)
    expect(await a.state.getCursor()).toBe(0)
  } finally {
    await a.runtime.disconnect()
  }
})

it('refuses a server that mutates an already captured executable version before advancing its cursor', async () => {
  const wire = await server('Scripts/sample.js', 'immutable sample'),
    fs = new MemoryFileSystem(),
    a = runtime(wire, fs)
  try {
    await a.runtime.sync()
    wire.item.sha = 'b'.repeat(64)
    await expect(a.runtime.engine.rescan()).rejects.toThrow(/Immutable executable/)
    expect((await a.reviews.executables.pending())[0].sha).not.toBe(wire.item.sha)
    expect(await fs.stat(wire.item.path)).toBeNull()
  } finally {
    await a.runtime.disconnect()
  }
})

it('synchronizes a group token without reading excluded vault notes for group eligibility', async () => {
  const group = { kind: 'group' as const, id: 'sample-group', path: 'Groups/sample.md' }
  const wire = await server(
      'Groups/sample.md',
      'group sample',
      'https://first.example',
      group as typeof scope
    ),
    fs = new MemoryFileSystem()
  await fs.writeAtomic('Ignored/large.md', new TextEncoder().encode('private excluded note'), 2000)
  const read = vi.spyOn(fs, 'read')
  const metadata = new MemoryStateStore(),
    runtime = new TokenEngineRuntime({
      id: 'sample-group-connection',
      encoded: encodeAccessToken({
        v: 1,
        address: wire.address,
        key: 'a'.repeat(43),
        scope: group,
      }),
      fs,
      state: new MemoryStateStore(),
      reviews: {
        executables: new ExecutableReview(metadata),
        attachments: new AttachmentConsent(metadata),
        close: () => {},
      },
      fetch: wire.fetch,
      changed: () => {},
      failed: () => {},
      covers: async () => false,
      scopeInput: async () => ({ key: 'group-scope', ignore: ignoreFor('.obsidian', 'Ignored/') }),
    })
  try {
    await runtime.sync()
    expect(await fs.stat('Groups/sample.md')).not.toBeNull()
    expect(read.mock.calls.map(([path]) => path)).not.toContain('Ignored/large.md')
  } finally {
    await runtime.disconnect()
  }
})

it('reads group candidates named by the server or ledger without reading unrelated note frontmatter', async () => {
  const group = { kind: 'group' as const, id: 'sample-group', path: 'Groups/sample.md' }
  const wire = await server(
    group.path,
    'group sample',
    'https://group.example',
    group as typeof scope
  )
  const fs = new MemoryFileSystem()
  for (let i = 0; i < 100; i++)
    await fs.writeAtomic(
      `Private/${i}.md`,
      new TextEncoder().encode('---\ngroups: []\n---\nprivate'),
      2000
    )
  const read = vi.spyOn(fs, 'read')
  const metadata = new MemoryStateStore()
  const state = new MemoryStateStore()
  const member = new TextEncoder().encode('---\ngroups:\n  - "[[Groups/sample]]"\n---\nmember')
  await fs.writeAtomic('Notes/member.md', member, 1000)
  await state.put({
    path: 'Notes/member.md',
    wirePath: 'Notes/member.md',
    fileId: 'member-file',
    versionId: 'member-version',
    sha: await sha256(member),
    size: member.length,
    mtime: 1000,
  })
  const one = new TokenEngineRuntime({
    id: 'bounded-group',
    encoded: encodeAccessToken({ v: 1, address: wire.address, key: 'a'.repeat(43), scope: group }),
    fs,
    state,
    reviews: {
      executables: new ExecutableReview(metadata),
      attachments: new AttachmentConsent(metadata),
      close: () => {},
    },
    fetch: wire.fetch,
    changed: () => {},
    failed: () => {},
    covers: async () => false,
  })
  try {
    await one.sync()
    await one.sync()
    expect(await fs.stat(group.path)).not.toBeNull()
    expect(read.mock.calls.filter(([path]) => path.startsWith('Private/'))).toEqual([])
    expect(read.mock.calls.some(([path]) => path === 'Notes/member.md')).toBe(true)
  } finally {
    await one.disconnect()
  }
})

it('stages standalone executable bytes outside the scripts folder', async () => {
  const wire = await server('Tools/sample.js', 'incoming executable'),
    fs = new MemoryFileSystem()
  const host = runtime(wire, fs)
  try {
    await host.runtime.sync()
    expect(await fs.stat(wire.item.path)).toBeNull()
    const candidates = await host.reviews.executables.pending()
    expect(candidates).toHaveLength(1)
    expect(candidates[0].bytes).toEqual([...wire.bytes])
  } finally {
    await host.runtime.disconnect()
  }
})

it.each(['same', 'different'])(
  'first connection preserves %s local bytes at a server path',
  async (local) => {
    const wire = await server('Notes/sample.md', 'same'),
      fs = new MemoryFileSystem()
    await fs.writeAtomic(wire.item.path, new TextEncoder().encode(local), 500)
    const host = runtime(wire, fs)
    try {
      await host.runtime.sync()
      expect(new TextDecoder().decode(await fs.read(wire.item.path))).toBe('same')
      const files = []
      for await (const info of fs.list())
        if (!info.path.startsWith('.abele-sync/')) files.push(info.path)
      expect(files).toHaveLength(local === 'same' ? 1 : 2)
      if (local !== 'same')
        expect(
          new TextDecoder().decode(await fs.read(files.find((path) => path !== wire.item.path)!))
        ).toBe(local)
    } finally {
      await host.runtime.disconnect()
    }
  }
)

it('reviews a directory rename found by a fresh manifest using its durable identity', async () => {
  const wire = await server('.obsidian/plugins/new', ''),
    send = wire.fetch.getMockImplementation()!
  wire.fetch.mockImplementation(async (input, init) => {
    if (new URL(String(input)).pathname === '/v2/manifest')
      return Response.json({
        items: [
          {
            file_id: 'sample-directory',
            version_id: 'new-version',
            kind: 'directory',
            path: '.obsidian/plugins/new',
            mtime: 2000,
          },
        ],
        cursor: 2,
        next: null,
      })
    return send(input, init)
  })
  const one = runtime(wire, new MemoryFileSystem())
  await one.state.setMeta(
    'v2-directories',
    JSON.stringify({
      directories: [
        {
          file_id: 'sample-directory',
          version_id: 'old-version',
          kind: 'directory',
          path: '.obsidian/plugins/old',
          mtime: 1000,
          identity: 'sample-local-folder',
        },
      ],
      removals: [],
    })
  )
  try {
    await one.runtime.sync()
    expect(await one.reviews.executables.pending()).toMatchObject([
      {
        operation: 'move_directory',
        previousPath: '.obsidian/plugins/old',
        path: '.obsidian/plugins/new',
      },
    ])
  } finally {
    await one.runtime.disconnect()
  }
})

it('releases transport observers and connection inventories on close even after stop fails', async () => {
  const one = runtime(await server('Notes/sample.md', 'sample'), new MemoryFileSystem())
  const internals = one.runtime as unknown as {
    transportObservers: Set<unknown>
    compared: Set<string>
    assetPaths: Map<string, string>
  }
  one.runtime.observeTransport(() => {})
  internals.compared.add('sample-id')
  internals.assetPaths.set('sample-id', 'sample.bin')
  vi.spyOn(one.runtime.engine, 'stop').mockRejectedValueOnce(new Error('sample stop failure'))
  await expect(one.runtime.close()).rejects.toThrow('sample stop failure')
  expect(internals.transportObservers.size).toBe(0)
  expect(internals.compared.size).toBe(0)
  expect(internals.assetPaths.size).toBe(0)
})

it('stops and reports the pinned-root reason even when filesystem wrappers add context', async () => {
  vi.useFakeTimers()
  const wire = await server('sample.md', 'sample')
  const fs = new MemoryFileSystem()
  const reason = Object.assign(new Error('Vault root changed; sync stopped'), {
    code: 'vault-root-changed',
  })
  let scans = 0
  // eslint-disable-next-line require-yield -- Simulates a scan failing before its first entry.
  fs.list = async function* () {
    scans++
    throw new EngineError('io', 'cannot inspect file', reason)
  }
  const failed = vi.fn()
  const one = runtime(wire, fs, undefined, undefined, null, { failed })
  try {
    await one.runtime.start()
    await one.runtime.sync().catch(() => {})
    // Core retains an error status after the host pauses inside its failure hook.
    expect(one.runtime.engine.status.state).toBe('error')
    expect(failed).toHaveBeenCalledWith(reason)
    const before = scans
    fs.emitChange(['sample.md'])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(scans).toBe(before)
  } finally {
    await one.runtime.close()
    vi.useRealTimers()
  }
})

it.each([
  'versions',
  'trash',
  'head',
  'restore',
  'restoreDeleted',
  'restoreDeletedMany',
  'commitRaw',
  'verifyExternalFile',
] as const)('rejects foreign paths in %s responses before core handling', async (method) => {
  const wire = await server('Shared/sample.md', 'sample', undefined, { ...scope, path: 'Shared' })
  const one = runtime(wire, new MemoryFileSystem(), undefined, undefined, null, {
    encoded: encodeAccessToken({
      v: 1,
      address: wire.address,
      key: 'a'.repeat(43),
      scope: { ...scope, path: 'Shared' },
    }),
  })
  const original = wire.fetch.getMockImplementation()!
  try {
    await one.runtime.sync()
    wire.fetch.mockImplementation(async (url, init) => {
      const route = new URL(String(url)).pathname
      if (route === '/v2/external-files/capabilities')
        return Response.json({
          extension_version: 1,
          projection_schema: 1,
          token: true,
          max_file_size: 1000,
          verification: {
            live_head: true,
            sha256: true,
            actual_size: true,
            authorization_rechecked: true,
          },
        })
      if (route !== '/v2/connection')
        return Response.json(
          method === 'commitRaw'
            ? { results: [{ path: 'Shared/sample.md', conflict_path: 'Private/secret.md' }] }
            : { path: 'Private/secret.md' }
        )
      return original(url, init)
    })
    const client = one.runtime.client
    await expect(async () => {
      if (method === 'commitRaw')
        return client.commitRaw([{ op: 'mkdir', path: 'Shared/new' }], 'sample-key')
      if (method === 'verifyExternalFile')
        return client.verifyExternalFile('file', {
          version_id: 'version',
          path: 'Shared/sample.md',
          sha: 'a'.repeat(64),
          size: 1,
        })
      if (method === 'commitRaw') return client.commitRaw([{ op: 'mkdir', path: 'Shared/new' }])
      if (method === 'restoreDeletedMany') return client.restoreDeletedMany(['file'])
      if (method === 'restore') return client.restore('file', 'version')
      if (method === 'trash') return client.trash()
      return client[method]('file')
    }).rejects.toMatchObject({
      code: 'protocol',
      message: expect.stringContaining('outside this connection'),
    })
  } finally {
    await one.runtime.close()
  }
})

it('accepts only files under the pinned local placement for outgoing discovery', async () => {
  const wire = await server('Shared/sample.md', 'sample', undefined, { ...scope, path: 'Shared' })
  const one = runtime(wire, new MemoryFileSystem(), undefined, undefined, null, {
    localRoot: 'Moved',
  })
  try {
    await one.runtime.sync()
    expect(one.runtime.acceptsLocal('Moved/new.md', 10)).toBe(true)
    expect(one.runtime.acceptsLocal('Shared/secret.md', 10)).toBe(false)
    expect(one.runtime.acceptsLocal('Private/secret.md', 10)).toBe(false)
  } finally {
    await one.runtime.close()
  }
})

it.each(['path', 'previousPath', 'directory'] as const)(
  'rejects foreign retained review %s before applying any bytes',
  async (field) => {
    const wire = await server('Shared/sample.js', '// reviewed code', undefined, {
      ...scope,
      path: 'Shared',
    })
    const fs = new MemoryFileSystem()
    await fs.writeAtomic('Private/secret.js', new TextEncoder().encode('// private code'), 1000)
    const one = runtime(wire, fs, undefined, undefined, null, {
      encoded: encodeAccessToken({
        v: 1,
        address: wire.address,
        key: 'a'.repeat(43),
        scope: { ...scope, path: 'Shared' },
      }),
    })
    try {
      await one.runtime.sync()
      const [candidate] = await one.reviews.executables.pending()
      expect(candidate).toBeDefined()
      const before = fs.snapshot(),
        read = vi.spyOn(fs, 'read'),
        stat = vi.spyOn(fs, 'stat')
      const foreign =
        field === 'directory'
          ? { ...candidate, path: 'Private/secret.js', directory: true }
          : { ...candidate, [field]: 'Private/secret.js' }
      await expect(one.runtime.apply(foreign)).rejects.toMatchObject({ code: 'protocol' })
      expect(read).not.toHaveBeenCalled()
      expect(stat).not.toHaveBeenCalled()
      expect(fs.snapshot()).toEqual(before)
    } finally {
      await one.runtime.close()
    }
  }
)

it.each([undefined, 'Moved'])(
  'explicitly follows a server rename while keeping local bytes and saved paths unchanged (local root %s)',
  async (localRoot) => {
    const shared = { ...scope, path: 'Shared' }
    const wire = await server('Shared/sample.md', 'sample', undefined, shared)
    const fs = new MemoryFileSystem(),
      state = new MemoryStateStore(),
      rootChanged = vi.fn(),
      serverRootChanged = vi.fn()
    const one = runtime(wire, fs, state, undefined, null, {
      rootChanged,
      serverRootChanged,
      localRoot,
    } as Partial<TokenEngineOptions>)
    try {
      await one.runtime.sync()
      const baseline = await Array.fromAsync(state.all())
      await fs.writeAtomic('Private/secret.md', new TextEncoder().encode('private bytes'), 1000)
      shared.path = 'Private'
      wire.item.path = 'Private/sample.md'
      const read = vi.spyOn(fs, 'read'),
        stat = vi.spyOn(fs, 'stat')
      await expect(one.runtime.sync()).rejects.toThrow(/Shared.*Private/)
      expect(rootChanged).toHaveBeenLastCalledWith({
        kind: 'server-renamed',
        from: 'Shared',
        to: 'Private',
      })
      wire.fetch.mockClear()
      await one.runtime.followServerRoot()
      expect(serverRootChanged).toHaveBeenCalledWith('Private')
      expect(await Array.fromAsync(state.all())).toEqual(baseline)
      expect(read.mock.calls.some(([path]) => path.startsWith('Private/'))).toBe(false)
      expect(stat.mock.calls.some(([path]) => path.startsWith('Private/'))).toBe(false)
      expect(
        wire.fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/v2/commit')
      ).toEqual([])
      const send = wire.fetch.getMockImplementation()!
      wire.fetch.mockImplementation(async (url, init) => {
        if (new URL(String(url)).pathname !== '/v2/commit') return send(url, init)
        const { ops } = JSON.parse(String(init?.body))
        return Response.json({
          cursor: 1,
          results: ops.map((op: { path: string; sha: string; size: number; mtime: number }) => ({
            status: 'applied',
            file_id: 'new-file',
            version_id: 'new-version',
            seq: 1,
            path: op.path,
            sha: op.sha,
            size: op.size,
            mtime: op.mtime,
          })),
        })
      })
      await fs.writeAtomic(
        (localRoot ?? 'Shared') + '/new.md',
        new TextEncoder().encode('new local edit'),
        2000
      )
      await one.runtime.sync()
      const commits = wire.fetch.mock.calls
        .filter(([url]) => new URL(String(url)).pathname === '/v2/commit')
        .map(([, init]) => String(init?.body))
        .join('')
      expect(commits).toContain('Private/new.md')
      expect(commits).not.toContain('secret.md')
      expect(commits).not.toContain('"op":"delete')
      expect(await state.get('Shared/new.md')).toMatchObject({
        fileId: 'new-file',
        path: 'Shared/new.md',
        wirePath: 'Shared/new.md',
      })
      expect(await state.get('Private/new.md')).toBeNull()
    } finally {
      await one.runtime.close()
    }
  }
)

it.each(['renamed-again', 'pending-commit'] as const)(
  'keeps server rename stopped when confirmation is unsafe: %s',
  async (condition) => {
    const shared = { ...scope, path: 'Shared' },
      wire = await server('Shared/sample.md', 'sample', undefined, shared),
      state = new MemoryStateStore(),
      changed = vi.fn()
    const one = runtime(wire, new MemoryFileSystem(), state, undefined, null, {
      serverRootChanged: changed,
    })
    try {
      await one.runtime.sync()
      shared.path = 'Renamed'
      wire.item.path = 'Renamed/sample.md'
      await expect(one.runtime.sync()).rejects.toThrow(/Shared.*Renamed/)
      if (condition === 'renamed-again') shared.path = 'Final'
      else
        await state.setJournal({
          batchId: 'pending',
          idempotencyKey: 'key',
          startedAt: new Date().toISOString(),
          ops: [],
        })
      await expect(one.runtime.followServerRoot()).rejects.toThrow(/again|unresolved/)
      expect(changed).not.toHaveBeenCalled()
      await expect(one.runtime.sync()).rejects.toThrow(/folder|paused/i)
    } finally {
      await one.runtime.close()
    }
  }
)

it('restarts an acknowledged server rename without migrating existing saved paths', async () => {
  const wire = await server('Renamed/sample.md', 'sample', undefined, { ...scope, path: 'Renamed' })
  const fs = new MemoryFileSystem(),
    state = new MemoryStateStore()
  await fs.writeAtomic('Shared/sample.md', wire.bytes, 1000)
  await state.put({
    path: 'Shared/sample.md',
    wirePath: 'Shared/sample.md',
    fileId: wire.item.file_id,
    versionId: wire.item.version_id,
    sha: wire.item.sha,
    size: wire.bytes.length,
    mtime: 1000,
  })
  const before = await Array.fromAsync(state.all())
  const one = runtime(wire, fs, state, undefined, null, {
    serverRoot: 'Renamed',
    localRoot: 'Shared',
    encoded: encodeAccessToken({
      v: 1,
      address: wire.address,
      key: 'a'.repeat(43),
      scope: { ...scope, path: 'Shared' },
    }),
  })
  try {
    await one.runtime.sync()
    expect(await Array.fromAsync(state.all())).toEqual(before)
    expect(await fs.stat('Renamed/sample.md')).toBeNull()
  } finally {
    await one.runtime.close()
  }
})

it.each([false, true])(
  'keeps file and byte progress advancing through a held mobile directory (changes=%s)',
  async (changes) => {
    const physical = 'Cafe\u0301',
      wireRoot = physical.normalize('NFC')
    const wire = await server('Notes/sample.md', 'remote sample')
    const send = wire.fetch.getMockImplementation()!
    const directory = {
      file_id: 'sample-directory',
      version_id: 'sample-directory-version',
      kind: 'directory',
      path: wireRoot,
      mtime: 1000,
    }
    const app = buildFakeVault(
      [
        { path: physical + '/kept.md', content: 'local sample' },
        { path: wireRoot + '/other.md', content: 'other sample' },
      ],
      { sensitiveNames: true }
    )
    expect(Reflect.get(app.vault.adapter, 'fsPromises')).toBeUndefined()
    const fs = new ObsidianFileSystem(app as unknown as App)
    const updates: (TransferSnapshot | undefined)[] = []
    const contentProgress: (TransferSnapshot | undefined)[] = []
    wire.fetch.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname
      const items = [
        directory,
        { ...directory, file_id: 'notes-directory', path: 'Notes' },
        wire.item,
      ]
      if (changes && path === '/v2/changes') {
        const since = Number(new URL(String(input)).searchParams.get('since'))
        return Response.json({
          items:
            since < 1
              ? items.map((item, index) => ({
                  type: 'content',
                  file_id: item.file_id,
                  at: '2020-01-01T00:00:00Z',
                  cursor: index + 1,
                  path: item.path,
                  item,
                  prev_path: null,
                }))
              : [],
          cursor: 3,
          next: null,
        })
      }
      if (path === '/v2/manifest')
        return Response.json({
          items: changes ? [] : items,
          cursor: changes ? 0 : 1,
          next: null,
        })
      if (path.endsWith('/content')) {
        contentProgress.push(updates.at(-1))
        const range = new Headers(init?.headers).get('range')
        if (range) {
          const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(range)!
          const start = Number(first),
            end = Number(last)
          return new Response(wire.bytes.slice(start, end + 1), {
            status: 206,
            headers: {
              'content-range': `bytes ${start}-${end}/${wire.bytes.length}`,
              'content-length': String(end - start + 1),
            },
          })
        }
      }
      return send(input, init)
    })
    const one = runtime(
      wire,
      fs as unknown as MemoryFileSystem,
      new MemoryStateStore(),
      new PathCoordinator(),
      null,
      { progress: (value) => updates.push(value) }
    )
    try {
      await one.runtime.sync()
      expect(contentProgress).toContainEqual(expect.objectContaining({ stage: 'Downloading' }))
      expect(updates).toContainEqual(
        expect.objectContaining({ stage: 'Downloading', completed: 1, bytes: wire.bytes.length })
      )
      expect(await app.vault.adapter.read('Notes/sample.md')).toBe('remote sample')
      expect(await app.vault.adapter.read(physical + '/kept.md')).toBe('local sample')
      expect(JSON.parse((await one.state.getMeta('v2-directories'))!).incoming).toContainEqual(
        expect.objectContaining({ file_id: directory.file_id })
      )
    } finally {
      await one.runtime.close()
    }
  }
)
