import { connectionHost } from './connectionPaths'
import { TransferBudget } from '@abele/sync-sdk/core'
const SLOT = Symbol.for('abele.sync.transfer-budget-v1')
/** Connections, explicit hydration and forwarding share the vault's transfer slots. */
export function transferBudgetOf(vault: object): TransferBudget {
  const host = connectionHost(vault) as { [SLOT]?: TransferBudget }
  return (host[SLOT] ??= new TransferBudget({ maxChunkBytes: 1024 * 1024, maxActiveTransfers: 2 }))
}
