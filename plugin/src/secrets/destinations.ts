import type { AbeleSettings } from '@/services/AbeleConfig'
import type { RequestUrlParam } from 'obsidian'
import { basicAuth } from '@/calendars/http'
import { checkKeyTransport } from './keyTransport'
import { IMAGE_API_DEFAULTS } from '@/ai/types'
import { DEFAULT_TRANSCRIPTION } from '@/ai/transcription'
import { GlobalStore } from '@/stores/GlobalStore'
import { secrets } from './SecretStore'
import { FIREFLY_TOKEN_KEY_ID } from './legacy'
import { DestinationPolicy, httpOrigin, type Destination } from './DestinationPolicy'
export type { Destination } from './DestinationPolicy'

const STORAGE_KEY = 'abele-key-destinations-v1'
function policy(): DestinationPolicy {
  const app = GlobalStore.getInstance().app
  return new DestinationPolicy({
    load: () => app.loadLocalStorage(STORAGE_KEY),
    save: (value) => app.saveLocalStorage(STORAGE_KEY, value),
  })
}

/** The configured recipient of every service key, excluding GitHub's separate transport. */
export function keyDestinations(settings: AbeleSettings): Destination[] {
  const result: Destination[] = []
  const add = (keyId: string | undefined, name: string, address: string | undefined) => {
    const origin = address ? httpOrigin(address) : null
    if (keyId && origin) result.push({ keyId, name, origin })
  }
  const ai = settings.ai
  for (const p of ai?.providers ?? []) add(p.apiKeyId, p.name || 'AI provider', p.baseUrl)
  for (const p of ai?.imageProviders ?? [])
    add(p.apiKeyId, p.name || 'Image provider', p.endpoint || IMAGE_API_DEFAULTS[p.apiType])
  add(
    ai?.voice?.apiKeyId || DEFAULT_TRANSCRIPTION.apiKeyId,
    'Voice input',
    ai?.voice?.endpoint || DEFAULT_TRANSCRIPTION.endpoint
  )
  add(ai?.braveSearchApiKey, 'Brave Search', 'https://api.search.brave.com')
  add(FIREFLY_TOKEN_KEY_ID, 'Firefly III', settings.fireflyBaseUrl)
  for (const secret of ai?.secrets ?? []) {
    for (const origin of secret.allowedOrigins ?? [])
      add(secret.keyId, secret.name || 'Saved key', origin)
  }
  for (const server of ai?.mcpServers ?? [])
    add(server.keyId, server.name || 'MCP server', server.url)
  for (const feed of settings.calendars?.feeds ?? []) {
    if (feed.source === 'caldav') add(feed.keyId, feed.name || 'Calendar', feed.server)
  }
  return result
}
export function initializeDestinations(settings: AbeleSettings): void {
  policy().initialize(keyDestinations(settings))
}
export function acceptDestinations(destinations: Destination[]): void {
  policy().accept(destinations)
}
export function pendingDestinations(settings: AbeleSettings): Destination[] {
  const destinations = keyDestinations(settings)
  const pending = policy().pending(destinations)
  return destinations.filter((d) => {
    if (pending.includes(d)) return true
    try {
      checkKeyTransport(d.origin)
      return false
    } catch {
      return true
    }
  })
}
export function acceptIntroducedDestinations(before: Destination[], after: Destination[]): void {
  const previous = new Set(before.map((d) => JSON.stringify([d.keyId, d.origin])))
  acceptDestinations(after.filter((d) => !previous.has(JSON.stringify([d.keyId, d.origin]))))
}
export function checkKeyDestination(keyId: string, url: string, settings: AbeleSettings): void {
  checkKeyTransport(url)
  policy().check(keyId, url, keyDestinations(settings))
}
/** Also protects service clients passed a cached or manually assembled credential header. */
export function checkRequestDestinations(
  request: RequestUrlParam,
  settings: AbeleSettings
): string[] {
  const carried: string[] = []
  const headers = Object.values(request.headers ?? {})
  if (
    Object.entries(request.headers ?? {}).some(
      ([name, value]) =>
        value.replace(/^Bearer\s*/i, '').trim() &&
        /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token|x-subscription-token)$/i.test(
          name
        )
    )
  )
    checkKeyTransport(request.url)
  for (const keyId of new Set(keyDestinations(settings).map((d) => d.keyId))) {
    const value = secrets().get(keyId)
    if (!value) continue
    const basics = (settings.calendars?.feeds ?? [])
      .filter((f) => f.source === 'caldav' && f.keyId === keyId)
      .map((f) => basicAuth(f.username, value))
    if (headers.some((h) => h.includes(value) || basics.includes(h))) {
      checkKeyDestination(keyId, request.url, settings)
      carried.push(value, ...basics)
    }
  }
  return carried
}

export function providerKey(
  keyId: string,
  url: string,
  settings: AbeleSettings
): { apiKey: string; keyError?: string } {
  try {
    return { apiKey: keyFor(keyId, url, settings) }
  } catch (error) {
    return { apiKey: '', keyError: (error as Error).message }
  }
}
export function keyFor(keyId: string, url: string, settings: AbeleSettings): string {
  const value = keyId ? secrets().get(keyId) : ''
  if (!value) return ''
  // Also serves callers initialized before the plugin's startup adapter in embedded clients.
  initializeDestinations(settings)
  checkKeyDestination(keyId, url, settings)
  return value
}
