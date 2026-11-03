import { assertDiscardableSyncLedger } from '../sync/privateRemovalFileSystem'
import { preservePrivateArtifacts, finishRetainedWrites } from '../sync/privateRecovery'
import type { Plugin } from 'obsidian'
import { sha256 } from '@abele/sync-sdk/core'
import { TokenEngines } from '../sync/tokenEngines'
import type { TokenUi } from '../sync/tokenUi'
import { IndexedDbStateStore } from '../sync/IndexedDbStateStore'
import { openDeviceReviews } from '../sync/openDeviceReviews'
import {
  ITEM_REGISTRY_KEY,
  TOKEN_REGISTRY_KEY,
  type DeviceTokenSecrets,
} from '../sync/tokenConnectionRegistry'
import { durableHostOf, flushHostStorage } from '../sync/hostSyncStorage'
import { SETS_KEY } from '../sync/connectionSets'
import { resetTokenPool, type TokenPoolResetRequest } from './resetTokenPool'
import { tokenPoolMarkers } from './tokenPoolMarkers'
import {
  inspectExistingLedger,
  recoverOrphanPrivateArtifacts,
  requireExternalEnrollmentSafety,
  requireExternalLifecycleSafety,
} from '../sync/external/pluginSafety'
import { decodeExternalDocument, EXTERNAL_STATE_KEY } from '../sync/external/state'
import { stagingDirectory } from '../sync/stagingDirectory'
import { tokenOffloadsOf } from '../sync/tokenOffloadCoordinator'
import { pathCoordinatorOf } from '../sync/pathCoordinator'
import { ExternalRecoveryRequired } from '../sync/external/recovery'

const JOURNAL = 'abele-sync-test-pool-ledgers-v1'
const REVIEW_ID = 'abele-sync-device-review-id-v1'
const resetting = new WeakMap<Plugin, Promise<void>>()
type HostInputs = {
  ui: TokenUi
  key: ConstructorParameters<typeof TokenEngines>[2]
  deps: ConstructorParameters<typeof TokenEngines>[3]
  scriptsFolder: string
  ownSettings: ConstructorParameters<typeof TokenEngines>[5]
}
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const copies = /^abele-local-edit-copies-[\da-f-]{36}-[\da-f]{64}$/i

/** Test-build-only ownership journal; never discovers or deletes other vaults' databases. */
export async function captureSyncTokenOwnership(plugin: Plugin, vault: string): Promise<string[]> {
  if (!vault || plugin.app.vault.getName() !== vault)
    throw new Error('Exact leased pool vault required')
  const host = (plugin as unknown as { tokenEngines?: HostInputs }).tokenEngines
  if (!host) throw new Error('Token host is not ready')
  const prior: unknown = plugin.app.loadLocalStorage(JOURNAL)
  if (
    prior != null &&
    (!Array.isArray(prior) ||
      prior.some((one) => typeof one !== 'string' || !(uuid.test(one) || copies.test(one))))
  )
    throw new Error('Pool ledger journal requires recovery')
  const records = host.ui.registry.records()
  const editDatabases = await Promise.all(
    records.map(
      async (record) =>
        'abele-local-edit-copies-' +
        record.id +
        '-' +
        (await sha256(
          new TextEncoder().encode(
            JSON.stringify([record.address, record.spaceId, record.tokenId, record.ledgerId])
          )
        ))
    )
  )
  const ids = [
    ...new Set([
      ...((prior ?? []) as string[]),
      ...records.flatMap((one) => [one.ledgerId, ...(one.pending ? [one.pending.ledgerId] : [])]),
      ...editDatabases,
    ]),
  ]
  if (ids.some((one) => !(uuid.test(one) || copies.test(one))))
    throw new Error('Pool ledger identity requires recovery')
  plugin.app.saveLocalStorage(JOURNAL, ids)
  if (JSON.stringify(plugin.app.loadLocalStorage(JOURNAL)) !== JSON.stringify(ids))
    throw new Error('Pool ledger ownership was not saved')
  return ids
}

