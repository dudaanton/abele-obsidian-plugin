/**
 * Thin wrapper around the `obsidian` CLI, which is what drives the app in the e2e tier.
 *
 * There is no Playwright or Electron harness here on purpose: the CLI already exposes
 * `eval`, DOM queries, console capture and plugin reload against the real running instance,
 * which is everything these tests need.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { onPhone, desktopOnly } from './target'
import { phoneEval, installPhoneHost, assertPhoneTransport } from './phone'
import { confirmReload, type ReloadWitness } from './reloadWitness'

/**
 * Where the CLI is: `OBSIDIAN_CLI` when it is set, else the first of the places an install
 * puts it, else whatever `obsidian` the PATH finds. A fixed default that did not exist on the
 * machine read as "Obsidian is not running", and a suite skipped for that reason passes.
 */
const CLI =
  process.env.OBSIDIAN_CLI ??
  ['/usr/local/bin/obsidian', join(homedir(), '.local/bin/obsidian')].find((path) =>
    existsSync(path)
  ) ??
  'obsidian'

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
const EVAL_PROCESS = join(dirname(fileURLToPath(import.meta.url)), 'obsidianEvalProcess.mjs')

class CliNoAnswerError extends Error {}

/** Opt-in only: arbitrary evals, reloads and native input must never be replayed. */
function run(
  args: string[],
  timeoutMs = CALL_CEILING_MS,
  idempotent = false,
  vault = TARGET_VAULT,
  reply?: string
): string {
  timeoutMs = Math.min(timeoutMs, CALL_CEILING_MS)
  if (onPhone()) return runOnPhone(args, timeoutMs)
  const attempts = idempotent ? 3 : 1
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // Even all three lost answers must leave the synchronous worker below its 60 s ceiling.
    const allowance = idempotent ? Math.min(timeoutMs, attempt === 1 ? 30_000 : 10_000) : timeoutMs
    try {
      return runReady(args, allowance, vault, reply)
    } catch (error) {
      if (!(error instanceof CliNoAnswerError)) throw error
      if (attempt === attempts)
        throw new CliNoAnswerError(
          `${error.message} (${attempt} attempt${attempt === 1 ? '' : 's'}; ${idempotent ? 'idempotent retry exhausted' : 'not retried'})`
        )
    }
  }
  throw new Error('unreachable CLI attempt')
}

function runReady(args: string[], timeoutMs: number, vault: string, reply?: string): string {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    // What is left of the one allowance: waiting for the app to get ready counts against it.
    const output = runOnce(args, Math.max(1_000, deadline - Date.now()), vault, reply)
    if (!NOT_READY.test(output)) return output
    if (Date.now() > deadline)
      throw new Error(`obsidian ${args[0]}: the app never got ready: ${output}`)
    sleepSync(500)
  }
}

function runOnce(args: string[], timeoutMs: number, vault: string, reply?: string): string {
  // `vault=` MUST precede the command. Passed after it the CLI ignores it without an error
  // and runs against whichever window is frontmost, so the tests would silently measure
  // whatever vault the user happened to be looking at.
  const fullArgs = vault ? [`vault=${vault}`, ...args] : args
  try {
    // SIGKILL, not the default SIGTERM: a CLI call that never gets its answer from the app
    // ignores SIGTERM, and the timeout then stopped nothing — the whole run hung on it.
    if (reply === undefined)
      return execFileSync(CLI, fullArgs, {
        encoding: 'utf8',
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 64 * 1024 * 1024,
      }).trim()
    const framed = reply !== undefined
    const executable = framed ? process.execPath : CLI
    const command = framed
      ? [EVAL_PROCESS, CLI, reply, String(Date.now() + timeoutMs), ...fullArgs]
      : fullArgs
    const result = spawnSync(executable, command, {
      encoding: 'utf8',
      detached: framed && process.platform !== 'win32',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024 * 1024,
    })
    // A proxy killed at the outer deadline must not leave its CLI child running. The running
    // Obsidian app is a different process group and is never touched.
    if (framed && result.pid > 0 && process.platform !== 'win32') {
      try {
        process.kill(-result.pid, 'SIGKILL')
      } catch {
        /* the group already exited */
      }
    }
    if (result.error || result.status !== 0) {
      throw Object.assign(result.error ?? new Error('CLI process failed'), {
        stdout: result.stdout,
        stderr: result.stderr,
        signal: result.status === 124 ? 'SIGKILL' : result.signal,
      })
    }
    return result.stdout.trim()
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stderr?: string
      stdout?: string
      signal?: string | null
    }
    if (err.code === 'ENOENT') {
      throw new ObsidianUnavailableError(`Obsidian CLI not found at ${CLI}`)
    }
    if (err.signal === 'SIGKILL' && (reply !== undefined || err.code === 'ETIMEDOUT')) {
      const stdout = String(err.stdout ?? '')
      const stderr = String(err.stderr ?? '')
      // Distinguish a missing renderer reply from a CLI process that printed its reply but
      // never exited. Do not include the output itself: an eval can return device credentials.
      const diagnostics = JSON.stringify({
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
        responsePrinted: stdout.includes('=>'),
      })
      throw new CliNoAnswerError(
        `obsidian ${args[0]} gave no answer in ${timeoutMs} ms and was killed; ${diagnostics}`
      )
    }
    const detail = (err.stderr || err.stdout || err.message || '').toString().trim()
    throw new Error(`obsidian ${fullArgs.join(' ')} failed: ${detail}`)
  }
}

