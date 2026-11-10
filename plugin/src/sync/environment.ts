import { Platform } from 'obsidian'
import { PHONE_POLL_MS, phoneSocket } from './phone'
import { wsFor } from './transport'
import { mobileTransport } from './mobileTransport'
import { desktopTransport } from './desktopTransport'
import type { SyncStartupTimeline } from './startupTimeline'

/**
 * What a test replaces to run the service against a server in its own process.
 *
 * Production passes none of it: desktop transport is native non-following HTTP; verified iOS
 * uses the native bridge plus original browser fetch for advertised bounded part uploads;
 * both refuse redirects before following. Unknown mobile runtimes stay blocked. The socket is the WebView's own and the database is the
 * window's IndexedDB. A test hands over a `fetch` into
 * the running server, a `WebSocket` bound to its port, and an `IDBFactory` of its own so that
 * no two tests share a database.
 */
export interface SyncServiceDeps {
  fetch?: typeof fetch
  startupTimeline?: SyncStartupTimeline
  WebSocket?: typeof WebSocket
  indexedDB?: IDBFactory
  /** How often the engine syncs with nothing prompting it. */
  fallbackMs?: number
  /** How often the configuration folder is walked. */
  pollMs?: number
}

/** Desktop must refuse redirects before following, not inspect requestUrl's final response. */
export function transportOf(deps: SyncServiceDeps): typeof fetch {
  if (deps.fetch) return deps.fetch
  return Platform.isMobile ? mobileTransport() : desktopTransport()
}

/**
 * Opening the host's local stores must not require a supported network runtime.
 * Resolve on first request so layout emulation can install its native dependency after
 * reload. Unsupported mobile requests still fail closed, without a requestUrl fallback.
 */
export function hostTransport(deps: SyncServiceDeps): typeof fetch {
  let transport: typeof fetch | undefined
  return async (input, init) => {
    transport ??= transportOf(deps)
    return transport(input, init)
  }
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
