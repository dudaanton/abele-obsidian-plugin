/** Keep missing active members in the result so readiness cannot pass prematurely. */
export function connectionRuntimes<T>(
  host: {
    live: ReadonlyMap<string, T>
    ui: {
      itemSets: {
        store: {
          get(id: string):
            | {
                items: { recordId?: string; paused: boolean; detached?: boolean }[]
              }
            | null
            | undefined
        }
      }
    }
  },
  id: string
): (T | undefined)[] {
  const items = host.ui.itemSets.store.get(id)?.items
  if (!items) return [host.live.get(id)]
  return items
    .filter((item) => !item.paused && !item.detached)
    .map((item) => (item.recordId ? host.live.get(item.recordId) : undefined))
}