/**
 * The CLI commands the tier uses, answered on a phone from inside its page; the ones that only
 * a desktop has — the DevTools protocol, the CLI's console capture — say so (`DesktopOnlyError`).
 */
function runOnPhone(args: string[], timeoutMs: number): string {
  const [command, ...rest] = args
  switch (command) {
    case 'vault': {
      const name = phoneEval('app.vault.getName()', timeoutMs)
      if (!name.startsWith('=> '))
        throw new ObsidianUnavailableError(`no vault open on the phone: ${name}`)
      return `name\t${name.slice(3)}`
    }
    case 'eval':
      return phoneEval(rest[0].replace(/^code=/, ''), timeoutMs)
    case 'plugin:reload': {
      const id = (rest[0] ?? 'id=abele').replace(/^id=/, '')
      return phoneEval(
        `(async () => { await app.plugins.disablePlugin(${JSON.stringify(id)}); await app.plugins.enablePlugin(${JSON.stringify(id)}); return 'ok' })()`,
        timeoutMs
      )
    }
    default:
      return desktopOnly(`obsidian ${command}`)
  }
}

/**
 * The CLI quotes some answers and not others, so the text is tried as it came and then with
 * the quotes taken off. The order matters for a string: `"one"` is already JSON, and stripped
 * it is not. So an expression answering with a numeric string (`String(5)`) comes back as the
 * number 5: return an object when the type matters.
 */
function parseJson<T>(raw: string): T {
  const candidates = [raw, raw.replace(/^'(.*)'$/s, '$1'), raw.replace(/^"(.*)"$/s, '$1')]
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T
    } catch {
      /* try the next spelling */
    }
  }
  throw new Error(`Could not parse eval result as JSON: ${raw.slice(0, 400)}`)
}

function evalReply<T>(output: string, id: string): { value: T; hasValue: boolean; logs: string } {
  for (const match of output.matchAll(/(?:^|\n)=> /g)) {
    try {
      const reply = JSON.parse(output.slice(match.index! + match[0].length).trim()) as {
        __abeleReply?: string
        hasValue: boolean
        value: T
      }
      if (reply.__abeleReply === id) return { ...reply, logs: output.slice(0, match.index).trim() }
    } catch {
      /* only a completed reply with the nonce is a result */
    }
  }
  throw new Error(`Could not parse eval result as JSON: ${output.slice(0, 400)}`)
}

/** The CLI pinned to one vault's window, by name, whatever `OBSIDIAN_TEST_VAULT` says. */
export interface VaultCli {
  /** The vault every call goes to, which is what `vault=` takes. */
  readonly name: string
  /** A command with its arguments, `vault=` put where it belongs. */
  run(args: string[], timeoutMs?: number): string
  /** Evaluates an expression and returns its `=> …` payload as text. */
  evalRaw(code: string, timeoutMs?: number): string
  /**
   * Evaluates an expression, awaits it, and parses the result as JSON.
   *
   * Everything is awaited, promise or not: much of what a test asks the app for is
   * asynchronous, and a promise stringifies to `{}`.
   */
  evalAwait<T>(expression: string, timeoutMs?: number): T
  /** For credential-bearing setup: failures never retain expression, raw output or cause. */
  evalAwaitPrivate<T>(expression: string, timeoutMs?: number): T
}

