import type { DeviceKeyStore, PairedDevice } from '@abele/node-client'
import {
  generateIdentity,
  InviteSchema,
  assertPairedEndpoint,
  type PairingInvite,
} from '@abele/channel-protocol'

export interface EnrollingDevice extends PairedDevice {
  enrollment?: { invite: PairingInvite; label: string }
}

export interface DeviceLocks {
  request<T>(name: string, work: () => Promise<T>): Promise<T>
}

/** Origin/device-local IndexedDB, never JSON settings, secret sync, or a vault file.
 * Web Locks serialize all windows; crypto runs outside short atomic IDB transactions.
 * Unsupported storage/locks fail closed rather than using a window-only mutex.
 */
export class NodeDeviceKeyStore implements DeviceKeyStore {
  private database?: Promise<IDBDatabase>
  constructor(
    private readonly namespace = 'device',
    private readonly factory: IDBFactory = indexedDB,
    private readonly locks: DeviceLocks | undefined = navigator.locks
  ) {}

  private open(): Promise<IDBDatabase> {
    return (this.database ??= new Promise((resolve, reject) => {
      const request = this.factory.open(`abele-node-keys-${this.namespace}`, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('keys')
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close()
        resolve(request.result)
      }
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Close other windows using node device keys'))
    }))
  }

  async load(nodeId: string): Promise<EnrollingDevice | undefined> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readonly')
      const request = tx.objectStore('keys').get(nodeId)
      tx.oncomplete = () => resolve(request.result as EnrollingDevice | undefined)
      tx.onabort = () => reject(tx.error)
    })
  }

  async transaction<T>(
    nodeId: string,
    work: (device: PairedDevice | undefined) => Promise<{ device: PairedDevice; result: T }>
  ): Promise<T> {
    if (!this.locks) throw new Error('Remote pairing requires Web Locks on this device')
    return this.locks.request(`abele-node-keys-${this.namespace}-${nodeId}`, async () => {
      const { device, result } = await work(await this.load(nodeId))
      if (
        device.node_id !== nodeId ||
        device.private_key.extractable ||
        device.private_key.type !== 'private' ||
        device.private_key.algorithm.name !== 'ECDSA'
      )
        throw new Error('Invalid non-extractable device key')
      const db = await this.open()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('keys', 'readwrite', { durability: 'strict' })
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error ?? new Error('Device key commit failed'))
        tx.objectStore('keys').put(device, nodeId)
      })
      return result
    })
  }

  async rememberInvitation(raw: PairingInvite, label: string): Promise<EnrollingDevice> {
    const invite = InviteSchema.parse(raw)
    assertPairedEndpoint(invite.endpoint)
    return this.transaction(invite.node_id, async (current) => {
      if (
        current &&
        (current.node_fingerprint !== invite.node_fingerprint ||
          current.endpoint !== invite.endpoint)
      )
        throw new Error('node_identity_mismatch')
      const device: EnrollingDevice = {
        ...(current ?? {
          ...(await generateIdentity()),
          node_id: invite.node_id,
          endpoint: invite.endpoint,
          node_fingerprint: invite.node_fingerprint,
        }),
        enrollment: { invite, label },
      }
      return { device, result: device }
    })
  }

  async pending(): Promise<EnrollingDevice[]> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readonly')
      const request = tx.objectStore('keys').getAll()
      tx.oncomplete = () =>
        resolve((request.result as EnrollingDevice[]).filter((d) => d.enrollment))
      tx.onabort = () => reject(tx.error)
    })
  }

  async finishEnrollment(nodeId: string): Promise<void> {
    await this.transaction(nodeId, async (current) => {
      if (!current) throw new Error('pairing_required')
      const device = { ...current } as EnrollingDevice
      delete device.enrollment
      return { device, result: undefined }
    })
  }

  close(): void {
    void this.database?.then((db) => db.close())
  }
}
