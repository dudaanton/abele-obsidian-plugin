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
