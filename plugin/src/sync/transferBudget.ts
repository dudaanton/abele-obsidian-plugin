import { connectionHost } from './connectionPaths'
import { TransferBudget } from '@abele/sync-sdk/core'
const SLOT = Symbol.for('abele.sync.transfer-budget-v1')
const discovery = new WeakMap<TransferBudget, Set<object>>()
/** Connections sharing a vault transfer budget also share discovery priority. */
export function discoveryPriorityOf(budget: TransferBudget) {
  const owners = discovery.get(budget) ?? new Set<object>()
  discovery.set(budget, owners)
  let waitingSince: number | undefined
  const mayScan = () => {
    if (!owners.size) {
      waitingSince = undefined
      return true
    }
    waitingSince ??= performance.now()
    return performance.now() - waitingSince >= 5000
  }
  return {
    get available(): boolean {
      return owners.size === 0
    },
    get mayScan(): boolean {
      return mayScan()
    },
    /** One ordinary cold-file inspection per connection per five seconds keeps
     * discovery live under continuous transfers without restarting its workers. */
    claimRead(): boolean {
      if (!mayScan()) return false
      waitingSince = performance.now()
      return true
    },
    set(owner: object, active: boolean): void {
      if (active) owners.add(owner)
      else owners.delete(owner)
    },
  }
}
/** Connections, explicit hydration and forwarding share the vault's transfer slots. */
export function transferBudgetOf(vault: object): TransferBudget {
  const host = connectionHost(vault) as { [SLOT]?: TransferBudget }
  return (host[SLOT] ??= new TransferBudget({ maxChunkBytes: 1024 * 1024, maxActiveTransfers: 2 }))
}
