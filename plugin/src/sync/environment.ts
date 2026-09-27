import { Platform, requestUrl } from 'obsidian'
import { PHONE_POLL_MS, phoneSocket } from './phone'
import { fetchViaRequestUrl, wsFor } from './transport'

/**
 * What a test replaces to run the service against a server in its own process.
 *
 * Production passes none of it: the transport is Obsidian's `requestUrl`, the socket is the
 * WebView's own, and the database is the window's IndexedDB. A test hands over a `fetch` into
 * the running server, a `WebSocket` bound to its port, and an `IDBFactory` of its own so that
 * no two tests share a database.
 */
export interface SyncServiceDeps {
  fetch?: typeof fetch
  WebSocket?: typeof WebSocket
  indexedDB?: IDBFactory
  /** How often the engine syncs with nothing prompting it. */
  fallbackMs?: number
  /** How often the configuration folder is walked. */
  pollMs?: number
}

/** The engine's `fetch`: Obsidian's `requestUrl`, which no CORS rule and no phone refuses. */
export function transportOf(deps: SyncServiceDeps): typeof fetch {
  return deps.fetch ?? fetchViaRequestUrl(requestUrl)
}

/** A phone's refuses to open, whatever a test hands in: a phone must never hold one. */
export function socketOf(deps: SyncServiceDeps): typeof WebSocket {
  if (Platform.isMobile) return phoneSocket()
  return deps.WebSocket ?? wsFor()
}

/** How often the engine syncs unprompted: the engine's own five minutes, a minute on a phone. */
export function fallbackMsOf(deps: SyncServiceDeps): number | undefined {
  return deps.fallbackMs ?? (Platform.isMobile ? PHONE_POLL_MS : undefined)
}

/** How often the config folder is walked: the adapter's own default, a minute on a phone. */
export function pollMsOf(deps: SyncServiceDeps): number | undefined {
  return deps.pollMs ?? (Platform.isMobile ? PHONE_POLL_MS : undefined)
}

/** The IndexedDB the ledgers are opened in. */
export function factoryOf(deps: SyncServiceDeps): IDBFactory {
  return deps.indexedDB ?? window.indexedDB
}
