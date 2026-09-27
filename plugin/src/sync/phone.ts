/**
 * What a phone does differently: no socket, a shorter clock, and a sync on the way out.
 *
 * A phone runs the same engine the same way a desktop does — the vault's own events start a
 * push a moment after an edit, and a clock asks the server what changed — with two things
 * taken away and one added. There is no socket: the system suspends the app the moment it
 * leaves the screen, and a socket it will not let live is a socket that only reconnects. The
 * clock is what hears another device instead, so it ticks every minute rather than every five,
 * and only while the app is in front, since a suspended app runs no timer. And leaving the
 * screen is a reason to sync, so the last edit is on its way before the system freezes it.
 */

/**
 * How often a phone asks the server for what other devices changed, while the app is in
 * front — and how often it looks at its own config folder, which no vault event reports.
 * Each tick is one request and a walk of the file index, which costs nothing a person notices.
 */
export const PHONE_POLL_MS = 60_000

/** Why the engine opens no socket here, as it writes it in the log once per start. */
export const PHONE_NO_SOCKET =
  'a phone keeps no connection open; edits here are sent as they are made, and the server is asked every minute while the app is in front'

/**
 * The socket class a phone hands the client: one that refuses to be opened.
 *
 * The engine reads a socket that cannot be built as a host with none, logs why and keeps its
 * clock — which is the phone's whole arrangement, reached through the engine's own road rather
 * than by never starting it. Starting it is what brings the vault's events and the clock along.
 */
export function phoneSocket(): typeof WebSocket {
  class NoSocket {
    constructor() {
      throw new Error(PHONE_NO_SOCKET)
    }
  }
  return NoSocket as unknown as typeof WebSocket
}

/** What `watchTheFront` does when the app comes to the front or leaves it. */
export interface FrontHandlers {
  /** Ask a question about held deletes that was found while the app was away. */
  held(): void
  /** Sync, on a phone: `visible` is whether the app just came to the front. */
  sync(visible: boolean): void
}

/**
 * A phone syncs when its user looks at it, and as they put it away.
 *
 * Coming back, because the clock was frozen while the app was away and whatever other devices
 * did since is what the user is about to read. Going away, because the system is about to
 * freeze the app, and an edit whose push is still waiting on the watcher's pause would sit
 * here until the app is next opened; the system gives a moment, and a small push fits in it.
 * On every device, coming back also asks a question about held deletes that was found while
 * the app was away (`HeldDeletesPrompt.foreground`).
 *
 * Registered through the plugin so Obsidian takes the listener away when the plugin unloads.
 */
export function watchTheFront(
  plugin: { registerDomEvent: (el: Document, type: 'visibilitychange', cb: () => void) => void },
  phone: boolean,
  on: FrontHandlers
): void {
  plugin.registerDomEvent(document, 'visibilitychange', () => {
    on.held()
    if (phone) on.sync(document.visibilityState === 'visible')
  })
}
