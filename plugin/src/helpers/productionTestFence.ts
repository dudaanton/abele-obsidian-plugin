import type { App, Plugin } from 'obsidian'

/** Production resolves the test entry points here, before their side-effectful graph loads. */
export function exposeTestApi(_plugin: Plugin): void {}

export function observePhoneReplayTransport(_app: App, transport: typeof fetch): typeof fetch {
  return transport
}

/** No injected transport is consulted by a distributable build. */
export function syncTransportForTests(): typeof fetch | undefined {
  return undefined
}
