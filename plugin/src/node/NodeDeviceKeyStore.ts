import type { DeviceKeyStore, PairedDevice, PairedWssConnector } from '@abele/node-client'
import {
  generateIdentity,
  fingerprint,
  ClaimSchema,
  InviteSchema,
  assertPairedEndpoint,
  type PairingInvite,
} from '@abele/channel-protocol'

type PairingClaim = Awaited<ReturnType<PairedWssConnector['claim']>>
export interface EnrollingDevice extends PairedDevice {
  enrollment?: { invite: PairingInvite; label: string; claim?: PairingClaim }
}
export type EnrollmentConfirmation = Pick<
  PairingInvite,
  'node_id' | 'invite_id' | 'endpoint' | 'node_fingerprint'
> &
  Pick<PairingClaim, 'installation_id' | 'device_fingerprint'>
const sameBinding = (
  a: Pick<PairingInvite, 'node_id' | 'invite_id' | 'endpoint' | 'node_fingerprint'>,
  b: Pick<PairingInvite, 'node_id' | 'invite_id' | 'endpoint' | 'node_fingerprint'>
) =>
  a.node_id === b.node_id &&
  a.invite_id === b.invite_id &&
  a.endpoint === b.endpoint &&
  a.node_fingerprint === b.node_fingerprint
const sameInvitation = (a: PairingInvite, b: PairingInvite) =>
  sameBinding(a, b) && a.secret === b.secret && a.expires_at === b.expires_at

/** A registration or old installation ID is not evidence that this invitation was claimed. */
export function claimedEnrollment(
  device: EnrollingDevice | undefined
): EnrollmentConfirmation | undefined {
  const enrollment = device?.enrollment
  if (
    !device ||
    !enrollment?.claim ||
    device.node_id !== enrollment.invite.node_id ||
    device.endpoint !== enrollment.invite.endpoint ||
    device.node_fingerprint !== enrollment.invite.node_fingerprint ||
    device.installation_id !== enrollment.claim.installation_id
  )
    return undefined
  return {
    node_id: device.node_id,
    invite_id: enrollment.invite.invite_id,
    endpoint: enrollment.invite.endpoint,
    node_fingerprint: enrollment.invite.node_fingerprint,
    installation_id: enrollment.claim.installation_id,
    device_fingerprint: enrollment.claim.device_fingerprint,
  }
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
    return this.transaction(invite.node_id, async (stored) => {
      const current = stored as EnrollingDevice | undefined
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
        enrollment: {
          invite,
          label,
          ...(current?.enrollment && sameInvitation(current.enrollment.invite, invite)
            ? { claim: current.enrollment.claim }
            : {}),
        },
      }
      return { device, result: device }
    })
  }

  async recordClaim(raw: PairingInvite, rawClaim: PairingClaim): Promise<EnrollingDevice> {
    const invite = InviteSchema.parse(raw),
      claim = ClaimSchema.parse(rawClaim)
    return this.transaction(invite.node_id, async (stored) => {
      const current = stored as EnrollingDevice | undefined
      if (
        !current?.enrollment ||
        !sameInvitation(current.enrollment.invite, invite) ||
        current.endpoint !== invite.endpoint ||
        current.node_fingerprint !== invite.node_fingerprint ||
        current.installation_id !== claim.installation_id ||
        (await fingerprint(current.public_key)) !== claim.device_fingerprint
      )
        throw new Error('enrollment_changed')
      const device = { ...current, enrollment: { ...current.enrollment, claim } }
      return { device, result: device }
    })
  }

  /** Explicit owner-verified address migration; the pin, key and principal stay unchanged. */
  async authorizeEndpointChange(
    raw: PairingInvite,
    previousEndpoint: string,
    previousFingerprint: string
  ): Promise<void> {
    const invite = InviteSchema.parse(raw)
    assertPairedEndpoint(invite.endpoint)
    await this.transaction(invite.node_id, async (current) => {
      if (
        !current ||
        current.endpoint !== previousEndpoint ||
        current.node_fingerprint !== previousFingerprint ||
        invite.node_fingerprint !== previousFingerprint
      )
        throw new Error('node_identity_mismatch')
      return { device: { ...current, endpoint: invite.endpoint }, result: undefined }
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

  async finishEnrollment(nodeId: string, expected: EnrollmentConfirmation): Promise<boolean> {
    return this.transaction(nodeId, async (stored) => {
      if (!stored) throw new Error('pairing_required')
      const current = stored as EnrollingDevice
      const actual = claimedEnrollment(current)
      const bindingMatches =
        current.node_id === expected.node_id &&
        current.endpoint === expected.endpoint &&
        current.node_fingerprint === expected.node_fingerprint &&
        current.installation_id === expected.installation_id &&
        (await fingerprint(current.public_key)) === expected.device_fingerprint
      if (
        !bindingMatches ||
        (current.enrollment &&
          (!actual ||
            !sameBinding(actual, expected) ||
            actual.installation_id !== expected.installation_id ||
            actual.device_fingerprint !== expected.device_fingerprint))
      )
        return { device: current, result: false }
      const device = { ...current }
      delete device.enrollment
      return { device, result: true }
    })
  }

  close(): void {
    void this.database?.then((db) => db.close())
  }
}
