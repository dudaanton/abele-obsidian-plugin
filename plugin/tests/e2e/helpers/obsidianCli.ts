/**
 * Thin wrapper around the `obsidian` CLI, which is what drives the app in the e2e tier.
 *
 * There is no Playwright or Electron harness here on purpose: the CLI already exposes
 * `eval`, DOM queries, console capture and plugin reload against the real running instance,
 * which is everything these tests need.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = process.env.OBSIDIAN_CLI ?? '/usr/local/bin/obsidian'

/**
 * Which vault to drive. Obsidian can have several windows open at once and the CLI
 * otherwise targets whichever is frontmost, which would make results depend on where the
 * user last clicked. Set OBSIDIAN_TEST_VAULT to pin the tests to one window.
 */
const TARGET_VAULT = process.env.OBSIDIAN_TEST_VAULT ?? ''

export class ObsidianUnavailableError extends Error {}

/**
 * What the CLI prints, with exit code 0, when the window is there but the app inside it is
 * still loading — right after `emulateMobile` or a plugin reload, its commands are not yet
 * registered. Parsed as a result, it failed whichever probe came next with "not valid JSON".
 */
const NOT_READY = /^Error: Command "[^"]+" not found/

const sleepSync = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * The longest one CLI call may block for, whatever its caller asked for.
 *
 * Every call here is synchronous, so while it waits the test worker cannot answer the runner —
 * and the runner gives up on a worker after 60 s without an answer ("Timeout calling
 * onTaskUpdate"), ending the whole tier with most of its files never run. A call the app never
 * answered used to wait out its own allowance, fifteen minutes for a group read. Nothing the
 * app is asked takes more than seconds; one that has not answered in this long is not going to.
 */
const CALL_CEILING_MS = 45_000

function run(args: string[], timeoutMs = CALL_CEILING_MS): string {
  timeoutMs = Math.min(timeoutMs, CALL_CEILING_MS)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    // What is left of the one allowance: waiting for the app to get ready counts against it.
    const output = runOnce(args, Math.max(1_000, deadline - Date.now()))
    if (!NOT_READY.test(output)) return output
    if (Date.now() > deadline)
      throw new Error(`obsidian ${args[0]}: the app never got ready: ${output}`)
    sleepSync(500)
  }
}

function runOnce(args: string[], timeoutMs: number): string {
  // `vault=` MUST precede the command. Passed after it the CLI ignores it without an error
  // and runs against whichever window is frontmost, so the tests would silently measure
  // whatever vault the user happened to be looking at.
  const fullArgs = TARGET_VAULT ? [`vault=${TARGET_VAULT}`, ...args] : args
  try {
    // SIGKILL, not the default SIGTERM: a CLI call that never gets its answer from the app
    // ignores SIGTERM, and the timeout then stopped nothing — the whole run hung on it.
    return execFileSync(CLI, fullArgs, {
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024 * 1024,
    }).trim()
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stderr?: string
      stdout?: string
      signal?: string | null
    }
    if (err.code === 'ENOENT') {
      throw new ObsidianUnavailableError(`Obsidian CLI not found at ${CLI}`)
    }
    if (err.signal === 'SIGKILL') {
      throw new Error(`obsidian ${args[0]} gave no answer in ${timeoutMs} ms and was killed`)
    }
    const detail = (err.stderr || err.stdout || err.message || '').toString().trim()
    throw new Error(`obsidian ${fullArgs.join(' ')} failed: ${detail}`)
  }
}

/** A CLI command with its arguments, as they are passed — `dev:cdp`, say. */
export const runCli = (args: string[], timeoutMs?: number): string => run(args, timeoutMs)

/** True when the CLI exists and a vault is currently open. */
export function isObsidianRunning(): boolean {
  try {
    run(['vault'], 15_000)
    return true
  } catch {
    return false
  }
}

/** Name of the vault Obsidian currently has open. */
export function activeVaultName(): string {
  const output = run(['vault'], 15_000)
  const line = output.split('\n').find((l) => l.startsWith('name'))
  return line ? line.split('\t').slice(1).join('\t').trim() : ''
}

/** Number of files the open vault reports. */
export function activeVaultFileCount(): number {
  return evalJson<number>('app.vault.getFiles().length')
}

/**
 * Evaluates an expression in the app and returns its raw `=> …` payload as text.
 *
 * `timeoutMs` is capped at `CALL_CEILING_MS`: a multi-second stall is measured, a call that
 * never answers fails its test rather than the whole tier.
 */
export function evalRaw(code: string, timeoutMs?: number): string {
  const output = run(['eval', `code=${code}`], timeoutMs)
  const marker = output.indexOf('=>')
  return marker === -1 ? output : output.slice(marker + 2).trim()
}

