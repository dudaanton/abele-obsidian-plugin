/**
 * What deleting one connection's files from the server would take: its whole scope (vault,
 * folder or group) goes to the server's trash, its key and every key inside it are revoked,
 * this device disconnects and keeps its files.
 */
import { shallowRef } from 'vue'

export interface ServerDeleteFacts {
  files: number
  bytes: number
  /** Keys this one and those scoped inside it; deleting revokes them all. */
  access: { label: string; scope: string }[]
  /** A key that can only read cannot delete; the action is shown, not offered. */
  canWrite: boolean
  unavailableReason?: string
}

export interface ServerDeleteSource {
  facts: (connectionId: string) => ServerDeleteFacts | null
  remove: (connectionId: string) => Promise<void>
}

/** Optional design stand override; production uses the current connection's runtime. */
export const serverDeleteSource = shallowRef<ServerDeleteSource | null>(null)

/** Why the action cannot be taken, or nothing when it can. */
export const READ_ONLY =
  'This key can only read. Only someone who can change these files can delete them.'

/** Bytes as a person reads a folder's size. */
export function folderSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
