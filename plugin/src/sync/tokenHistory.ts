import { shallowRef } from 'vue'
import { tokenUi } from './tokenUi'
/** Shared selection for native history/trash; its identity remains local to this device. */
export const historyConnection = shallowRef<string | null>(null)
export function tokenHistory() {
  const ui = tokenUi.value
  const id =
    historyConnection.value ??
    ui?.rows.value.find((one) => ui.runtimes.get(one.id)?.historyClient)?.id
  const runtime = id ? ui?.runtimes.get(id) : null
  return {
    client: () => runtime?.historyClient ?? null,
    entryFor: async (path: string) => runtime?.entryFor?.(path) ?? null,
    syncNow: async () => runtime?.sync(),
    note: (_text: string) => {},
    status: {
      value: {
        get state() {
          return id
            ? (ui?.rows.value.find((one) => one.id === id)?.status ?? 'error')
            : 'disconnected'
        },
      },
    },
    connection: { value: { vaultId: id ?? 'disconnected' } },
  }
}
