/**
 * The sync connection, as a transfer carries it.
 *
 * A transfer used to carry the sending device's own token, which made the two devices one on
 * the server: a Disconnect on either now revokes that one device, and would have cut both off.
 * So the sending device asks the server for a device of the receiver's own
 * (`POST /v1/devices/self/siblings`) and sends that one's token instead — only when keys are
 * being sent, since a token is a key, and never retried, since a lost answer is a device nobody
 * holds the token of (the server records it as enrolled by the device that asked for it).
 *
 * What this device syncs travels beside it as a starting point for the other device, which may
 * change it there. The size cap never does: it is each device's own, and a desktop's "no cap"
 * handed to a phone is a phone filled up.
 *
 * The section is special-cased the way file sections are: its entry is built from the device's
 * connection rather than the settings, and nothing in `entries.ts` writes it — the receiving
 * screen hands it to the sync service.
 */
import type { SelectiveSettings } from '@abele/sync-core'
import { normalizeServerUrl } from '@abele/sync-protocol'
import { objectOf, selectiveFrom, type DeviceConnection } from '@/sync/connection'
import type { TransferEntry } from './types'

export const CONNECTION_SECTION = 'connection' as const

export const CONNECTION_LABEL = 'Sync connection'

/**
 * The name the other device's token travels under in `payload.secrets`. A name in the payload
 * and nowhere else: the receiver files the token under an id it mints itself, and
 * `storeReceivedKeys` never takes it.
 */
export const CONNECTION_TOKEN = 'sync-connection-token'

/** What of the selective settings travels: everything but the size cap. */
export type SharedSelective = Omit<SelectiveSettings, 'maxFileBytes'>

/** Where the receiving device is to sync, as the device made for it. */
export interface TransferredConnection {
  serverUrl: string
  vaultId: string
  vaultName: string
  deviceId: string
  deviceName: string
}

/** The device the sending side had the server make, and its token. */
export interface Sibling extends TransferredConnection {
  token: string
}

/** What a receiver takes out of a connection entry. */
export interface Received {
  /** Null when no device was made for this side: the sender's keys stayed behind, or it was offline. */
  connection: TransferredConnection | null
  token: string
  selective: SharedSelective
}

const withoutCap = (selective: SelectiveSettings): SharedSelective => {
  const { maxFileBytes: _cap, ...shared } = selective
  return shared
}

/**
 * The entry a connected device offers: where it syncs and what it takes. The device of the
 * other side's own is added at the moment the codes are made (`withSibling`), not before — the
 * screen packs a payload on every tick to count the codes, and each one would enrol a device.
 */
export function connectionEntry(connection: DeviceConnection): TransferEntry | null {
  if (connection.serverUrl === '' || connection.vaultId === '') return null
  return {
    section: CONNECTION_SECTION,
    id: CONNECTION_SECTION,
    label: CONNECTION_LABEL,
    data: {
      serverUrl: connection.serverUrl,
      vaultId: connection.vaultId,
      vaultName: connection.vaultName,
      selective: withoutCap(connection.selective),
    },
    secretIds: [CONNECTION_TOKEN],
  }
}

/** The entry with the device made for the other side, and the secrets that go with it. */
export function withSibling(
  entry: TransferEntry,
  sibling: Sibling
): { entry: TransferEntry; secrets: Record<string, string> } {
  const { token, ...connection } = sibling
  return {
    entry: { ...entry, data: { ...(entry.data as object), ...connection } },
    secrets: { [CONNECTION_TOKEN]: token },
  }
}

/** The entry with no connection in it: what this device syncs, and nothing to sign in with. */
export function withoutConnection(entry: TransferEntry): TransferEntry {
  const data = objectOf(entry.data) ?? {}
  return { ...entry, data: { selective: data.selective }, secretIds: [] }
}

/**
 * What a receiver takes out of an entry, read the way a record from anywhere is: a connection
 * only when every field of it and its token arrived, and the selective settings filled out from
 * the defaults with no cap at all.
 */
export function readTransferred(entry: TransferEntry, secrets: Record<string, string>): Received {
  const data = objectOf(entry.data) ?? {}
  const text = (field: string): string => (typeof data[field] === 'string' ? data[field] : '')
  const token = secrets[CONNECTION_TOKEN] ?? ''
  const connection: TransferredConnection = {
    serverUrl: text('serverUrl'),
    vaultId: text('vaultId'),
    vaultName: text('vaultName'),
    deviceId: text('deviceId'),
    deviceName: text('deviceName'),
  }
  const whole =
    connection.serverUrl !== '' &&
    connection.vaultId !== '' &&
    connection.deviceId !== '' &&
    typeof token === 'string' &&
    token !== ''
  return {
    connection: whole ? connection : null,
    token: whole ? token : '',
    selective: withoutCap(selectiveFrom(data.selective)),
  }
}

/**
 * How what arrived stands to what this device already syncs:
 * - `none`: this device syncs nothing, and takes it;
 * - `same`: it already syncs that very vault, as a device of its own; the arrival is not needed;
 * - `other`: it syncs another vault, or on another server, and taking this one replaces that.
 */
export function matchConnection(
  own: DeviceConnection,
  arrived: TransferredConnection
): 'none' | 'same' | 'other' {
  if (own.serverUrl === '' && own.vaultId === '') return 'none'
  const here = normalizeServerUrl(own.serverUrl) ?? own.serverUrl
  const there = normalizeServerUrl(arrived.serverUrl) ?? arrived.serverUrl
  return here === there && own.vaultId === arrived.vaultId ? 'same' : 'other'
}