/** Only journal-owned private work files and owned token state are reset. */
export async function resetSyncTokenState(
  plugin: Plugin,
  request: TokenPoolResetRequest
): Promise<void> {
  if (
    !request.vault ||
    request.vault !== plugin.app.vault.getName() ||
    request.confirm !== 'reset-sync-token-state'
  )
    throw new Error('Exact leased pool vault and reset-sync-token-state confirmation required')
  const prior = resetting.get(plugin)
  if (prior !== undefined) return prior
  const pending = performResetSyncTokenState(plugin, request).finally(() => {
    if (resetting.get(plugin) === pending) resetting.delete(plugin)
  })
  resetting.set(plugin, pending)
  return pending
}

async function performResetSyncTokenState(
  plugin: Plugin,
  request: TokenPoolResetRequest
): Promise<void> {
  const stage = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    Reflect.set(plugin, 'tokenPoolResetStage', name)
    console.debug('[abele-sync test reset]', name, 'started')
    try {
      const result = await work()
      console.debug('[abele-sync test reset]', name, 'complete')
      return result
    } catch (error) {
      console.debug('[abele-sync test reset]', name, 'failed', error)
      throw new Error(
        'Pool reset failed at ' +
          name +
          ': ' +
          (error instanceof Error ? error.message : String(error)),
        { cause: error }
      )
    }
  }
  const owner = plugin as unknown as { tokenEngines: TokenEngines }
  const old = owner.tokenEngines
  if (!old) throw new Error('Token host is not ready')
  const inputs = old as unknown as HostInputs
  const ui = inputs.ui
  let clearMarkers: () => void
  let ownedDatabases: string[] = []
  const reviewsId: unknown = plugin.app.loadLocalStorage(REVIEW_ID)
  if (typeof reviewsId !== 'string' || !uuid.test(reviewsId))
    throw new Error('Device review identity requires recovery')
  const restartHost = async () => {
    const reviews = await openDeviceReviews(window.indexedDB, reviewsId, {
      configRoots: [plugin.app.vault.configDir],
      scriptsFolder: inputs.scriptsFolder,
    })
    ;(ui as unknown as { reviews: typeof reviews }).reviews = reviews
    plugin.register(() => reviews.close())
    await ui.refreshReviews()
    owner.tokenEngines = new TokenEngines(
      plugin.app,
      ui,
      inputs.key,
      inputs.deps,
      inputs.scriptsFolder,
      inputs.ownSettings
    )
    owner.tokenEngines.start()
  }
  await resetTokenPool(
    {
      vault: plugin.app.vault.getName(),
      databases: async () => {
        const owned = await captureSyncTokenOwnership(plugin, request.vault)
        ownedDatabases = owned
        return [...owned, 'abele-sync-reviews-' + reviewsId]
      },
      stop: async () => {
        Reflect.set(plugin, 'tokenPoolResetStage', 'cancelling startup')
        old.cancelStartup()
        await stage('draining token host', () => old.close(false))
        const reviews = ui.reviews
        // Readiness/snapshot callers may still ask the visible UI for reviews.
        // Detach first, join queued readers, then close the old database handle.
        ;(ui as { reviews?: typeof reviews }).reviews = undefined
        await ui.refreshReviews()
        reviews?.close()
        // Draining startup may finish activation; snapshot its ownership only now.
        clearMarkers = tokenPoolMarkers(plugin.app, ownedDatabases)
        // Native publication retains the incoming inode. Drain writers, then move
        // private artifacts into recovery before deleting the ledgers. Ownership alone
        // never proves these bytes disposable; independent writers may have edited them.
        const paths = new Set<string>()
        const directory = stagingDirectory(plugin.app.vault.configDir) + '/'
        for (const name of ownedDatabases) {
          const found = await stage('checking ledger ' + name, () =>
            inspectExistingLedger(window.indexedDB, name)
          )
          if (found) assertDiscardableSyncLedger(found.metadata)
          const raw = found?.metadata.get('plugin:' + EXTERNAL_STATE_KEY)
          if (raw == null) continue
          if (typeof raw !== 'string') throw new Error('Pool external journal requires recovery')
          const document = decodeExternalDocument(raw)
          for (const artifact of [
            ...document.files.flatMap((file) => file.retained),
            ...document.operations.flatMap((operation) => operation.ownedArtifacts),
          ]) {
            if (
              artifact.path.startsWith(directory) &&
              !artifact.path.split('/').some((part) => part === '..' || part === '.')
            )
              paths.add(artifact.path)
          }
        }
        await stage('preserving private artifacts', () =>
          preservePrivateArtifacts(plugin.app, paths)
        )
        try {
          await stage('finishing retained copies', () => finishRetainedWrites(plugin.app))
        } catch (error) {
          await restartHost()
          throw error
        }
      },
      removeDatabase: (name) =>
        stage('deleting database ' + name, () =>
          IndexedDbStateStore.delete(window.indexedDB, name)
        ),
      forget: async () => {
        clearMarkers()
        await flushHostStorage(plugin.app)
        const secrets = (
          ui as unknown as { secrets: DeviceTokenSecrets & { remove(reference: string): void } }
        ).secrets
        for (const record of ui.registry.records()) ui.registry.beginForget(record.id)
        await stage('forgetting credentials and connections', () =>
          ui.registry.finishForgottenDurably(secrets)
        )
        for (const connection of ui.itemSets.store.all()) ui.itemSets.store.forget(connection.id)
        await ui.registry.flush()
        // IDB owns these rows; the raw localStorage copy is compatibility state only.
        // Publish it after durable retirement, never as a substitute for that commit.
        const host = durableHostOf(plugin.app)
        if (host)
          for (const key of [TOKEN_REGISTRY_KEY, ITEM_REGISTRY_KEY, SETS_KEY]) {
            const value = await host.readValue(key)
            plugin.app.saveLocalStorage(key, value)
            if (JSON.stringify(plugin.app.loadLocalStorage(key)) !== JSON.stringify(value))
              throw new Error('Pool connection cleanup was not stored')
          }
        await stage('recovering orphan private artifacts', () =>
          recoverOrphanPrivateArtifacts(plugin.app, window.indexedDB)
        )
        ui.runtimes.clear()
        ui.activity.value = {}
        ui.available.value = false
        ui.refresh()
        // Providers are drained; no stale absent-file marker may survive a new test case.
        tokenOffloadsOf(plugin.app.vault, pathCoordinatorOf(plugin.app.vault)).clearDrainedState()
      },
      restart: async () => {
        // An empty registry is not proof that enrollment can proceed: an older
        // reset may have lost ownership while retaining an activation marker.
        // Keep the journal on failure, and never erase unowned recovery evidence.
        try {
          Reflect.set(plugin, 'tokenPoolResetStage', 'checking enrollment safety')
          await requireExternalEnrollmentSafety(plugin.app)
          Reflect.set(plugin, 'tokenPoolResetStage', 'checking lifecycle safety')
          await requireExternalLifecycleSafety(
            plugin.app,
            window.indexedDB,
            undefined,
            true,
            undefined,
            () => {},
            {},
            false,
            true
          )
        } catch (error) {
          // A failed proof must leave a live host that can explain the recovery
          // requirement, not callbacks bound forever to the closed old host.
          await restartHost()
          const record =
            error instanceof ExternalRecoveryRequired ? error.recoveryRecord : undefined
          const locator = record
            ? ` (${record.kind}: ${record.id}; ${record.kind.includes('activation') ? 'database' : 'path'}: ${record.path})`
            : ''
          throw new Error(
            'Pool reset is not connectable' +
              locator +
              ': ' +
              (error instanceof Error ? error.message : 'Recovery check failed'),
            { cause: error }
          )
        }
        await restartHost()
        plugin.app.saveLocalStorage(JOURNAL, null)
        Reflect.set(plugin, 'tokenPoolResetStage', 'complete')
      },
    },
    request
  )
}
