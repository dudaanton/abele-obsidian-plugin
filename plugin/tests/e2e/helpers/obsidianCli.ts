/**
 * Thin wrapper around the `obsidian` CLI, which is what drives the app in the e2e tier.
 *
 * There is no Playwright or Electron harness here on purpose: the CLI already exposes
 * `eval`, DOM queries, console capture and plugin reload against the real running instance,
 * which is everything these tests need.
 */
import { execFileSync } from 'node:child_process'

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