/**
 * Evaluates an expression and parses the result as JSON.
 *
 * The expression is wrapped in `JSON.stringify` inside the app rather than parsed from the
 * CLI's own formatting, so objects survive the round trip intact instead of arriving as
 * `[object Object]`.
 */
export function evalJson<T>(expression: string, timeoutMs?: number): T {
  const wrapped = `JSON.stringify((() => { return (${expression}) })())`
  const raw = evalRaw(wrapped, timeoutMs)
  const unquoted = raw.replace(/^'(.*)'$/s, '$1').replace(/^"(.*)"$/s, '$1')
  try {
    return JSON.parse(unquoted) as T
  } catch {
    throw new Error(`Could not parse eval result as JSON: ${raw.slice(0, 400)}`)
  }
}

/** True when the development build's test API is present in the running app. */
export function hasTestApi(): boolean {
  try {
    return evalJson<boolean>('typeof window.__abeleTest !== "undefined"', 30_000)
  } catch {
    return false
  }
}

export function reloadPlugin(id = 'abele'): void {
  run(['plugin:reload', `id=${id}`], 60_000)
}

export function enableDebugCapture(): void {
  run(['dev:debug', 'on'], 30_000)
}

export function consoleMessages(limit = 50): string {
  return run(['dev:console', `limit=${limit}`], 30_000)
}

export function capturedErrors(): string {
  return run(['dev:errors'], 30_000)
}

/**
 * The window the tier drives sits behind whatever the person is working in, and Chromium
 * throttles a background window: ten 100 ms timeouts took two minutes, a probe waiting on
 * them timed out, and a layout read after a resize was a frame stale. Switched off for the
 * run and back on after it — left off, a window nobody looks at keeps burning a core.
 */
