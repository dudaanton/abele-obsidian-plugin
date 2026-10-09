import type { LocalStorage } from './ledgerId'
import { TokenConnectionRegistry, TOKEN_REGISTRY_KEY } from './tokenConnectionRegistry'

export { TokenConnectionRegistry as ConnectionRegistry, TOKEN_REGISTRY_KEY as REGISTRY_KEY }
export type { TokenConnectionRecord as ConnectionRecord } from './tokenConnectionRegistry'
export type ConnectionStatus =
  | 'disconnected'
  | 'joining'
  | 'idle'
  | 'syncing'
  | 'paused'
  | 'offline'
  | 'error'
export const CONNECTION_STORAGE = Symbol.for('abele.sync.connection-storage')

/** Resolve the selected token view, unless this port is already bound to an ID. */
export function selectedConnectionStorage(local: LocalStorage): LocalStorage {
  if ((local as LocalStorage & { [CONNECTION_STORAGE]?: string })[CONNECTION_STORAGE]) return local
  if (local.loadLocalStorage(TOKEN_REGISTRY_KEY) == null) return local
  const registry = TokenConnectionRegistry.open(local)
  return registry.selectedId
    ? registry.storage(registry.selectedId)
    : {
        loadLocalStorage: () => null,
        saveLocalStorage: () => {
          throw new Error('No token connection selected')
        },
      }
}

/** Retired publication callers may not delete resources through the token registry. */
export function otherConnectionOwnsSlot(_local: LocalStorage, _key: string): boolean {
  throw new Error('Legacy publication access is retired')
}
