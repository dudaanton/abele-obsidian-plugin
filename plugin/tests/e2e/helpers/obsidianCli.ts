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

function run(args: string[], timeoutMs = 240_000): string {
  // `vault=` MUST precede the command. Passed after it the CLI ignores it without an error
  // and runs against whichever window is frontmost, so the tests would silently measure
  // whatever vault the user happened to be looking at.
  const fullArgs = TARGET_VAULT ? [`vault=${TARGET_VAULT}`, ...args] : args
  try {
    return execFileSync(CLI, fullArgs, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    }).trim()
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string }
    if (err.code === 'ENOENT') {
      throw new ObsidianUnavailableError(`Obsidian CLI not found at ${CLI}`)
    }
    const detail = (err.stderr || err.stdout || err.message || '').toString().trim()
    throw new Error(`obsidian ${fullArgs.join(' ')} failed: ${detail}`)
  }
}

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
 * `timeoutMs` is generous by default because these tests deliberately trigger
 * multi-second main-thread stalls.
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
