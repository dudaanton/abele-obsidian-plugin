import type { Plugin } from 'obsidian'
import { sha256 } from '@abele/sync-core'
import { TokenEngines } from '../sync/tokenEngines'
import type { TokenUi } from '../sync/tokenUi'
import { IndexedDbStateStore } from '../sync/IndexedDbStateStore'
import { openDeviceReviews } from '../sync/openDeviceReviews'
import type { DeviceTokenSecrets } from '../sync/tokenConnectionRegistry'
import { resetTokenPool, type TokenPoolResetRequest } from './resetTokenPool'
import { tokenPoolMarkers } from './tokenPoolMarkers'

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

/** No filesystem, settings-transfer, server revocation or unrelated secret operations. */
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
  const owner = plugin as unknown as { tokenEngines: TokenEngines }
  const old = owner.tokenEngines
  if (!old) throw new Error('Token host is not ready')
  const inputs = old as unknown as HostInputs
  const ui = inputs.ui
  let clearMarkers: () => void
  const reviewsId: unknown = plugin.app.loadLocalStorage(REVIEW_ID)
  if (typeof reviewsId !== 'string' || !uuid.test(reviewsId))
    throw new Error('Device review identity requires recovery')
  await resetTokenPool(
    {
      vault: plugin.app.vault.getName(),
      databases: async () => {
        const owned = await captureSyncTokenOwnership(plugin, request.vault)
        clearMarkers = tokenPoolMarkers(plugin.app, owned)
        return [...owned, 'abele-sync-reviews-' + reviewsId]
      },
      stop: async () => {
        await old.close()
        ui.reviews?.close()
      },
      removeDatabase: (name) => IndexedDbStateStore.delete(window.indexedDB, name),
      forget: async () => {
        clearMarkers()
        const secrets = (
          ui as unknown as { secrets: DeviceTokenSecrets & { remove(reference: string): void } }
        ).secrets
        for (const record of ui.registry.records()) ui.registry.beginForget(record.id)
        ui.registry.finishForgotten(secrets)
        plugin.app.saveLocalStorage(JOURNAL, null)
        ui.runtimes.clear()
        ui.activity.value = {}
        ui.available.value = false
        ui.refresh()
        // Providers are drained; no stale absent-file marker may survive a new test case.
        Reflect.deleteProperty(plugin.app.vault, Symbol.for('abele.sync.token-offloads-v1'))
      },
      restart: async () => {
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
      },
    },
    request
  )
}
