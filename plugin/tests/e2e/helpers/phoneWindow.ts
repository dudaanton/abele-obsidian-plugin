/**
 * A test vault's window as a phone, and back, for the sync suites that picture their screens.
 *
 * The phone is this window's alone. Obsidian keeps "emulate a phone" in one `localStorage` key
 * every window shares and reads it as a window starts; set and left set, it turned whichever
 * other window reloaded next into a phone. So the key is set for the few seconds this window
 * takes to reload, under the lock the rest of the tier takes for the same thing, and taken away
 * again after. Opening a vault starts a window, which reads the key as it starts, so that is
 * done under the lock too.
 */
import { mkdirSync, rmdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { delay } from './syncServer'
import type { VaultCli } from './obsidianCli'
import { openTestVault, waitFor, type TestVault } from './syncVault'

/** Obsidian's key, and this window's own wish, which its `sessionStorage` keeps over a reload. */
const MOBILE_KEY = 'EmulateMobile'
const MOBILE_WISH = 'abele-e2e-mobile'
/** The lock the rest of the tier holds while the shared key is set. */
const RELOAD_LOCK = join(tmpdir(), 'abele-e2e-reload.lock')
const RELOAD_LOCK_STALE_MS = 120_000

export async function takeReloadLock(): Promise<void> {
  const deadline = Date.now() + 5 * 60_000
  for (;;) {
    try {
      mkdirSync(RELOAD_LOCK)
      return
    } catch {
      try {
        if (Date.now() - statSync(RELOAD_LOCK).mtimeMs > RELOAD_LOCK_STALE_MS)
          rmdirSync(RELOAD_LOCK)
      } catch {
        /* gone in between */
      }
      if (Date.now() > deadline) throw new Error(`${RELOAD_LOCK} was not released in 5 minutes`)
      await delay(250)
    }
  }
}

export function releaseReloadLock(): void {
  try {
    rmdirSync(RELOAD_LOCK)
  } catch {
    /* taken away as stale by another run */
  }
}

/** A test vault, opened while no other window can be turned into a phone by it. */
export async function openVaultUnderLock(): Promise<TestVault> {
  await takeReloadLock()
  try {
    return await openTestVault()
  } finally {
    releaseReloadLock()
  }
}

/**
 * The plugin back and its layout ready: sync starts on layout-ready, and a transport swapped in
 * before that start ran beside it (the fixed 4 s wait used to cover the gap).
 */
const hasTestApi = (vault: VaultCli): boolean => {
  try {
    return (
      vault.evalRaw(
        'String(typeof window.__abeleTest === "object" && !!app.workspace.layoutReady)',
        10_000
      ) === 'true'
    )
  } catch {
    return false
  }
}

const reloaded = (vault: VaultCli, before: number): boolean => {
  try {
    const now = Number(vault.evalRaw('String(performance.timeOrigin)', 10_000))
    return Number.isFinite(now) && now !== before
  } catch {
    return false
  }
}

/**
 * Reloads the test window as a phone or as a desktop, and waits for the plugin to be back.
 * Background throttling is switched off again, since a reload turns it back on.
 */
export async function reloadAs(vault: VaultCli, mobile: boolean): Promise<void> {
  const asked = Date.now()
  await takeReloadLock()
  const locked = Date.now()
  try {
    const before = Number(vault.evalRaw('String(performance.timeOrigin)', 20_000))
    vault.evalRaw(
      `(() => {
        sessionStorage.setItem('${MOBILE_WISH}', '${mobile ? '1' : ''}')
        if (${mobile}) localStorage.setItem('${MOBILE_KEY}', '1')
        else localStorage.removeItem('${MOBILE_KEY}')
        setTimeout(() => location.reload(), 50)
        return 'ok'
      })()`,
      20_000
    )
    // A new page is a new time origin: until it changes, the old page with its test API is
    // still the one answering.
    await waitFor(
      'the plugin to be back after the reload',
      () => reloaded(vault, before) && hasTestApi(vault),
      60_000
    )
    console.info(
      '[abele e2e] reloadAs timing',
      JSON.stringify({ mobile, lockWaitMs: locked - asked, reloadMs: Date.now() - locked })
    )
    if (mobile) {
      // Desktop emulation has no iOS HTTP bridge, and the plugin's mobile module loader
      // hides Electron. Inject this window's real native host through the CLI loader while
      // keeping mobile UI/lifecycle flags and production's unsupported-runtime refusal.
      // This remains desktop layout/lifecycle evidence, never native phone HTTP evidence.
      vault.evalAwait(
        `(async () => {
        const api = window.__abeleTest, tokenHost = app.plugins.plugins.abele.tokenEngines
        const remote = require('@electron/remote'), buffer = require('node:buffer').Buffer
        const host = {
          session: remote.getCurrentWebContents().session,
          bytes: bytes => new Uint8Array(remote.require('node:buffer').Buffer.from(bytes)),
          body: bytes => buffer.from(bytes),
          controller: () => new (remote.getGlobal('AbortController'))()
        }
        // The engines the reload started finish starting first: reset in the middle of their
        // start, they left staging files behind that sync then announced as recovered copies.
        await tokenHost.engines.settled()
        await tokenHost.engines.reset()
        const transport = api.desktopTransport(undefined, host)
        // UI metadata (including sync-now refresh and trash) uses its own clients.
        // They need the same emulated native host as the restarted engines.
        tokenHost.ui.transport = transport
        tokenHost.ui.itemSets.transport = transport
        tokenHost.deps.fetch = transport
        tokenHost.start()
        await tokenHost.engines.settled()
        return 'ok'
      })()`,
        30_000
      )
    }
    vault.evalRaw(`(() => { localStorage.removeItem('${MOBILE_KEY}'); return 'ok' })()`, 20_000)
  } finally {
    releaseReloadLock()
  }
  vault.evalRaw(
    `(() => { require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false); return 'ok' })()`,
    20_000
  )
}

export const windowSize = (vault: VaultCli): [number, number] =>
  vault.evalAwait<[number, number]>(
    `require('@electron/remote').getCurrentWindow().getContentSize()`
  )

/**
 * Resizes, then nudges by two pixels and back: a capture after a reload waits on a frame. Done
 * when the page has the size and has drawn two frames at it, rather than after a fixed 1.5 s.
 */
export async function setWindowSize(vault: VaultCli, width: number, height: number): Promise<void> {
  const sized = vault.evalAwait<boolean>(
    `(async () => {
      const w = require('@electron/remote').getCurrentWindow()
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
      w.setContentSize(${width + 2}, ${height + 2})
      await pause(300)
      w.setContentSize(${width}, ${height})
      for (const until = Date.now() + 10000; Date.now() < until; await pause(50))
        if (innerWidth === ${width} && innerHeight === ${height}) {
          const frame = () => Promise.race([new Promise(requestAnimationFrame), pause(250)])
          await frame(); await frame()
          return true
        }
      return false
    })()`,
    20_000
  )
  if (!sized) throw new Error(`the window did not take the size ${width}×${height}`)
}

/**
 * Sizes the window for a phone or a desktop, and reloads it only when it has to: when it changes
 * from one to the other, or to another phone width — the phone layout does not follow a resize
 * the way a desktop does (a 390 sheet resized to 320 left a dialog's buttons covered). Between
 * two desktop sizes the app follows the resize.
 */
export async function showAs(
  vault: VaultCli,
  width: number,
  height: number,
  mobile = width < 500
): Promise<void> {
  const [wasMobile, wasWidth] = JSON.parse(
    vault.evalRaw('JSON.stringify([!!app.isMobile, innerWidth])', 20_000)
  ) as [boolean, number]
  await setWindowSize(vault, width, height)
  if (wasMobile !== mobile || (mobile && wasWidth !== width)) await reloadAs(vault, mobile)
}
