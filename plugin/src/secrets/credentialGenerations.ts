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

function generationKey(id: string): string {
  const legacy = keychainId('abele-calendar-generation', id)
  if (legacy.length <= 64) return legacy
  // FNV-1a 128 keeps long slot names bounded without changing existing short slots.
  let hash = 0x6c62272e07bb014262b821756295c58dn
  for (let i = 0; i < id.length; i++) {
    hash ^= BigInt(id.charCodeAt(i))
    hash = BigInt.asUintN(128, hash * 0x1000000000000000000013bn)
  }
  // A separate namespace cannot alias a literal short id containing the hash text.
  return keychainId('abele-calendar-clock', hash.toString(16).padStart(32, '0'))
}

/** Only the counter leaves the keychain. Detects edits made while the plugin was not running. */
export class CredentialGenerations {
  constructor(
    private readonly keychain: Keychain,
    private readonly seed = () => Math.floor(Math.random() * 2 ** 48)
  ) {}

  get(id: string, value: string): number {
    if (!id) return 0
    const key = generationKey(id)
    // An unavailable keychain is not malformed metadata; let the calendar use its local clock.
    const stored = this.keychain.getSecret(key)
    let previous: { checksum?: string; generation?: number } = {}
    try {
      previous = JSON.parse(stored ?? '{}') ?? {}
    } catch {
      /* repair malformed local metadata */
    }
    // The verifier lives beside the credential, behind the same keychain access boundary.
    const checksum = sourceHash(value)
    const generation =
      Number.isSafeInteger(previous.generation) && previous.generation > 0
        ? previous.generation
        : this.seed()
    if (previous.checksum === checksum && generation) return generation
    const next = generation + 1
    this.keychain.setSecret(key, JSON.stringify({ checksum, generation: next }))
    return next
  }
}
