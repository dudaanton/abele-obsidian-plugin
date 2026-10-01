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
}

/** Production uses this vault window's actual Chromium session; tests may isolate one. */
export function sessionAwareNet(overrideSession?: SessionFetch): SessionNet {
  if (!Platform.isDesktop) throw new Error('native desktop sync transport is unavailable')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- desktop guard above; Electron's main-process session is accessed through Obsidian's remote bridge
  const remote = require('@electron/remote') as {
    getCurrentWebContents(): { session: SessionFetch }
    require(name: string): { Buffer: { from(buffer: ArrayBuffer): Uint8Array } }
    getGlobal(name: string): new () => { signal: AbortSignal; abort(): void }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- desktop-only Buffer serialization supported by Electron's bridge
  const buffer = require('node:buffer') as {
    Buffer: { from(bytes: ArrayBuffer): Uint8Array<ArrayBuffer> }
  }
  const session = overrideSession ?? remote.getCurrentWebContents().session
  if (typeof session.fetch !== 'function')
    throw new Error('This desktop build has no session-aware sync transport')
  return {
    session,
    bytes: (bytes) => new Uint8Array(remote.require('node:buffer').Buffer.from(bytes)),
    body: (bytes) => buffer.Buffer.from(bytes),
    controller: () => new (remote.getGlobal('AbortController'))(),
  }
}