/**
 * The same calls as the rest of this module, against a vault named here rather than in the
 * environment — for a suite that opens a vault of its own beside the one the tier drives.
 * Every call keeps the tier's ceiling and its "not ready yet" retry.
 */
export function vaultCli(name: string): VaultCli {
  const cli: VaultCli = {
    name,
    run: (args, timeoutMs) => run(args, timeoutMs, false, name),
    evalRaw: (code, timeoutMs) => {
      const id = randomBytes(16).toString('hex')
      const wrapped = `(async () => {
        const value = await window.eval(${JSON.stringify(code)})
        const rendered = value === undefined ? null : value === null ? 'null' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
        return JSON.stringify({ __abeleReply: ${JSON.stringify(id)}, hasValue: value !== undefined, value: rendered })
      })()`
      const output = run(['eval', `code=${wrapped}`], timeoutMs, false, name, id)
      const reply = evalReply<string>(output, id)
      return reply.hasValue ? reply.value : reply.logs || '(no output)'
    },
    evalAwaitPrivate: <T>(expression: string, timeoutMs?: number): T => {
      try {
        return cli.evalAwait<T>(expression, timeoutMs)
      } catch {
        throw new Error('Sensitive Obsidian setup evaluation failed; diagnostic payload suppressed')
      }
    },
    evalAwait: <T>(expression: string, timeoutMs?: number): T => {
      const id = randomBytes(16).toString('hex')
      const wrapped = `(async () => {
        const value = await (${expression})
        return JSON.stringify({ __abeleReply: ${JSON.stringify(id)}, hasValue: value !== undefined, value })
      })()`
      const output = run(['eval', `code=${wrapped}`], timeoutMs, false, name, id)
      const reply = evalReply<T>(output, id)
      if (!reply.hasValue) throw new Error('Could not parse eval result as JSON: undefined')
      return reply.value
    },
  }
  return cli
}

/** A CLI command with its arguments, as they are passed — `dev:cdp`, say. */
export const runCli = (args: string[], timeoutMs?: number): string => run(args, timeoutMs)

/** True when the CLI exists and a vault is currently open. */
export function isObsidianRunning(): boolean {
  return obsidianUnavailableReason() === null
}

/**
 * Why there is no Obsidian to drive, or null when there is — for a skip message that says
 * what to fix rather than guessing at it.
 */
