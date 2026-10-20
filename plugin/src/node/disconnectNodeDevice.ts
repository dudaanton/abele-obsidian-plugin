import { z } from 'zod'
import { deviceDisconnectSupported } from './acceptanceCapabilities'

/** Revoke before forgetting. A lost acknowledgement keeps the old credential for diagnosis. */
export async function disconnectNodeDevice(
  client: {
    describe: () => Promise<unknown>
    request: (method: string, params: unknown) => Promise<unknown>
  },
  confirm: (revokes: boolean) => Promise<boolean>,
  remove: () => void
): Promise<void> {
  const supported = deviceDisconnectSupported(await client.describe())
  if (!(await confirm(supported))) return
  if (supported) {
    console.debug('[Abele node] Revoking this device before disconnect')
    z.object({ disconnected: z.literal(true) }).parse(await client.request('node.disconnect', {}))
  }
  remove()
}
