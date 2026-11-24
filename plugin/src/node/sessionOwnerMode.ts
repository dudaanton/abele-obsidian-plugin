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

export async function sessionOwnerMode(
  node: string,
  session: string
): Promise<PermissionMode | undefined> {
  const mode: unknown = await new DeviceIntentStore(GlobalStore.getInstance().app).read(
    key(node, session)
  )
  return mode === 'confirm-all' || mode === 'allow-edit' || mode === 'allow-all' ? mode : undefined
}
