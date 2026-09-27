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

const hasTestApi = (vault: TestVault): boolean => {
  try {
    return vault.evalRaw('String(typeof window.__abeleTest === "object")', 10_000) === 'true'
  } catch {
    return false
  }
}

/**
 * Reloads the test window as a phone or as a desktop, and waits for the plugin to be back.
 * Background throttling is switched off again, since a reload turns it back on.
 */
export async function reloadAs(vault: TestVault, mobile: boolean): Promise<void> {
  await takeReloadLock()
  try {
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
    await delay(4000)
    await waitFor('the plugin to be back after the reload', () => hasTestApi(vault), 60_000)
    vault.evalRaw(`(() => { localStorage.removeItem('${MOBILE_KEY}'); return 'ok' })()`, 20_000)
  } finally {
    releaseReloadLock()
  }
  vault.evalRaw(
    `(() => { require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false); return 'ok' })()`,
    20_000
  )
}

export const windowSize = (vault: TestVault): [number, number] =>
  vault.evalAwait<[number, number]>(
    `require('@electron/remote').getCurrentWindow().getContentSize()`
  )

/** Resizes, then nudges by two pixels and back: a capture after a reload waits on a frame. */
export async function setWindowSize(
  vault: TestVault,
  width: number,
  height: number
): Promise<void> {
  vault.evalRaw(
    `(() => {
      const w = require('@electron/remote').getCurrentWindow()
      w.setContentSize(${width + 2}, ${height + 2})
      setTimeout(() => w.setContentSize(${width}, ${height}), 300)
      return 'ok'
    })()`,
    20_000
  )
  await delay(1500)
}
