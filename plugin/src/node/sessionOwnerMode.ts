import { DeviceIntentStore } from '@/services/DeviceIntentStore'
import { GlobalStore } from '@/stores/GlobalStore'
import type { PermissionMode } from '@/ai/types'

const key = (node: string, session: string) =>
  'abele-node-session-owner-mode:' + JSON.stringify([node, session])

/** Device-local owner intent, never populated from session.state. */
export async function rememberSessionOwnerMode(
  node: string,
  session: string,
  mode: PermissionMode
): Promise<void> {
  await new DeviceIntentStore(GlobalStore.getInstance().app).write(key(node, session), mode)
}

export async function sessionOwnerMode(node: string, session: string): Promise<PermissionMode> {
  const mode: unknown = await new DeviceIntentStore(GlobalStore.getInstance().app).read(
    key(node, session)
  )
  // Absence cannot prove that a previous restrictive owner choice never existed.
  // A missing database or record must not enable an agent's permissive default.
  return mode === 'confirm-all' || mode === 'allow-edit' || mode === 'allow-all'
    ? mode
    : 'confirm-all'
}
