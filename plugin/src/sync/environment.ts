import { Platform, type App } from 'obsidian'
import type { OwnerPushHooks, PersonalNoteHook, VaultClient, StateStore } from '@abele/sync-core'
import type { DeviceConnection } from './connection'
import { PHONE_POLL_MS, phoneSocket } from './phone'
import { wsFor } from './transport'
import { mobileTransport } from './mobileTransport'
import { desktopTransport } from './desktopTransport'

/**
 * What a test replaces to run the service against a server in its own process.
 *
 * Production passes none of it: desktop transport is native non-following HTTP; verified iOS
 * uses the explicitly non-following native bridge. Unknown mobile runtimes stay blocked. The socket is the WebView's own and the database is the
 * window's IndexedDB. A test hands over a `fetch` into
 * the running server, a `WebSocket` bound to its port, and an `IDBFactory` of its own so that
 * no two tests share a database.
 */
export interface SyncServiceDeps {
  /** Trusted production host factory (the plugin installs it), with isolated stand replacements
   * permitted through this port. No setting, test hook or environment value establishes authority. */
  ownerPublication?: (context: {
    app: App
    state: StateStore
    client: VaultClient
    connection: DeviceConnection
    token: string
    fetch: typeof fetch
    held: () => boolean
  }) => Promise<{
    hooks: OwnerPushHooks & { onPersonalNoteApplied?: PersonalNoteHook }
    beforeRemote?(paths: string[]): void | Promise<void>
    /** Post-sync work, outside the personal settlement transaction; never holds uploads. */
    settled?(): void | Promise<void>
    close(): void
  }>
  fetch?: typeof fetch
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
