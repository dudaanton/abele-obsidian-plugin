import type { App } from 'obsidian'
import { TokenConnectionRegistry } from './tokenConnectionRegistry'
import { discardLegacyConnections, type RetiredSecrets } from './discardLegacyConnections'
import { pendingTeardown } from './teardownBarrier'
import { prepareHostSyncStorage } from './hostSyncStorage'

/** Fresh token-only registry; retire legacy credentials without importing old state. */
export async function prepareTokenConnections(
  app: App,
  secrets: RetiredSecrets,
  loadedSync?: unknown,
  factory?: IDBFactory
): Promise<TokenConnectionRegistry> {
  await pendingTeardown(app)
  const host = factory ? await prepareHostSyncStorage(app, factory) : undefined
  try {
    const registry = TokenConnectionRegistry.open(app)
    discardLegacyConnections(app, secrets, loadedSync)
    await registry.flush()
    await registry.finishForgottenDurably(secrets)
    return registry
  } catch (error) {
    host?.close()
    throw error
  }
}
