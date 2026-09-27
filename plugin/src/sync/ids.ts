import { DEVICE_SECRET_PREFIX } from '@/secrets/SecretStore'

/** The random names this plugin files things under: keychain ids and ledger names. */

/** A keychain id: lowercase letters, digits and dashes, which is all Obsidian accepts. */
export function newSecretId(): string {
  return `${DEVICE_SECRET_PREFIX}${randomStem()}`
}

/** The name this device's ledger is filed under. Local to this vault and shown to nobody. */
export function newStateId(): string {
  return `${randomStem()}${randomStem()}`
}

export function randomStem(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0')
}