export function obsidianUnavailableReason(): string | null {
  try {
    run(['vault'], 15_000, true)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Name of the vault Obsidian currently has open. */
export function activeVaultName(): string {
  const output = run(['vault'], 15_000, true)
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
  return answerOf(run(['eval', `code=${code}`], timeoutMs))
}

/** Only reads and absolute setters/cleanup that remain safe if the first call ran. */
export function evalRawIdempotent(code: string, timeoutMs?: number): string {
  return answerOf(run(['eval', `code=${code}`], timeoutMs, true))
}

/**
 * The answer in what the CLI printed for an `eval`: the line that starts with `=>` and what
 * follows it. The page's console messages from while the eval ran come first, and one of them
 * can hold an arrow of its own — Obsidian logging a command it received, the code of an arrow
 * function in it — which, read as the answer, handed a test half of someone's script.
 */
export function answerOf(output: string): string {
  const marker = /^=>/m.exec(output)
  return marker ? output.slice(marker.index + 2).trim() : output
}

/**
 * `evalRaw` for a script that runs long — a probe walking through every dialog. It is started in
 * the page and asked after every second, so the worker is never blocked for longer than one short
 * call: a call that blocks it past a minute ends the whole run ("Timeout calling onTaskUpdate"),
 * and a single call is cut at `CALL_CEILING_MS` — the phone probe, walking every dialog of the
 * plugin, took longer than that on the desktop too.
 */
export async function evalLong(code: string, timeoutMs = 180_000): Promise<string> {
  // Choose the ID before sending the launch. A lost reply can then retry the same job,
  // never the action it contains (a tap, a write, or an async generator's next step).
  const id = 'job' + Date.now() + Math.random().toString(36).slice(2)
  // The transport owns the one bounded retry budget for this idempotent launch.
  const launched = evalRawIdempotent(
    `(() => {
      const id = ${JSON.stringify(id)}
      const jobs = (window.__e2eJobs = window.__e2eJobs || {})
      if (jobs[id]) return id
      jobs[id] = { done: false }
      // Started from a timer, after this call has answered: begun in a microtask it could run
      // on before the answer went out, and the call waited for the script it was only to start.
      new Promise((ready) => setTimeout(ready, 0))
        .then(() => (${code}))
        .then(
          (v) => { jobs[id] = { done: true, out: v === undefined ? '(no output)' : '=> ' + (typeof v === 'string' ? v : JSON.stringify(v, null, 2)) } },
          (e) => { jobs[id] = { done: true, out: 'Error: ' + String((e && e.message) || e) } }
        )
      return id
    })()`,
    30_000
  )
  if (launched.startsWith('Error:')) throw new Error(`Could not launch eval job: ${launched}`)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    await pauseAsync(1000)
    // Reading must not delete the result: the reply itself may be lost.
    const job = evalJsonIdempotent<{ done: boolean; out?: string } | null>(
      `(window.__e2eJobs || {})[${JSON.stringify(id)}] ?? null`,
      30_000
    )
    // Gone with the page: something in the script reloaded it.
    if (!job) throw new Error('the script was lost: the page reloaded while it ran')
    if (job.done) {
      // Acknowledge only after the worker has the answer. Cleanup is idempotent, and a
      // lost cleanup reply is not a failed probe; the page already has its result.
      try {
        evalRawIdempotent(
          `(() => { delete (window.__e2eJobs || {})[${JSON.stringify(id)}]; return 'removed' })()`,
          5_000
        )
      } catch (error) {
        if (!/gave no answer/.test(String(error))) throw error
      }
      const out = job.out ?? ''
      assertPhoneTransport(out)
      if (out.startsWith('Error: ')) throw new Error(out.slice(7))
      return out.startsWith('=> ') ? out.slice(3) : out
    }
    if (Date.now() > deadline) throw new Error(`the script did not finish in ${timeoutMs} ms`)
  }
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
  return parseEvalJson<T>(evalRaw(wrapped, timeoutMs))
}

export function evalJsonIdempotent<T>(expression: string, timeoutMs?: number): T {
  const wrapped = `JSON.stringify((() => { return (${expression}) })())`
  return parseEvalJson<T>(evalRawIdempotent(wrapped, timeoutMs))
}

function parseEvalJson<T>(raw: string): T {
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
    return evalJsonIdempotent<boolean>('typeof window.__abeleTest !== "undefined"', 30_000)
  } catch {
    return false
  }
}

/** Readiness is bounded, and a lost answer is not diagnosed as a missing development build. */
export async function waitForTestApi(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last = 'API absent'
  do {
    try {
      if (evalJsonIdempotent<boolean>('typeof window.__abeleTest !== "undefined"', 10_000)) return
      last = 'API absent'
    } catch (error) {
      if (!(error instanceof CliNoAnswerError)) throw error
      last = error.message
    }
    if (Date.now() >= deadline) break
    await pauseAsync(500)
  } while (Date.now() < deadline)
  throw new Error(
    `The e2e test API did not settle in ${timeoutMs} ms: ${last}. ` +
      (last === 'API absent' ? 'The e2e vault needs a development build with the test API.' : '')
  )
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
  // A phone's app is in front, on a screen that stays awake: nothing to throttle.
  if (onPhone()) return
  const code = `(() => { require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(${on}); return 'ok' })()`
  evalRawIdempotent(code, 30_000)
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
  // The phone's app is the one in front and has the focus for real.
  if (onPhone()) return
  run(
    ['dev:cdp', 'method=Emulation.setFocusEmulationEnabled', `params={"enabled":${on}}`],
    30_000,
    true
  )
}

/**
 * Obsidian's menus drawn in the page, as on Windows, Linux and a phone, rather than by macOS.
 * On a Mac Obsidian takes an unset "Native menus" for on, and every `Menu` then opens as the
 * system's own popup: nothing of it is in the page, so a test can neither see nor pick its items,
 * and a window that is not in front (a pool vault's, always) does not show it at all. The
 * setting is the vault's own, so only the driven window is touched; it is kept in the fixture.
 */
