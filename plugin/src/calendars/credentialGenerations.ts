import { keychainId } from '@/secrets/keychainId'
import type { Keychain } from '@/secrets/SecretStore'

/** A link/source checksum; never store a credential checksum in the calendar cache. */
export function sourceHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** Only the counter leaves the keychain. Detects edits made while the plugin was not running. */
export class CredentialGenerations {
  constructor(private readonly keychain: Keychain) {}

  get(id: string, value: string): number {
    if (!id) return 0
    const key = keychainId('abele-calendar-generation', id)
    let previous: { checksum?: string; generation?: number } = {}
    try {
      previous = JSON.parse(this.keychain.getSecret(key) ?? '{}') ?? {}
    } catch {
      /* repair malformed local metadata */
    }
    // The verifier lives beside the credential, behind the same keychain access boundary.
    const checksum = sourceHash(value)
    const generation =
      Number.isSafeInteger(previous.generation) && previous.generation > 0 ? previous.generation : 0
    if (previous.checksum === checksum && generation) return generation
    const next = generation + 1
    this.keychain.setSecret(key, JSON.stringify({ checksum, generation: next }))
    return next
  }
}
