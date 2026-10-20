import { PHONE_FALLBACK_BYTES } from './mobileWholeRead'
import { nativeChunkPort, vaultDisk } from './vaultPathLinks'
import { connectionPrivateArea, withinRoot } from './connectionPaths'
import { preservePrivateArtifacts, privateArtifactRecovered } from './privateRecovery'
import type { App } from 'obsidian'
import {
  fingerprintFile,
  type FileSystem,
  type StateEntry,
  type V2EngineClient,
} from '@abele/sync-sdk/core'
import { sha256 } from './external/hash'
import { devicePinned } from './external/devicePins'
import { ExternalFilePortError } from './external/filesystem'
import { AttachmentStore } from './external/attachmentStore'
import { ExternalFileHost } from './external/ObsidianExternalFileHost'
import { activateExternalFiles, recoverOrphanPrivateArtifacts } from './external/pluginSafety'
import { ExternalState } from './external/state'
import { pluginRepresentation } from './external/pluginRepresentation'
import type { ConnectionBinding, ExternalRecord } from './external/records'
import type { RuntimeFence } from './external/recovery'
import type { IndexedDbStateStore } from './IndexedDbStateStore'
import type { ExternalDescription, TokenOffloadCoordinator } from './tokenOffloadCoordinator'
import { retryTransientOperation } from './transientOperation'
import { parseProjection } from './external/projection'
import { saveExternalPreview } from './external/preview'
import type { LocalFolderPlacement } from './localFolderPlacement'
import { placedExternalHost } from './placedExternalHost'

