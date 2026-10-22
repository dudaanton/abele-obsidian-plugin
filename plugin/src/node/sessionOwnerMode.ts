import { GlobalStore } from '@/stores/GlobalStore'
import type { PermissionMode } from '@/ai/types'

const key = (node: string, session: string) =>
  'abele-node-session-owner-mode:' + JSON.stringify([node, session])

/** Device-local owner intent, never populated from session.state. */
export function rememberSessionOwnerMode(
  node: string,
  session: string,
  mode: PermissionMode
): void {
  GlobalStore.getInstance().app.saveLocalStorage(key(node, session), mode)
}

export function sessionOwnerMode(node: string, session: string): PermissionMode | undefined {
  const mode: unknown = GlobalStore.getInstance().app.loadLocalStorage(key(node, session))
  return mode === 'confirm-all' || mode === 'allow-edit' || mode === 'allow-all' ? mode : undefined
}
