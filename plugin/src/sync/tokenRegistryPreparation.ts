import type { App } from 'obsidian'
import { TokenConnectionRegistry } from './tokenConnectionRegistry'
import { discardLegacyConnections, type RetiredSecrets } from './discardLegacyConnections'
import { pendingTeardown } from './teardownBarrier'

/** Fresh token-only registry; retire legacy credentials without importing old state. */
export async function prepareTokenConnections(
  app: App,
  secrets: RetiredSecrets,
  loadedSync?: unknown
): Promise<TokenConnectionRegistry> {
  await pendingTeardown(app)
  const registry = TokenConnectionRegistry.open(app)
  discardLegacyConnections(app, secrets, loadedSync)
  return registry
}