export function setBackgroundThrottling(on: boolean): void {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(${on}); return 'ok' })()`,
    30_000
  )
}

/**
 * How many frames a second the driven window draws. Throttling off keeps its timers running, but
 * a window nobody can see — the Mac's screen locked, above all — is drawn once or twice a second,
 * and every input sent through the DevTools protocol waits for a frame: a tap held 60 ms reaches
 * the page as a one-second long press, a mouse held at the page's edge moves once a second. The
 * tests that time gestures then fail in ways that look like bugs (2026-09-26: six book tests).
 */
export function framesPerSecond(): number {
  const raw = evalRaw(
    `(async () => {
      let frames = 0
      const start = performance.now()
      await Promise.race([
        new Promise((done) => {
          const tick = () => { frames++; if (performance.now() - start < 500) requestAnimationFrame(tick); else done() }
          requestAnimationFrame(tick)
        }),
        new Promise((done) => setTimeout(done, 1500)),
      ])
      return String(Math.round(frames * 1000 / Math.max(500, performance.now() - start)))
    })()`,
    30_000
  )
  return Number(raw.replace(/^['"]|['"]$/g, ''))
}

/**
 * Makes the driven window's page behave as if it had the keyboard focus, whichever window really
 * has it. Only one window of the app can, and it is rarely this one: another vault's window, the
 * person's own, a second run's. Without it a field focused in the page gets no `focus` event
 * and a phone's toolbar for the field never comes up (2026-09-26, `noteField` on a phone,
 * failing in every window but the one in front). Survives a reload; switched off after the run.
 */
export function setFocusEmulation(on: boolean): void {
  run(['dev:cdp', 'method=Emulation.setFocusEmulationEnabled', `params={"enabled":${on}}`], 30_000)
}

/**
 * Obsidian's menus drawn in the page, as on Windows, Linux and a phone, rather than by macOS.
 * On a Mac Obsidian takes an unset "Native menus" for on, and every `Menu` then opens as the
 * system's own popup: nothing of it is in the page, so a test can neither see nor pick its items,
 * and a window that is not in front (a pool vault's, always) does not show it at all. The
 * setting is the vault's own, so only the driven window is touched; it is kept in the fixture.
 */
export function useDomMenus(): void {
  evalRaw(
    `(() => { if (app.vault.getConfig('nativeMenus') !== false) app.vault.setConfig('nativeMenus', false); return 'ok' })()`,
    30_000
  )
}

/** Stops the run with the reason when the window is not being drawn: see `framesPerSecond`. */
export function assertWindowDrawn(): void {
  const fps = framesPerSecond()
  if (fps < 15)
    throw new Error(
      `The Obsidian window draws ${fps} frames a second: the screen is locked or the window is ` +
        'hidden, and gestures sent to it arrive a second late. Unlock the screen and run again.'
    )
}

/**
 * Closes settings windows this vault's window left open. A probe that failed half way, or an
 * app reload under `emulateMobile`, leaves one behind; the next probe then finds two windows
 * called "Settings" and measures whichever comes first. Only popouts of the driven window are
 * touched, told by the vault name in the title — another vault's window, and whatever its owner
 * has open, is not ours.
 */
export function closeStrayWindows(): number {
  return evalJson<number>(
    `(() => {
      const remote = require('@electron/remote')
      const main = remote.getCurrentWindow()
      try { app.setting.close() } catch {}
      let closed = 0
      for (const w of remote.BrowserWindow.getAllWindows()) {
        if (w.id === main.id || w.isDestroyed()) continue
        // Obsidian titles a popout after its vault: "Settings - <vault> - Obsidian 1.x".
        const title = w.getTitle()
        if (title.startsWith('Settings') && title.includes(' - ' + app.vault.getName() + ' - ')) {
          w.destroy()
          closed++
        }
      }
      return closed
    })()`,
    30_000
  )
}

/**
 * Waits until Obsidian has resolved every note's links. After an app reload — which every
 * `emulateMobile` switch is — the link index fills in over several seconds while the
 * metadata is already there, so a file running right after one saw a group of 442 notes as 6.
 */
export function waitForLinkIndex(timeoutMs = 120_000): void {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const settled = evalJson<boolean>(
      `(() => {
        const m = app.metadataCache
        const q = m.linkResolverQueue
        const pending = q ? (q.items?.size ?? q.items?.length ?? 0) : 0
        const running = !!q?.runnable?.running
        return m.initialized && !pending && !running &&
          Object.keys(m.resolvedLinks).length >= app.vault.getMarkdownFiles().length
      })()`,
      30_000
    )
    if (settled) return
    if (Date.now() > deadline) throw new Error('Obsidian did not finish resolving links in time')
    sleepSync(1000)
  }
}

/**
 * Where Obsidian keeps "emulate a phone": one `localStorage` key, read once as a window starts.
 * `localStorage` is shared by every window of the app, so a phone switched on in one vault's
 * window came up as a phone in any other window that reloaded while it was set — another test
 * run's, or the person's own — and switching it off anywhere turned a phone back into a desktop
 * on its next reload (2026-09-26, two runs side by side in two vaults).
 */
const MOBILE_KEY = 'EmulateMobile'
/** What this window wants, kept in its own `sessionStorage`, which survives a reload. */
const MOBILE_WISH = 'abele-e2e-mobile'
/** Held from writing the shared key until the reloaded window has read it: one reload at a time. */
const RELOAD_LOCK = join(tmpdir(), 'abele-e2e-reload.lock')
/** A lock older than this was left by a run that died half way, not held by a live one. */
const RELOAD_LOCK_STALE_MS = 120_000

const pauseAsync = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function takeReloadLock(): Promise<void> {
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
        // Gone in between: the next attempt takes it.
      }
      if (Date.now() > deadline) throw new Error(`${RELOAD_LOCK} was not released in 5 minutes`)
      await pauseAsync(250)
    }
  }
}

/**
 * Reloads the driven window and waits for the plugin to be back, as a phone, a desktop, or —
 * given anything else — whatever the window was. `how` takes what the tests used to evaluate
 * themselves: `app.emulateMobile(true)`, `app.emulateMobile(false)`, `location.reload()`.
 *
 * Every reload in the tier comes through here, so the shared key is only ever set for the few
 * seconds one window takes to start, under a lock across runs, and taken away again after: a
 * window's phone or desktop is its own, whoever else reloads.
 */
export async function reloadApp(how = 'location.reload()'): Promise<void> {
  const asked = /emulateMobile\((true|false)\)/.exec(how)?.[1]
  await takeReloadLock()
  try {
    evalRaw(
      `(() => {
        const asked = ${asked === undefined ? 'null' : `'${asked === 'true' ? '1' : ''}'`}
        if (asked !== null) sessionStorage.setItem('${MOBILE_WISH}', asked)
        const wish = sessionStorage.getItem('${MOBILE_WISH}') ?? (app.isMobile ? '1' : '')
        if (wish) localStorage.setItem('${MOBILE_KEY}', '1')
        else localStorage.removeItem('${MOBILE_KEY}')
        setTimeout(() => location.reload(), 50)
        return 'ok'
      })()`,
      30_000
    )
    await pauseAsync(4000)
    const deadline = Date.now() + 60_000
    while (!hasTestApi() && Date.now() < deadline) await pauseAsync(1000)
    evalRaw(`(() => { localStorage.removeItem('${MOBILE_KEY}'); return 'ok' })()`, 30_000)
  } finally {
    try {
      rmdirSync(RELOAD_LOCK)
    } catch {
      // Taken away as stale by another run: nothing left to release.
    }
  }
  setBackgroundThrottling(false)
}