/** Composition of the existing durable external-file state machine with token authority. */
export async function tokenOffloadConnection(input: {
  app: App
  factory: IDBFactory
  state: IndexedDbStateStore
  ledgerId: string
  binding: ConnectionBinding
  fence: RuntimeFence
  fs: FileSystem
  placement?: LocalFolderPlacement
  manager: TokenOffloadCoordinator
  scriptsFolder(): string
  client(): V2EngineClient
  sync(): Promise<void>
  includes(path: string): boolean
  available?(): boolean
  capture(
    paths: string[],
    fingerprint?: (path: string) => Promise<{ size: number; sha: string }>
  ): Promise<void>
  rememberIdentity(path: string): void
  hydratedIdentity(path: string): void
}) {
  const { state, ledgerId, fence, manager } = input
  const toLocal = (path: string) => input.placement?.toLocal(path) ?? path
  const localArtifact = (path: string) => {
    const owned = connectionPrivateArea(input.app)
    const prefix = host.artifactPath('')
    return (owned && withinRoot(path, owned)) ||
      (path.startsWith(prefix) &&
        path.split('/').every((part) => part !== '.' && part !== '..' && part.length > 0))
      ? path
      : toLocal(path)
  }
  const toServer = (path: string) => input.placement?.toServer(path) ?? path
  const representation = await pluginRepresentation({
    ...input,
    fs: input.placement?.fileSystem(input.fs) ?? input.fs,
    store: state,
    verify: (id, request) => input.client().verifyExternalFile(id, request),
  })
  let external: ExternalState | null =
    (await state.getExternalState()) === null
      ? null
      : await ExternalState.open(state, ledgerId, input.binding)
  let attachments: AttachmentStore | null = null
  const stagingMtimes = new Map<string, number>()
  let serial = Promise.resolve()
  const run = <T>(work: () => Promise<T>): Promise<T> => {
    const next = serial.then(work)
    serial = next.then(
      () => {},
      () => {}
    )
    return next
  }
  const localHost: ExternalFileHost = new ExternalFileHost(input.app, {
    platform: nativeChunkPort(vaultDisk(input.app.vault)).available ? 'desktop' : 'mobile',
    assertOwned: () => fence.assertReady(),
    effect: (work) => fence.effect(work),
    placement: manager.locks,
    beforeRemoval: (path) => input.capture([path], (one) => localHost.fingerprint(one)),
    assertRemovalAllowed: (path) => {
      if (devicePinned(input.app, path)) throw new ExternalFilePortError('pinned')
    },
    stagingMtime: (path) => stagingMtimes.get(path) ?? Date.now(),
  })
  const host = placedExternalHost(localHost, input.placement)
  const describe = async (
    path: string,
    record?: ExternalRecord
  ): Promise<ExternalDescription | null> => {
    const canonical = record ? path : toServer(path)
    const file =
      record ??
      (await external?.snapshot())?.files.find(
        (one) => one.lastProvenLocalBase?.path === canonical && one.representation !== 'hydrated'
      )
    if (!file?.projectionPath || !file.projectionSha) return null
    const bytes = await host.read(file.projectionPath)
    if ((await sha256(bytes)) !== file.projectionSha) throw new Error('The local stub changed')
    const projection = parseProjection(bytes)
    const current = await state.get(canonical)
    fence.assertReady()
    return {
      ...projection,
      path: toLocal(projection.path),
      changed: !!current && current.versionId !== file.lastProvenLocalBase?.versionId,
      available: input.available?.() ?? true,
    }
  }
  const refresh = async () => {
    await representation.refresh()
    const document = external ? await external.snapshot() : null
    for (const file of document?.files ?? []) {
      if (file.representation === 'hydrated' || !file.lastProvenLocalBase) continue
      try {
        const detail = await describe(file.lastProvenLocalBase.path, file)
        if (detail) manager.rememberDescription(detail)
      } catch (error) {
        console.debug('[abele-sync] external description is unavailable', error)
      }
    }
    manager.remember(
      ledgerId,
      (document?.files ?? [])
        .filter((one) => one.representation !== 'hydrated')
        .flatMap((one) =>
          one.lastProvenLocalBase
            ? [
                {
                  path: toLocal(one.lastProvenLocalBase.path),
                  size: one.lastProvenLocalBase.size,
                  mtime: one.lastProvenLocalBase.mtime,
                },
              ]
            : []
        ),
      [
        ...(document?.files ?? []).flatMap((one) =>
          one.projectionPath ? [localArtifact(one.projectionPath)] : []
        ),
        ...(document?.operations ?? []).flatMap((one) =>
          one.ownedArtifacts.map((artifact) => localArtifact(artifact.path))
        ),
      ]
    )
  }
  const unbind = manager.register(ledgerId, {
    describe,
    ledger: input.placement?.localState(state) ?? state,
    available: () => input.available?.() ?? true,
    includes: (path) => input.includes(path),
    assertOwned: () => fence.assertReady(),
    verify: async (head) => {
      await retryTransientOperation(
        () =>
          input.client().verifyExternalFile(head.fileId, {
            version_id: head.versionId,
            path: head.wirePath,
            sha: head.sha,
            size: head.size,
          }),
        () => fence.assertReady()
      )
    },
    download: (head) =>
      retryTransientOperation(
        () => input.client().versionBytes(head.fileId, head.versionId),
        () => fence.assertReady()
      ),
    openVersion: (head, signal) =>
      retryTransientOperation(
        async () => {
          const client = input.client()
          if (typeof client.openVersion === 'function')
            return client.openVersion(head.fileId, head.versionId, head, signal)
          // Legacy/custom providers retain their small-file byte API only within the phone limit.
          if (head.size > PHONE_FALLBACK_BYTES)
            throw new Error('Bounded file reads are unavailable; the fallback limit is 50 MiB')
          signal?.throwIfAborted()
          let bytes: Uint8Array | null = await client.versionBytes(head.fileId, head.versionId)
          return {
            size: head.size,
            signal,
            read: async (offset: number, length: number, cancellation?: AbortSignal) => {
              cancellation?.throwIfAborted()
              signal?.throwIfAborted()
              if (!bytes || length > 1024 * 1024) throw new Error('Invalid bounded source read')
              return bytes.slice(offset, offset + length)
            },
            assertUnchanged: async () => {
              signal?.throwIfAborted()
            },
            close: async () => {
              bytes = null
            },
          }
        },
        () => {
          fence.assertReady()
          signal?.throwIfAborted()
        }
      ),
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
        artifactPath: (name) => host.artifactPath(name),
        preservePrivateArtifacts: (paths, ordinary) =>
          preservePrivateArtifacts(input.app, paths, () => fence.assertReady(), ordinary),
        privateArtifactRecovered: (path) => privateArtifactRecovered(input.app, path),
        cleanupPrivateArtifacts: () =>
          recoverOrphanPrivateArtifacts(input.app, input.factory, () => fence.assertReady()),
        binding: input.binding,
        serial: { run },
        assertOwned: () => fence.assertReady(),
        sync: () => input.sync(),
        scriptsFolder: () => input.scriptsFolder(),
        verify: (id, request) =>
          retryTransientOperation(
            () => input.client().verifyExternalFile(id, request),
            () => fence.assertReady()
          ),
        authorizeHydration: (head) => manager.authorize({ ...head, path: toLocal(head.path) }),
        openVersion: async (id, version, expected, signal) => {
          const head = await state.byFileId(id)
          if (
            !head ||
            head.versionId !== version ||
            head.sha !== expected.sha ||
            head.size !== expected.size
          )
            throw new Error('Offloaded source identity changed')
          return manager.openVersion(ledgerId, { ...head, path: toLocal(head.path) }, signal)
        },
        download: async (id, version, sha) => {
          const head = await state.byFileId(id)
          if (!head || head.versionId !== version || head.sha !== sha)
            throw new Error('Offloaded source identity changed')
          return manager.download(ledgerId, { ...head, path: toLocal(head.path) })
        },
        refreshed: refresh,
      })
    return attachments
  }
  const head = async (path: string): Promise<StateEntry> => {
    fence.assertReady()
    const entry = await state.get(toServer(path))
    if (!entry) throw new Error('not-on-server')
    return entry
  }
  const operation = async <T>(entry: StateEntry, work: (operationId: string) => Promise<T>) => {
    const id = crypto.randomUUID()
    const staging = host.artifactPath(`.abele-external-${id}.incoming`)
    stagingMtimes.set(staging, entry.mtime)
    try {
      return await work(id)
    } finally {
      stagingMtimes.delete(staging)
    }
  }
  const hydrate = async (path: string, signal?: AbortSignal) => {
    const entry = await head(path),
      api = await store()
    const controller = new AbortController()
    const cancel = () => controller.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    const stop = manager.cancellable(path, cancel)
    manager.progress(path, { done: 0, total: entry.size })
    try {
      const result = await operation(entry, (operationId) =>
        api.hydrate(entry.fileId, {
          operationId,
          expectedVersionId: entry.versionId,
          signal: controller.signal,
        })
      )
      if (result.status !== 'complete') throw new Error('File hydration stopped: ' + result.status)
      await refresh()
      input.hydratedIdentity(path)
    } finally {
      stop()
      signal?.removeEventListener('abort', cancel)
      manager.progress(path)
    }
  }
  manager.hydrator(ledgerId, hydrate)
  await refresh()
  return {
    includes: (path: string) => input.includes(path),
    pinned: async (path: string) => {
      const entry = await head(path)
      if (!external) return false
      return (
        (await external.snapshot()).files.find((file) => file.fileId === entry.fileId)?.pinned ??
        false
      )
    },
    inspect: async (path: string) => {
      if (!input.includes(path)) throw new Error('File is outside this connection')
      const entry = await head(path),
        api = await store()
      const snapshot = await api.get(entry.fileId)
      const check = await api.inspectEviction(entry.fileId)
      let blocked: string | null = check.status === 'complete' ? null : check.status
      if (snapshot && snapshot.representation !== 'hydrated') blocked = 'already-offloaded'
      if (snapshot?.pendingOperationId) blocked = 'busy'
      if (input.available?.() === false) blocked = 'offline'
      if (!blocked) {
        const local = await fingerprintFile(input.fs, path, sha256)
        if (local.sha !== entry.sha || local.size !== entry.size) blocked = 'local-changed'
      }
      return {
        path,
        size: entry.size,
        version: entry.versionId,
        pinned: snapshot?.pinned ?? false,
        blocked,
      }
    },
    setPinned: async (path: string, pinned: boolean) => {
      if (!input.includes(path)) throw new Error('File is outside this connection')
      const entry = await head(path),
        api = await store()
      const result = await api.setPinned(entry.fileId, pinned)
      await refresh()
      if (pinned && result.status === 'cleanup-pending') await hydrate(path)
      return result.status === 'cleanup-pending'
        ? { ...result, status: 'complete' as const }
        : result
    },
    fs: manager.fileSystem(
      input.placement?.localFileSystem(representation.fileSystem()) ?? representation.fileSystem(),
      (path) => input.includes(path),
      ledgerId
    ),
    state: representation.stateStore(),
    client: representation.engineClient.bind(representation),
    hydrate,
    evict: async (path: string, version?: string) => {
      if (!input.includes(path)) throw new Error('File is outside this connection')
      input.rememberIdentity(path)
      const entry = await head(path),
        api = await store(),
        snapshot = await api.get(entry.fileId)
      if (version && entry.versionId !== version)
        return { status: 'version-changed' as const, reclaimedBytes: 0 }
      const preview = await saveExternalPreview(input.app, path, entry.sha)
      const result = await operation(entry, (operationId) =>
        api.evict(entry.fileId, {
          operationId,
          expectedRevision: snapshot?.localRevision ?? 0,
          expectedVersionId: entry.versionId,
          preview,
        })
      ).catch((error: unknown) => {
        if (error instanceof ExternalFilePortError && error.reason === 'pinned')
          return { status: 'pinned' as const, reclaimedBytes: 0 }
        throw error
      })
      await refresh()
      return result
    },
    prepareDisconnect: async () => {
      if (!external) return
      for (const file of (await external.snapshot()).files)
        if (file.representation !== 'hydrated' && file.lastProvenLocalBase)
          await hydrate(toLocal(file.lastProvenLocalBase.path))
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
