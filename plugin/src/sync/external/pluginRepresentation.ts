import type { App } from 'obsidian'
import type { FileSystem, StateStore, ScopedState } from '@abele/sync-core'
import { ExternalState } from './state'
import { ExternalRepresentation, type RepresentationOptions } from './representation'
import { ExternalFileHost } from './ObsidianExternalFileHost'
import { ExternalRecoveryRequired, type RuntimeFence } from './recovery'
import type { ConnectionBinding } from './records'
import { IndexedDbStateStore } from '../IndexedDbStateStore'

/** Called only after the startup fence/journal inspection, before engine activation.
 * During receive/recovery this callback runs inside the owning sync job; it does not enqueue
 * or await public sync() recursively. No production caller initiates eviction/hydration. */
export async function pluginRepresentation(options: {
  app: App
  store: IndexedDbStateStore
  ledger?: StateStore
  scoped?: ScopedState
  ledgerId: string
  binding: ConnectionBinding
  fence: RuntimeFence
  fs: FileSystem
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
  return ExternalRepresentation.open({
    ...options,
    state,
    emptyView: { ledgerId, binding },
    ledger: options.ledger ?? store,
    configDir: app.vault.configDir,
    assertOwned: () => fence.assertOwned(),
    installProjection: async (path, bytes, operationId) => {
      if (!state) throw new ExternalRecoveryRequired('projection has no activated durable state')
      const document = await state.snapshot(),
        operation = document.operations.find((op) => op.operationId === operationId)
      fence.assertOwned()
      const artifact = operation?.ownedArtifacts.find((artifact) => artifact.role === 'projection')
      if (!operation || !artifact || operation.targetPath !== path)
        throw new ExternalRecoveryRequired('projection installation intent missing')
      // Retire/replace neither changed nor unchanged sidecars without a safe cleanup port.
      // A moved job also keeps its old sidecar, source reference and original bytes intact.
      if (await app.vault.adapter.exists(path)) return 'cleanup-pending'
      const host = new ExternalFileHost(app, {
        platform:
          typeof (app.vault.adapter as unknown as { fsPromises?: unknown }).fsPromises === 'object'
            ? 'desktop'
            : 'mobile',
        assertOwned: () => fence.assertOwned(),
        effect: (work) => fence.effect(work),
        reconciled: options.reconciled,
      })
      try {
        return await host.run(
          { run: (work) => work() },
          {
            operationId,
            fileId: operation.expected!.fileId,
            paths: [
              ...new Set([
                path,
                artifact.path,
                ...(operation.sourcePath ? [operation.sourcePath] : []),
                operation.expected!.path,
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
            if (await app.vault.adapter.exists(artifact.path)) return 'cleanup-pending'
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
