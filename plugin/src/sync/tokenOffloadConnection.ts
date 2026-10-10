import type { App } from 'obsidian'
import type { FileSystem, StateEntry, V2EngineClient } from '@abele/sync-core'
import { AttachmentStore } from './external/attachmentStore'
import { ExternalFileHost } from './external/ObsidianExternalFileHost'
import { activateExternalFiles } from './external/pluginSafety'
import { ExternalState } from './external/state'
import { pluginRepresentation } from './external/pluginRepresentation'
import type { ConnectionBinding } from './external/records'
import type { RuntimeFence } from './external/recovery'
import type { IndexedDbStateStore } from './IndexedDbStateStore'
import type { TokenOffloadCoordinator } from './tokenOffloadCoordinator'

/** Composition of the existing durable external-file state machine with token authority. */
export async function tokenOffloadConnection(input: {
  app: App
  factory: IDBFactory
  state: IndexedDbStateStore
  ledgerId: string
  binding: ConnectionBinding
  fence: RuntimeFence
  fs: FileSystem
  manager: TokenOffloadCoordinator
  scriptsFolder(): string
  client(): V2EngineClient
  sync(): Promise<void>
  includes(path: string): boolean
  capture(paths: string[]): Promise<void>
  rememberIdentity(path: string): void
  hydratedIdentity(path: string): void
}) {
  const { state, ledgerId, fence, manager } = input
  const representation = await pluginRepresentation({
    ...input,
    store: state,
    verify: (id, request) => input.client().verifyExternalFile(id, request),
  })
  let external: ExternalState | null =
    (await state.getExternalState()) === null
      ? null
      : await ExternalState.open(state, ledgerId, input.binding)
  let attachments: AttachmentStore | null = null,
    mtime = 0
  let serial = Promise.resolve()
  const run = <T>(work: () => Promise<T>): Promise<T> => {
    const next = serial.then(work)
    serial = next.then(
      () => {},
      () => {}
    )
    return next
  }
  const host = new ExternalFileHost(input.app, {
    platform:
      typeof (input.app.vault.adapter as unknown as { fsPromises?: unknown }).fsPromises ===
      'object'
        ? 'desktop'
        : 'mobile',
    assertOwned: () => fence.assertReady(),
    effect: (work) => fence.effect(work),
    placement: manager.locks,
    beforeRemoval: (path) => input.capture([path]),
    stagingMtime: () => mtime,
  })
  const refresh = async () => {
    await representation.refresh()
    const document = external ? await external.snapshot() : null
    manager.remember(
      ledgerId,
      (document?.files ?? [])
        .filter((one) => one.representation !== 'hydrated')
        .flatMap((one) =>
          one.lastProvenLocalBase
            ? [
                {
                  path: one.lastProvenLocalBase.path,
                  size: one.lastProvenLocalBase.size,
                  mtime: one.lastProvenLocalBase.mtime,
                },
              ]
            : []
        ),
      [
        ...(document?.files ?? []).flatMap((one) =>
          one.projectionPath ? [one.projectionPath] : []
        ),
        ...(document?.operations ?? []).flatMap((one) =>
          one.ownedArtifacts.map((artifact) => artifact.path)
        ),
      ]
    )
  }
  const unbind = manager.register(ledgerId, {
    ledger: state,
    includes: (path) => input.includes(path),
    assertOwned: () => fence.assertReady(),
    verify: async (head) => {
      await input.client().verifyExternalFile(head.fileId, {
        version_id: head.versionId,
        path: head.wirePath,
        sha: head.sha,
        size: head.size,
      })
    },
    download: (head) => input.client().versionBytes(head.fileId, head.versionId),
  })
  const store = async () => {
    fence.assertReady()
    if (!external) {
      external = await activateExternalFiles(
        input.app,
        state,
        ledgerId,
        ledgerId,
        input.binding,
        () => fence.assertReady()
      )
      await representation.activate(external)
    }
    if (!attachments)
      attachments = new AttachmentStore({
        state: external,
        ledger: state,
        host,
        binding: input.binding,
        serial: { run },
        assertOwned: () => fence.assertReady(),
        sync: () => input.sync(),
        scriptsFolder: () => input.scriptsFolder(),
        verify: (id, request) => input.client().verifyExternalFile(id, request),
        authorizeHydration: (head) => manager.authorize(head),
        download: async (id, version, sha) => {
          const head = await state.byFileId(id)
          if (!head || head.versionId !== version || head.sha !== sha)
            throw new Error('Offloaded source identity changed')
          return manager.download(ledgerId, head)
        },
        refreshed: refresh,
      })
    return attachments
  }
  const head = async (path: string): Promise<StateEntry> => {
    fence.assertReady()
    const entry = await state.get(path)
    if (!entry) throw new Error('File has no retained identity in this connection')
    mtime = entry.mtime
    return entry
  }
  const hydrate = async (path: string) => {
    const entry = await head(path),
      api = await store()
    const result = await api.hydrate(entry.fileId, {
      operationId: crypto.randomUUID(),
      expectedVersionId: entry.versionId,
    })
    if (result.status !== 'complete') throw new Error('File hydration: ' + result.status)
    await refresh()
    input.hydratedIdentity(path)
  }
  manager.hydrator(ledgerId, hydrate)
  await refresh()
  return {
    fs: manager.fileSystem(representation.fileSystem(), (path) => input.includes(path), ledgerId),
    state: representation.stateStore(),
    client: representation.engineClient.bind(representation),
    hydrate,
    evict: async (path: string) => {
      if (!input.includes(path)) throw new Error('File is outside this connection')
      input.rememberIdentity(path)
      const entry = await head(path),
        api = await store(),
        snapshot = await api.get(entry.fileId)
      const result = await api.evict(entry.fileId, {
        operationId: crypto.randomUUID(),
        expectedRevision: snapshot?.localRevision ?? 0,
        expectedVersionId: entry.versionId,
      })
      await refresh()
      return result
    },
    prepareDisconnect: async () => {
      if (!external) return
      for (const file of (await external.snapshot()).files)
        if (file.representation !== 'hydrated' && file.lastProvenLocalBase)
          await hydrate(file.lastProvenLocalBase.path)
      const api = await store(),
        saved = await state.getMeta('token-offload-disconnect'),
        operationId = saved ?? crypto.randomUUID()
      if (!saved) await state.setMeta('token-offload-disconnect', operationId)
      const result = await api.materializeForDisconnect({ operationId })
      if (result.status !== 'complete')
        throw new Error('Disconnect requires recovery: ' + result.status)
      await refresh()
    },
    close: () => {
      unbind()
      host.close()
    },
  }
}
