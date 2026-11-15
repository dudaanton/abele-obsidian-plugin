import type { App } from 'obsidian'
import { SHA256 } from '@noble/hashes/sha2.js'
import { durableHostOf } from '@/sync/hostSyncStorage'
import { storageOf } from '@/sync/vaultWrites'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'

/** Only the explicitly instrumented test build publishes these read-only ports. */
export function exposeScaleDiagnostics(): void {
  const scope = window as Window & {
    __scaleEntryLedgerRequired?: boolean
    __abeleScaleDiagnosticPorts?: unknown
  }
  if (scope.__scaleEntryLedgerRequired !== true) return
  scope.__abeleScaleDiagnosticPorts = {
    hostOf: (application: App) => {
      const storage = storageOf(application)
      return storage ? durableHostOf(storage) : undefined
    },
    fingerprintClasses: [BoundedVaultIo, ObsidianFileSystem],
    hashConstructors: [SHA256],
  }
}
