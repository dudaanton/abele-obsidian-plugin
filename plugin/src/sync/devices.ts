import type { VaultClient } from '@abele/sync-core'
import type { DeviceInfo } from '@abele/sync-protocol'

/**
 * The devices on this vault, as the Sync tab lists them (phase 3b, the ruling after the task-4
 * review, #2b): asked of the server with this device's own token, so no password is needed.
 */

/**
 * The live devices of this account on this vault, this one included, oldest first. Null with no
 * client — a device with no engine running has no server to ask.
 */
export async function listDevices(client: VaultClient | null): Promise<DeviceInfo[] | null> {
  if (client === null) return null
  return client.listVaultDevices()
}

/**
 * Revoke another device of this account on this vault: the server stops accepting its token at
 * once, and its files stay where they are. Never this device (`ownId`), which leaves by
 * Disconnect — that forgets its token too, where a revoke from the list would leave it holding
 * one nobody takes. A device already gone throws the server's `not_found`; the list is read again
 * either way.
 */
export async function revokeDevice(
  client: VaultClient | null,
  ownId: string,
  deviceId: string
): Promise<void> {
  if (deviceId === ownId) {
    throw new Error('this device leaves by Disconnect, not from the device list')
  }
  if (client === null) throw new Error('this device is not connected to a server')
  await client.revokeVaultDevice(deviceId)
}
