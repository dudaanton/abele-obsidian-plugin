import { GlobalStore } from '@/stores/GlobalStore'

const KEY = 'abele-delegation-chat-owners-v1'
function owners(): Record<string, string> {
  const raw = GlobalStore.getInstance().app.loadLocalStorage(KEY)
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, string> : {}
}

/** Authority is device-local and bound to the originating file, not transferable metadata. */
export function ownsDelegationIdentity(id: string, path: string): boolean {
  return owners()[id] === path
}
export function claimDelegationIdentity(id: string, path: string): boolean {
  const current = owners()
  if (current[id] && current[id] !== path) return false
  current[id] = path
  GlobalStore.getInstance().app.saveLocalStorage(KEY, current)
  return true
}
export function renameDelegationIdentity(from: string, to: string): void {
  const current = owners()
  let changed = false
  for (const [id, path] of Object.entries(current)) {
    if (path === from) { current[id] = to; changed = true }
  }
  if (changed) GlobalStore.getInstance().app.saveLocalStorage(KEY, current)
}
