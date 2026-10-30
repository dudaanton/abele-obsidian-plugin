/**
 * Credentials the settings once held as plain values, and their way into the keychain.
 *
 * The Firefly III token, typed into Finance settings and saved into
 * `data.json` as it was. It now lives in the keychain under `FIREFLY_TOKEN_KEY_ID` — and so in
 * the synced store when that is on. A plain value still found in the settings (an old file,
 * or an old transfer) is moved at the next save and dropped from the file then; until it has
 * moved it is still read, so nothing stops working in between.
 * Literal MCP credential headers follow the same path, with one fresh slot per header.
 */
import type { AbeleConfig } from '@/services/AbeleConfig'
import { secrets } from './SecretStore'
import { protectMcpHeaders } from '@/ai/mcp/headerSecrets'
import { httpOrigin, type Destination } from './DestinationPolicy'
import { acceptMigratedDestinations } from './destinationStorage'

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
  let moved = false
  if (settings.fireflyToken) {
    try {
      secrets().set(FIREFLY_TOKEN_KEY_ID, settings.fireflyToken.trim())
      settings.fireflyToken = ''
      moved = true
    } catch {
      // Keep the value until secure storage works again.
    }
  }
  for (const server of settings.ai?.mcpServers ?? []) {
    try {
      const destinations: Destination[] = []
      const origin = httpOrigin(server.url)
      const protectedServer = protectMcpHeaders(server, (id, value) => {
        secrets().set(id, value)
        if (origin) destinations.push({ keyId: id, name: server.name || 'MCP server', origin })
      })
      if (protectedServer !== server) {
        // Existing references from a transfer gain no trust here: only slots just created
        // from literal headers, which were already sent to this configured address.
        acceptMigratedDestinations(destinations)
        server.headers = protectedServer.headers
        moved = true
      }
    } catch {
      // Agent reads and exports hide literal headers independently of this migration.
    }
  }
  return moved
}

/** The settings, just loaded: their plain token, if any, is what `fireflyToken` falls back to. */
export function notePlainSecrets(settings: AbeleConfig): void {
  plainFallback = () => settings.fireflyToken
}
