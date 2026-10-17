import { Platform } from 'obsidian'

/** Electron's session.fetch uses Chromium's net stack, including the selected proxy/PAC. */
export interface SessionFetch {
  fetch: typeof fetch
}
export interface SessionNet {
  session: SessionFetch
  /** Convert a main-process ArrayBuffer through Electron's supported Buffer bridge. */
  bytes(buffer: ArrayBuffer): Uint8Array
  body(buffer: ArrayBuffer): Uint8Array<ArrayBuffer>
  controller(): { signal: AbortSignal; abort(): void }
  /**
   * Every response header in one bridge round trip. Without it a host's headers are walked
   * through their iterator, which costs one synchronous bridge call per name and value.
   */
  headerEntries?(headers: Headers): [string, string][]
}

/** The part of Obsidian's remote bridge this module uses. */
export interface RemoteBridge {
  getCurrentWebContents(): { session: SessionFetch }
  require(name: string): { Buffer: { from(buffer: ArrayBuffer): Uint8Array } }
  getGlobal(name: 'AbortController'): new () => { signal: AbortSignal; abort(): void }
  getGlobal(name: 'Array'): { from(source: Headers): [string, string][] }
}

/**
 * Build a native host from the remote bridge. Every property read on a remote object is a
 * synchronous IPC round trip, so the handles are resolved once here, not once per request.
 */
export function remoteSessionNet(
  remote: RemoteBridge,
  localBuffer: { from(bytes: ArrayBuffer): Uint8Array<ArrayBuffer> },
  overrideSession?: SessionFetch
): SessionNet {
  const session = overrideSession ?? remote.getCurrentWebContents().session
  if (typeof session.fetch !== 'function')
    throw new Error('This desktop build has no session-aware sync transport')
  const NativeBuffer = remote.require('node:buffer').Buffer
  const NativeAbortController = remote.getGlobal('AbortController')
  const NativeArray = remote.getGlobal('Array')
  return {
    session,
    bytes: (bytes) => new Uint8Array(NativeBuffer.from(bytes)),
    body: (bytes) => localBuffer.from(bytes),
    controller: () => new NativeAbortController(),
    headerEntries: (headers) => NativeArray.from(headers),
  }
}

let windowNet: SessionNet | undefined

/** Production uses this vault window's actual Chromium session; tests may isolate one. */
export function sessionAwareNet(overrideSession?: SessionFetch): SessionNet {
  if (!Platform.isDesktop) throw new Error('native desktop sync transport is unavailable')
  if (!overrideSession && windowNet) return windowNet
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- desktop guard above; Electron's main-process session is accessed through Obsidian's remote bridge
  const remote = require('@electron/remote') as RemoteBridge
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- desktop-only Buffer serialization supported by Electron's bridge
  const buffer = require('node:buffer') as {
    Buffer: { from(bytes: ArrayBuffer): Uint8Array<ArrayBuffer> }
  }
  const net = remoteSessionNet(remote, buffer.Buffer, overrideSession)
  // The window's own session lives as long as the window; an override is the caller's to keep.
  if (!overrideSession) windowNet = net
  return net
}
