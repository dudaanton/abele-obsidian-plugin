import { nativeChunkPort } from '../vaultPathLinks'
import { vaultDisk } from '../vaultPathLinks'
import type { App } from 'obsidian'
import type { FileSystem, StateStore } from '@abele/sync-sdk/core'
import { ExternalState } from './state'
import { ExternalRepresentation, type RepresentationOptions } from './representation'
import { ExternalFileHost } from './ObsidianExternalFileHost'
import { ExternalRecoveryRequired, type RuntimeFence } from './recovery'
import type { ConnectionBinding } from './records'
import { IndexedDbStateStore } from '../IndexedDbStateStore'
import { retiredArtifactPaths } from './pluginSafety'
import { inspectionCache } from './inspectionCache'
import {
  projectionInspectionIdentity,
  sameInspectionEntry,
  trustedProjectionInspectionReason,
} from './inspectionIdentity'
import type { LocalFolderPlacement } from '../localFolderPlacement'
import { placedExternalHost } from '../placedExternalHost'
import { SyncTaskBudget } from '../syncTaskBudget'
import type { InspectionEntry } from './inspectionIdentity'

/** Called only after the startup fence/journal inspection, before engine activation.
 * During receive/recovery this callback runs inside the owning sync job; it does not enqueue
 * or await public sync() recursively. No production caller initiates eviction/hydration. */
export async function pluginRepresentation(options: {
  app: App
  factory: IDBFactory
  store: IndexedDbStateStore
  ledger?: StateStore
  ledgerId: string
  binding: ConnectionBinding
  fence: RuntimeFence
  fs: FileSystem
  placement?: LocalFolderPlacement
  inspectionIncludes?(physicalPath: string): boolean
  inspectionRows?: readonly InspectionEntry[] | (() => Promise<readonly InspectionEntry[]>)
  verify: RepresentationOptions['verify']
  scriptsFolder(): string
  excluded?: RepresentationOptions['excluded']
  reconciled?(path: string): void
}): Promise<ExternalRepresentation> {
  const { app, store, ledgerId, binding, fence } = options
  const state =
    (await store.getExternalState()) === null
      ? null
      : await ExternalState.open(store, ledgerId, binding)
  fence.assertOwned()
  const cache = inspectionCache(app)
  const persisted = new Map<string, InspectionEntry>()
  return ExternalRepresentation.open({
    inspection: {
      entries: [],
      load: async () => {
        // The shared loader validates this snapshot before classification. Classification
        // still verifies each path's current identity before reusing a row.
        const entries =
          typeof options.inspectionRows === 'function'
            ? await options.inspectionRows()
            : (options.inspectionRows ?? (await cache.load()))
        const budget = new SyncTaskBudget()
        for (const entry of entries) {
          persisted.set(entry.path, entry)
          const pause = budget.metadataRow()
          if (pause !== undefined) await pause
        }
        fence.assertOwned()
        return entries
      },
      storage: cache.storage,
      cacheKey: (path) => options.placement?.toLocal(path) ?? path,
      ownsKey: (path) =>
        options.inspectionIncludes
          ? options.inspectionIncludes(path)
          : !options.placement ||
            path === options.placement.local ||
            path.startsWith(options.placement.local + '/'),
      identity: (path, prior) =>
        projectionInspectionIdentity(app, options.placement?.toLocal(path) ?? path, prior),
      trusted: (path, prior) => {
        const physical = options.placement?.toLocal(path) ?? path
        const reason = Reflect.get(options.fs, Symbol.for('abele.sync.unchanged-index-reason-v1'))
        const indexReason = typeof reason === 'function' ? reason.call(options.fs, path) : 'other'
        if (indexReason !== 'hit') return indexReason
        const inspectionReason = trustedProjectionInspectionReason(app, physical, prior)
        return inspectionReason === 'hit' ? true : inspectionReason
      },
      save: async (current, retired = []) => {
        fence.assertOwned()
        // Write only rows that changed. Rows are per path, so another connection's completed
        // inspections stay as they are.
        const changed = current.filter((entry) => {
          const known = persisted.get(entry.path)
          return !known || !sameInspectionEntry(known, entry)
        })
        await cache.save(changed, retired)
        for (const entry of changed) persisted.set(entry.path, entry)
        for (const path of retired) persisted.delete(path)
      },
    },
    ...options,
    retiredPaths: await retiredArtifactPaths(app, options.factory, () => fence.assertOwned()),
    state,
    emptyView: { ledgerId, binding },
    ledger: options.ledger ?? store,
    configDir: app.vault.configDir,
    assertOwned: () => fence.assertOwned(),
    installProjection: async (path, bytes, operationId) => {
      if ((await store.getExternalState()) === null)
        throw new ExternalRecoveryRequired('projection has no activated durable state')
      const state = await ExternalState.open(store, ledgerId, binding)
      const document = await state.snapshot(),
        operation = document.operations.find((op) => op.operationId === operationId)
      fence.assertOwned()
      const artifact = operation?.ownedArtifacts.find((artifact) => artifact.role === 'projection')
      if (!operation || !artifact || operation.targetPath !== path)
        throw new ExternalRecoveryRequired('projection installation intent missing')
      // Retire/replace neither changed nor unchanged sidecars without a safe cleanup port.
      // A moved job also keeps its old sidecar, source reference and original bytes intact.
      if (await options.fs.stat(path)) return 'cleanup-pending'
      const host = placedExternalHost(
        new ExternalFileHost(app, {
          platform: nativeChunkPort(vaultDisk(app.vault)).available ? 'desktop' : 'mobile',
          assertOwned: () => fence.assertOwned(),
          effect: (work) => fence.effect(work),
          reconciled: (path) => options.reconciled?.(path),
        }),
        options.placement
      )
      try {
        return await host.run(
          { run: (work) => work() },
          {
            operationId,
            fileId: operation.expected.fileId,
            paths: [
              ...new Set([
                path,
                artifact.path,
                ...(operation.sourcePath ? [operation.sourcePath] : []),
                operation.expected.path,
              ]),
            ],
            assertIntent: (_phase, paths, incoming) => {
              fence.assertOwned()
              if (
                document.binding.generation !== binding.generation ||
                !['projection-intent', 'held', 'cleanup-pending'].includes(operation.phase) ||
                paths.some((path) => ![operation.targetPath, artifact.path].includes(path)) ||
                (incoming && JSON.stringify(incoming) !== JSON.stringify(artifact))
              )
                throw new ExternalRecoveryRequired('projection phase or artifact ownership changed')
            },
          },
          async (effects) => {
            // An existing incoming artifact may follow a lost acknowledgement. Matching bytes
            // alone never authorize another installation: retain it and hold the recorded job.
            if (await host.exists(artifact.path)) return 'cleanup-pending'
            const staged = await effects.stage(artifact, bytes)
            if (staged.status !== 'staged')
              throw new ExternalRecoveryRequired('projection staging outcome unknown')
            const result = await effects.install(artifact, path)
            if (result.status !== 'installed')
              throw new ExternalRecoveryRequired('projection installation outcome unknown')
            return 'written'
          }
        )
      } finally {
        host.close()
      }
    },
  })
}
