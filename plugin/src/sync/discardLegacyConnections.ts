import type { LocalStorage } from './ledgerId'

export interface RetiredSecrets {
  get(reference: string): string
  remove(reference: string): void
}
const cleanupKey = 'abele-sync-retired-access-cleanup-v1'
const legacyKeys = [
  'abele-sync-connections-v1',
  'abele-sync-connections-v1-recovery',
  'abele-sync-connection',
  'abele-sync-ledger',
  'abele-sync-ledger-proof',
  'abele-sync-ledger-bootstrap',
  'abele-sync-ledger-cleanup',
  'abele-sync-writes',
  'abele-sync-recovered-writes',
  'abele-sync-restore-keys',
  'abele-sync-scoped-connection',
  'abele-sync-scoped-join',
  'abele-scoped-paused',
  'abele-scoped-access-removed',
  'abele-scoped-display-name',
  'scoped-creation-journal-v1',
  'abele-sync-external-activation-v1',
  'abele-sync-external-connection-switch-v1',
  'abele-sync-external-generation-v1',
  'abele-sync-external-retired-v1',
  'abele-sync-external-inspection-v1',
  'abele-owner-publication',
  'abele-owner-publication-stores-v1',
  'owner-publication-audiences-v1',
]
const ownedKey = (key: string) =>
  legacyKeys.includes(key) ||
  /^abele-owner-publication:[a-f0-9]{64}$/.test(key) ||
  key.startsWith('abele-sync-runtime-owner-v1:')
export const isLegacyAccessSlot = ownedKey
const retiredReference = (id: string) =>
  !id.startsWith('abele-sync-device-token-') &&
  /^(?:abele-sync-device-[a-z0-9-]+|abele-scoped-(?:invitation|installation|invite|install)-[a-z0-9-]+)$/.test(
    id
  )

/** Retire only known access metadata/credential namespaces. No files or databases are touched. */
export function discardLegacyConnections(local: LocalStorage, secrets: RetiredSecrets): void {
  const references = new Set<string>(),
    keys = new Set(legacyKeys)
  const existing = local.loadLocalStorage(cleanupKey)
  if (existing != null) {
    if (
      !Array.isArray(existing) ||
      existing.some((id) => typeof id !== 'string' || !retiredReference(id))
    )
      throw new Error('Retired credential cleanup requires recovery')
    for (const id of existing as string[]) references.add(id)
  }
  const collect = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const entry of value) collect(entry)
      return
    }
    for (const [key, entry] of Object.entries(value)) {
      if (ownedKey(key)) keys.add(key)
      if (key === 'key' && typeof entry === 'string' && ownedKey(entry)) keys.add(entry)
      if (
        ['tokenId', 'deviceTokenId', 'invitationId'].includes(key) &&
        typeof entry === 'string' &&
        retiredReference(entry)
      ) {
        references.add(entry)
        if (entry.startsWith('abele-sync-device-')) references.add(entry + '-server')
        else {
          for (const suffix of ['binding', 'accepted']) {
            references.add(entry + '-' + suffix)
            const uuid = /^abele-scoped-(invitation|installation)-([a-f0-9-]{36})$/.exec(entry)
            if (uuid)
              references.add(
                `abele-scoped-${uuid[1] === 'invitation' ? 'invite' : 'install'}-${uuid[2].replaceAll('-', '')}-${suffix}`
              )
          }
        }
      }
      collect(entry)
    }
  }
  for (const key of legacyKeys) collect(local.loadLocalStorage(key))
  const write = (key: string, value: unknown) => {
    local.saveLocalStorage(key, value)
    if (JSON.stringify(local.loadLocalStorage(key)) !== JSON.stringify(value))
      throw new Error('Retired access cleanup was not stored')
  }
  // Only references are retained until deletion completes; no old state becomes active.
  write(cleanupKey, [...references])
  for (const key of keys) if (local.loadLocalStorage(key) != null) write(key, null)
  for (const reference of references) {
    let value: string
    try {
      value = secrets.get(reference)
    } catch (error) {
      if (reference.length > 64) continue
      throw error
    }
    if (!value) continue
    secrets.remove(reference)
    if (secrets.get(reference)) throw new Error('Retired credential was not removed')
  }
  write(cleanupKey, null)
}
