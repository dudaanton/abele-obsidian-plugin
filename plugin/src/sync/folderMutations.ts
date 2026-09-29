import { TFolder, type Vault } from 'obsidian'

/**
 * Obsidian deletes a folder as one promise but can publish its child events along the way.
 * A scan halfway through that operation would send a small prefix below the bulk-delete
 * guard's threshold. Wait for the operation, not for a guessed debounce duration.
 *
 * Shared by filesystems on the same vault: finishing a join can replace the engine while
 * an operation is still running. Only the thin Obsidian adapter knows this lifecycle.
 */
class FolderMutations {
  private readonly pending = new Set<Promise<void>>()
  private users = 0
  /** Changes when an operation starts, including one that finishes before a scan ends. */
  revision = 0
  private restore: (() => void) | null = null

  constructor(private readonly vault: Vault) {}

  watch(): () => void {
    if (this.users++ === 0) {
      const restores: (() => void)[] = []
      for (const method of ['delete', 'trash'] as const) {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- invoked with apply and restored by identity
        const original = this.vault[method]
        const begin = (): (() => void) => this.begin()
        const wrapped: typeof original = function (
          this: Vault,
          ...args: Parameters<typeof original>
        ) {
          if (!(args[0] instanceof TFolder)) return original.apply(this, args)
          // Enter before calling the original: even synchronous child events see the barrier.
          const finish = begin()
          return (async () => {
            try {
              return await original.apply(this, args)
            } finally {
              finish()
            }
          })()
        }
        this.vault[method] = wrapped
        restores.push(() => {
          if (this.vault[method] === wrapped) this.vault[method] = original
        })
      }
      this.restore = () => restores.forEach((restore) => restore())
    }
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      if (--this.users === 0) {
        this.restore?.()
        this.restore = null
      }
    }
  }

  private begin(): () => void {
    this.revision++
    let resolve!: () => void
    const pending = new Promise<void>((finish) => {
      resolve = finish
    })
    this.pending.add(pending)
    return () => {
      this.pending.delete(pending)
      resolve()
    }
  }

  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.all(this.pending)
  }
}

const byVault = new WeakMap<Vault, FolderMutations>()

export function folderMutations(vault: Vault): FolderMutations {
  let mutations = byVault.get(vault)
  if (mutations === undefined) {
    mutations = new FolderMutations(vault)
    byVault.set(vault, mutations)
  }
  return mutations
}