export function useDomMenus(): void {
  evalRawIdempotent(
    `(() => { if (app.vault.getConfig('nativeMenus') !== false) app.vault.setConfig('nativeMenus', false); return 'ok' })()`,
    30_000
  )
}

/**
 * Gets a window that is not being drawn drawn again, where it can be.
 *
 * Throttling off keeps a window drawing while nobody can see it, the Mac's screen locked or
 * asleep — but only a page that was showing when that happened. A page loaded while it lasts,
 * after a reload, starts hidden and stays so, at a frame or two a second, whatever the throttling
 * says, until the window is shown again (2026-09-27: every reload after the screen went off left
 * its window unable to draw, and a mermaid diagram waiting to be scrolled to was never drawn).
 * Shown without taking the focus, it is drawn again at once. Only a window that draws too few
 * frames is touched: showing puts it in front of the other windows.
 */
export function wakeWindow(): void {
  if (onPhone() || framesPerSecond() >= 15) return
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().showInactive(); return 'ok' })()`,
    30_000
  )
  sleepSync(500)
}

/** Stops the run with the reason when the window is not being drawn: see `framesPerSecond`. */
export function assertWindowDrawn(): void {
  wakeWindow()
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
 *
 * With no popout left in the workspace, any other window of the vault goes too. Obsidian closes a
 * popout whose last tab is gone on the next frame, and a window nobody can see — the screen
 * locked — gets none: the popout stays open, empty and hidden, through the rest of the tier
 * (2026-09-27, "Other" and "Gallery" from the popout widget test).
 */
export function closeStrayWindows(): number {
  // A phone has one window; settings is a dialog in it.
  if (onPhone())
    return evalJsonIdempotent<number>(
      `(() => { try { app.setting.close() } catch {} return 0 })()`,
      30_000
    )
  return evalJsonIdempotent<number>(
    `(() => {
      const remote = require('@electron/remote')
      const main = remote.getCurrentWindow()
      try { app.setting.close() } catch {}
      let closed = 0
      for (const w of remote.BrowserWindow.getAllWindows()) {
        if (w.id === main.id || w.isDestroyed()) continue
        // Obsidian titles a popout after its vault: "Settings - <vault> - Obsidian 1.x".
        const title = w.getTitle()
        const ours = title.includes(' - ' + app.vault.getName() + ' - ')
        const orphan = ours && app.workspace.floatingSplit.children.length === 0
        if ((ours && title.startsWith('Settings')) || orphan) {
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
 * Puts every note tab of the driven window, pop-outs included, back in the editor (live
 * preview), at the note it shows. A tab keeps the mode it was left in, and the lists under a note
 * live in the editor only: a file that left a tab in reading view handed the next one an editor
 * hidden behind it, still holding the lists of the note it showed before. Tabs not yet drawn
 * carry their mode in their saved state, which is where it is changed for them too.
 */
export function notesInEditor(): number {
  const out = evalRawIdempotent(
    `(async () => {
      let changed = 0
      for (const leaf of app.workspace.getLeavesOfType('markdown')) {
        const vs = leaf.getViewState()
        if (vs.state?.mode !== 'preview') continue
        await leaf.setViewState({ ...vs, state: { ...vs.state, mode: 'source', source: false } })
        changed++
      }
      return changed
    })()`,
    30_000
  )
  return Number(out) || 0
}

/**
 * Waits until Obsidian has resolved every note's links. After an app reload — which every
 * `emulateMobile` switch is — the link index fills in over several seconds while the
 * metadata is already there, so a file running right after one saw a group of 442 notes as 6.
 * And until the workspace's layout is ready too: the plugin is back, and the test API with it,
 * before the layout is, and a file opening a tab in that moment was told "No tab group found".
 */
export function waitForLinkIndex(timeoutMs = 120_000): void {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const settled = evalJsonIdempotent<boolean>(
      `(() => {
        const m = app.metadataCache
        const q = m.linkResolverQueue
        const pending = q ? (q.items?.size ?? q.items?.length ?? 0) : 0
        const running = !!q?.runnable?.running
        return app.workspace.layoutReady && m.initialized && !pending && !running &&
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
/** Only for an abandoned acquisition that died before recording its live owner. */
const RELOAD_LOCK_STALE_MS = 120_000

const pauseAsync = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function takeReloadLock(): Promise<void> {
  const deadline = Date.now() + 5 * 60_000
  for (;;) {
    try {
      mkdirSync(RELOAD_LOCK)
      writeFileSync(join(RELOAD_LOCK, String(process.pid)), '')
      return
    } catch {
      try {
        // A slow CLI retry must not let another window steal the shared-key lock.
        const owners = readdirSync(RELOAD_LOCK)
        if (owners.length === 1 && /^\d+$/.test(owners[0])) {
          try {
            process.kill(Number(owners[0]), 0)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
              unlinkSync(join(RELOAD_LOCK, owners[0]))
              rmdirSync(RELOAD_LOCK)
            }
          }
        } else if (
          !owners.length &&
          Date.now() - statSync(RELOAD_LOCK).mtimeMs > RELOAD_LOCK_STALE_MS
        )
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
export async function reloadApp(
  how = 'location.reload()',
  launch: typeof evalRaw = evalRaw
): Promise<void> {
  if (onPhone()) return reloadPhone()
  const asked = /emulateMobile\((true|false)\)/.exec(how)?.[1]
  if (asked === 'true') rememberDesktop()
  await reloadWindow(asked, launch)
  if (asked === 'false') putDesktopBack()
}

/**
 * The window's desktop size, kept on disk from the moment a file turns it into a phone until it
 * is a desktop again at that size.
 *
 * Every phone file resized the window to 390×844 and put it back in its own `afterAll`, from a
 * size it had read in `beforeAll`. A run killed half way never got there, and neither did one
 * whose `afterAll` failed before the resize — and the next file then read 390×844 as the size
 * to go back to, so the window stayed a phone for good (2026-09-29, pool windows found at phone
 * size by several runs). Kept here, the size outlives the run that wrote it: `reloadApp` puts it
 * back whenever the window leaves the phone, and `restoreDesktopWindow` at the start and end of
 * every run puts back whatever a dead run left.
 */
const desktopRecord = () =>
  join(tmpdir(), `abele-e2e-desktop-${(TARGET_VAULT || 'front').replace(/[^\w.-]/g, '_')}.json`)

const contentSize = (): [number, number] =>
  evalJsonIdempotent<[number, number]>(
    `require('@electron/remote').getCurrentWindow().getContentSize()`
  )

const setContentSize = (width: number, height: number): void => {
  evalRawIdempotent(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
}

/** Narrower than any desktop window a file drives, wider than any phone or tablet it plays. */
const PHONE_SIZED = 900
/** For a window found as a phone with no record of what it was: a desktop that fits a laptop. */
const DEFAULT_DESKTOP: [number, number] = [1280, 800]

function rememberDesktop(): void {
  // The first record stands: a second phone in the same run must not take the first one's size.
  if (existsSync(desktopRecord())) return
  const [width, height] = contentSize()
  const size =
    evalJsonIdempotent<boolean>('app.isMobile') || width < PHONE_SIZED
      ? DEFAULT_DESKTOP
      : [width, height]
  writeFileSync(desktopRecord(), JSON.stringify(size))
}

function putDesktopBack(): void {
  if (!existsSync(desktopRecord())) return
  const [width, height] = JSON.parse(readFileSync(desktopRecord(), 'utf8')) as [number, number]
  setContentSize(width, height)
  rmSync(desktopRecord(), { force: true })
}

/**
 * Puts the window back to a desktop at its desktop size, if a run before this one left it a
 * phone or at a phone's size. For the start and the end of a run; a no-op on a real phone.
 */
export async function restoreDesktopWindow(): Promise<void> {
  if (onPhone()) return
  if (evalJsonIdempotent<boolean>('app.isMobile')) {
    rememberDesktop()
    await reloadWindow('false')
  }
  if (!existsSync(desktopRecord()) && contentSize()[0] < PHONE_SIZED)
    writeFileSync(desktopRecord(), JSON.stringify(DEFAULT_DESKTOP))
  putDesktopBack()
}

const RELOAD_REQUEST = 'abele-e2e-reload-request'

function readReloadWitness(): ReloadWitness {
  return evalJsonIdempotent<ReloadWitness>(
    `({ owner: app.vault.getName() + ':' + require('@electron/remote').getCurrentWindow().id,
      generation: performance.timeOrigin, requestId: sessionStorage.getItem('${RELOAD_REQUEST}'),
      mobile: !!app.isMobile, apiReady: !!window.__abeleTest, layoutReady: !!app.workspace.layoutReady })`,
    10_000
  )
}

async function reloadWindow(
  asked: string | undefined,
  launch: typeof evalRaw = evalRaw
): Promise<void> {
  await takeReloadLock()
  const requestId = 'reload-' + Date.now() + '-' + Math.random().toString(36).slice(2)
  let owner: string | undefined
  let failure: unknown
  let cleanupFailure: unknown
  try {
    // A just-detached fixture pane still exists in the debounced saved layout. Reloading
    // that layout resurrects it, even though the file's own teardown closed it correctly.
    evalRawIdempotent(
      `(async () => { await app.workspace.requestSaveLayout.run(); return 'saved' })()`,
      30_000
    )
    const before = readReloadWitness()
    owner = before.owner
    const outcome = await confirmReload(
      before,
      requestId,
      asked === undefined ? before.mobile : asked === 'true',
      {
        request: () =>
          launch(
            `(() => {
        const asked = ${asked === undefined ? 'null' : `'${asked === 'true' ? '1' : ''}'`}
        if (asked !== null) sessionStorage.setItem('${MOBILE_WISH}', asked)
        const wish = sessionStorage.getItem('${MOBILE_WISH}') ?? (app.isMobile ? '1' : '')
        if (wish) localStorage.setItem('${MOBILE_KEY}', '1')
        else localStorage.removeItem('${MOBILE_KEY}')
        sessionStorage.setItem('${RELOAD_REQUEST}', ${JSON.stringify(requestId)})
        setTimeout(() => location.reload(), 50)
        return ${JSON.stringify(requestId)}
      })()`,
            30_000
          ).replace(/^['"]|['"]$/g, ''),
        read: readReloadWitness,
        pause: pauseAsync,
        now: Date.now,
      },
      60_000
    )
    console.info('[abele e2e] reload witness', JSON.stringify({ before, ...outcome }))
  } catch (error) {
    failure = error
    throw error
  } finally {
    try {
      // Even a failed readiness gate must not leave phone emulation shared with other windows.
      if (owner) {
        const cleaned = evalRawIdempotent(
          `(() => {
            const owner = app.vault.getName() + ':' + require('@electron/remote').getCurrentWindow().id
            if (owner !== ${JSON.stringify(owner)}) return 'foreign-owner-not-touched'
            localStorage.removeItem('${MOBILE_KEY}')
            if (sessionStorage.getItem('${RELOAD_REQUEST}') === ${JSON.stringify(requestId)}) sessionStorage.removeItem('${RELOAD_REQUEST}')
            return 'ok'
          })()`,
          30_000
        )
        if (cleaned.includes('foreign-owner-not-touched'))
          cleanupFailure = new Error('Reload cleanup refused a foreign window')
      }
    } catch (cleanupError) {
      // A later read failure cannot replace the primary uncertain-reload diagnosis.
      cleanupFailure = cleanupError
      if (failure)
        console.warn('[abele e2e] reload cleanup failed after primary error', cleanupError)
    } finally {
      unlinkSync(join(RELOAD_LOCK, String(process.pid)))
      rmdirSync(RELOAD_LOCK)
    }
  }
  if (cleanupFailure) throw cleanupFailure
  setBackgroundThrottling(false)
  wakeWindow()
}

/**
 * A reload on a phone: it is a phone already, so `emulateMobile(true|false)` is just a reload —
 * a desktop is not something a phone can become. Waits for the plugin, then puts back the page
 * side of the phone harness, which the reload took with it (`installPhoneHost`).
 */
async function reloadPhone(): Promise<void> {
  evalRaw(`(() => { setTimeout(() => location.reload(), 50); return 'ok' })()`, 30_000)
  await pauseAsync(3000)
  const deadline = Date.now() + 90_000
  while (!hasTestApi()) {
    if (Date.now() > deadline)
      throw new Error('the plugin did not come back on the phone after a reload')
    await pauseAsync(1000)
  }
  installPhoneHost()
}
