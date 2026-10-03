import type { App } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { SyncService } from '@/sync/SyncService'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { NativeOwnerPublication } from '@/sync/publication/nativeOwnerPublication'
import type { SyncServiceDeps } from '@/sync/environment'
import type { SnapshotBinding } from '@/sync/publication/LinkSnapshotStore'
const state = new WeakMap<
  App,
  { close: () => Promise<void>; runtime: () => NativeOwnerPublication | null }
>()
/** Disposable loopback + protected isolated context only. Not a setting/env activation bypass. */
export async function enableOwnerPublicationFixture(app: App, grants: string[]): Promise<boolean> {
  if (state.has(app)) throw new Error('Owner fixture already installed')
  const svc = SyncService.getInstance(),
    c = svc.connection.value,
    u = new URL(c.serverUrl),
    backup = app.loadLocalStorage('task14-isolated-fixture') as { root?: string } | null
  if (
    u.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(u.hostname) ||
    !backup ||
    backup.root !== 'Agents' ||
    !c.vaultId ||
    !c.deviceId ||
    !grants.length ||
    grants.length > 16
  )
    throw new Error('Owner publication activation is restricted to owned isolated loopback fixture')
  const id = crypto.randomUUID(),
    name = 'abele-owner-fixture-' + id,
    binding: SnapshotBinding = {
      localVault: id,
      issuer: c.serverUrl,
      vaultId: c.vaultId,
      principal: c.deviceId,
      facet: 'personal' as const,
      grantId: null,
    },
    meta = await IndexedDbStateStore.open(window.indexedDB, name, {
      identity: { key: 'owner-fixture-identity', value: JSON.stringify(binding) },
    })
  const internal = svc as unknown as {
    deps: SyncServiceDeps
    serialise<T>(fn: () => Promise<T>): Promise<T>
    runner: { teardown(): Promise<void>; reconcile(): Promise<void> }
  }
  const previous = internal.deps.ownerPublication
  let fresh = true,
    live: NativeOwnerPublication | null = null
  internal.deps.ownerPublication = async (context) => {
    if (
      context.connection.serverUrl !== binding.issuer ||
      context.connection.vaultId !== binding.vaultId ||
      context.connection.deviceId !== binding.principal
    )
      throw new Error('Owner fixture connection changed')
    const runtime = new NativeOwnerPublication({
      app,
      configurationRoots: () => [app.vault.configDir, AbeleConfig.getInstance().ai.scriptsFolder],
      meta,
      state: context.state,
      client: context.client,
      binding,
      token: () => context.token,
      grants: [...grants],
      fetch: context.fetch,
      enabled: () => true,
      held: context.held,
    })
    await runtime.start(fresh)
    fresh = false
    live = runtime
    return {
      hooks: runtime.hooks,
      beforeRemote: (paths) => runtime.beforeRemote(paths),
      close: () => {
        runtime.close()
        live = null
      },
    }
  }
  const close = async () => {
    internal.deps.ownerPublication = previous
    await internal.serialise(async () => {
      await internal.runner.teardown()
      await internal.runner.reconcile()
    })
    meta.close()
    await IndexedDbStateStore.delete(window.indexedDB, name)
    state.delete(app)
  }
  state.set(app, { close, runtime: () => live })
  try {
    await internal.serialise(async () => {
      await internal.runner.teardown()
      await internal.runner.reconcile()
    })
    return true
  } catch (e) {
    await close()
    throw e
  }
}
export async function disableOwnerPublicationFixture(app: App) {
  await state.get(app)?.close()
  return true
}
export function ownerPublicationDiagnostics(app: App) {
  return state.get(app)?.runtime()?.diagnostics() ?? null
}
