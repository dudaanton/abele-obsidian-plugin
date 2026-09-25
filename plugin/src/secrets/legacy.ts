/**
 * Credentials the settings once held as plain values, and their way into the keychain.
 *
 * Only one ever did: the Firefly III token, typed into Finance settings and saved into
 * `data.json` as it was. It now lives in the keychain under `FIREFLY_TOKEN_KEY_ID` — and so in
 * the synced store when that is on. A plain value still found in the settings (an old file,
 * or an old transfer) is moved at the next save and dropped from the file then; until it has
 * moved it is still read, so nothing stops working in between.
 */
import type { AbeleConfig } from '@/services/AbeleConfig'
import { secrets } from './SecretStore'

export const FIREFLY_TOKEN_KEY_ID = 'abele-firefly-token'

/** Set by the settings once loaded: the plain value while it has not moved yet. */
let plainFallback: () => string = () => ''

/** The token, from the keychain, or the plain one not yet moved. */
export function fireflyToken(): string {
  return secrets().get(FIREFLY_TOKEN_KEY_ID) || plainFallback()
}

export function setFireflyToken(value: string): void {
  secrets().set(FIREFLY_TOKEN_KEY_ID, value.trim())
}

/**
 * Moves plain credentials out of the settings into the keychain. Called on every save, before
 * the file is written. Returns whether anything moved. A keychain that refuses — no secure
 * storage on this device — leaves the value where it was rather than losing it.
 */
export function moveLegacySecrets(settings: AbeleConfig): boolean {
  notePlainSecrets(settings)
  if (!settings.fireflyToken) return false
  try {
    secrets().set(FIREFLY_TOKEN_KEY_ID, settings.fireflyToken.trim())
  } catch {
    return false
  }
  settings.fireflyToken = ''
  return true
}

/** The settings, just loaded: their plain token, if any, is what `fireflyToken` falls back to. */
export function notePlainSecrets(settings: AbeleConfig): void {
  plainFallback = () => settings.fireflyToken
}
