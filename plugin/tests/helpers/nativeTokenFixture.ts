import { decodeAccessToken } from '@abele/sync-sdk/protocol'
import type { SyncServiceDeps } from '@/sync/environment'
import { vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { App } from 'obsidian'
import { MemoryStateStore } from '@abele/sync-sdk/core'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { TokenUi } from '@/sync/tokenUi'
import { TokenEngines } from '@/sync/tokenEngines'
import { TokenSettingsPort } from '@/sync/tokenSettingsPort'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import type { FakeApp } from './fakeVault'
const devices = new WeakMap<FakeApp, { keys: Map<string, string>; metadata: MemoryStateStore }>()

/** Real plugin host, registry, ledger, coordinator and UI ports over a synthetic local vault. */
export async function nativeTokenFixture(
  app: FakeApp,
  encoded: string,
  transport: typeof fetch,
  factory = new IDBFactory(),
  arrived: () => void = () => {},
  retryFirstFailure = false,
  deps: SyncServiceDeps & { waitForIdle?: boolean } = {}
) {
  let device = devices.get(app)
  if (!device) devices.set(app, (device = { keys: new Map(), metadata: new MemoryStateStore() }))
  const registry = TokenConnectionRegistry.open(app),
    { keys, metadata } = device
  const secrets = {
    get: (id: string) => keys.get(id) ?? null,
    set: (id: string, value: string) => {
      keys.set(id, value)
    },
    remove: (id: string) => {
      keys.delete(id)
    },
  }
  const reviews = {
    executables: new ExecutableReview(metadata),
    attachments: new AttachmentConsent(metadata),
    close: () => {},
  }
  const ui = new TokenUi(registry, secrets, transport, reviews)
  await ui.connect(encoded)
  const token = decodeAccessToken(encoded)
  const id = registry
    .records()
    .find(
      (one) =>
        one.address === token.address &&
        one.scope?.id === token.scope.id &&
        keys.get(one.secretReference) === token.key
    )!.id
  const host = new TokenEngines(
    app as unknown as App,
    ui,
    secrets.get,
    {
      fetch: transport,
      indexedDB: factory,
      fallbackMs: 60000,
      pollMs: 60000,
      WebSocket: class {
        constructor() {
          throw new Error('Fixture uses polling')
        }
      } as never,
      ...deps,
    },
    'Scripts',
    { path: `${app.vault.configDir}/plugins/abele/data.json`, arrived }
  )
  host.start()
  await ui.connectionsChanged()
  if (deps.waitForIdle !== false) {
    // Runtime activation starts exchange asynchronously. Join its completion rather
    // than treating a short polling allowance as a first-sync performance contract.
    try {
      await ui.sync(id)
    } catch (error) {
      if (!retryFirstFailure) throw error
      retryFirstFailure = false
      await ui.sync(id)
    }
    await vi.waitFor(async () => {
      if (
        retryFirstFailure &&
        registry.records().find((one) => one.id === id)!.status === 'error'
      ) {
        retryFirstFailure = false
        await ui.sync(id)
      }
      expectReady()
    })
  }
  function expectReady() {
    if (registry.records().find((one) => one.id === id)!.status !== 'idle')
      throw new Error('Waiting for first token sync')
  }
  const port = TokenSettingsPort.forConnection(ui, id, app as unknown as App)
  return {
    ui,
    host,
    registry,
    keys,
    id,
    port,
    status: port.status,
    heldPrompt: port.heldPrompt,
    settingsPrompt: port.settingsPrompt,
    log: port.log,
    syncNow: async () => {
      await ui.sync(id)
      await ui.refreshReviews()
    },
    pause: () => ui.pause(id, true),
    resume: () => ui.pause(id, false),
    applySettingsAndReload: (ids: readonly string[]) => port.applySettingsAndReload(ids),
    keepLocalSettings: (paths: string[] | undefined, ids: readonly string[]) =>
      port.keepLocalSettings(paths, ids),
    reloadAppliedSettings: () => port.reloadAppliedSettings(),
    stagedSettings: async () => [
      ...(await ui.runtimes.get(id)!.deferred!()),
      ...(await reviews.executables.pending()).map((one) => ({
        version_id: one.versionId,
        path: one.path,
      })),
    ],
    heldDeletes: () => ui.runtimes.get(id)!.heldDeletes!(),
    decideDeletes: (kind: 'confirm' | 'restore', ids: readonly string[]) =>
      port.decideDeletes(kind, ids),
    client: () => ui.runtimes.get(id)!.historyClient!,
    destroy: () => host.close(),
  }
}
