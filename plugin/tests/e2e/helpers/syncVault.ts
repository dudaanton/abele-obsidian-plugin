/**
 * A throwaway vault in the running Obsidian, with this branch's build installed in it.
 *
 * The other e2e files drive whichever vault the developer already has open. This one cannot:
 * it pairs a device with a sync server and writes files into it, and doing that to somebody's
 * notes is not a thing a test may do. So it makes a vault of its own, opens it in the running
 * app, drives it, and takes it away again.
 *
 * Two things about opening it are worth knowing, because both cost an afternoon to find out:
 *
 * - `open obsidian://open?path=…` on a folder Obsidian has never heard of does **not** open
 *   it. The main process answers with `dialog.showErrorBox('Vault not found.', …)`, which is a
 *   modal run on the main thread — the whole application stops, the CLI socket stops with it,
 *   and nothing but a person clicking OK brings it back. The vault is opened through the same
 *   IPC message the vault switcher sends instead: `vault-open`, evaluated in a window that is
 *   already open, which registers the folder and opens it with no dialog at all.
 * - A vault holding community plugins opens in Restricted Mode behind "Do you trust the author
 *   of this vault?". That one is an ordinary in-app modal, so the CLI still answers, and
 *   `plugins:restrict off` takes it away and reloads the vault with the plugin running.
 *
 * `vault=` goes first in every call. The CLI reads it as an option, and after the command it
 * is taken for one of the command's own arguments — a test that did that would drive whatever
 * window the developer last clicked on.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Thrown when there is no Obsidian to drive; the suite skips on it. */
export class ObsidianUnavailableError extends Error {}

const CLI = process.env.OBSIDIAN_CLI ?? '/usr/local/bin/obsidian'
/** `plugin/`, four levels up from `plugin/tests/e2e/helpers`. */
const PLUGIN_DIR = fileURLToPath(new URL('../../..', import.meta.url))
const BUILD_DIR = join(PLUGIN_DIR, 'build')
const MANIFEST = join(PLUGIN_DIR, '..', 'manifest.json')
/** How long a build of the plugin may take when there is nothing in `build/` to use. */
const BUILD_MS = 10 * 60_000
/** How long a window has to appear, load the plugin, and answer for itself. */
const OPEN_MS = 90_000

export interface TestVault {
  /** What Obsidian calls it, which is what `vault=` takes: the folder's name. */
  name: string
  /** Where it is on disk. */
  path: string
  /** One CLI call against this vault, with `vault=` where it belongs. */
  cli(args: string[], timeoutMs?: number): string
  /** Evaluates an expression in the vault's window and returns its `=> …` payload as text. */
  evalRaw(code: string, timeoutMs?: number): string
  /**
   * Evaluates an expression, awaits it, and parses the result as JSON.
   *
   * Everything is awaited, promise or not, because most of what this suite asks the plugin
   * for is asynchronous and a promise stringifies to `{}`.
   */
  evalJson<T>(expression: string, timeoutMs?: number): T
  /** Closes the window and takes the vault off disk and out of Obsidian's vault list. */
  dispose(): void
}

/** True when the CLI is there and some vault window answers for itself. */
export function obsidianRunning(): boolean {
  try {
    hostVaultName()
    return true
  } catch {
    return false
  }
}

/**
 * The name of a vault that is open right now, to send the `vault-open` message from.
 *
 * A window is needed because the message is one a renderer sends; which window it is does not
 * matter, and nothing is written to whatever vault it holds.
 */
export function hostVaultName(): string {
  const output = run([], ['vault'], 20_000)
  const line = output.split('\n').find((l) => l.startsWith('name'))
  const name = line ? line.split('\t').slice(1).join('\t').trim() : ''
  if (name === '') throw new ObsidianUnavailableError('no vault is open in Obsidian')
  return name
}

/**
 * A vault nobody else is using, with the plugin in it, open and loaded.
 *
 * `ignore` is written before the vault is ever opened: the config folder holds the sixteen
 * megabytes of `main.js` this very function copied in, and a device that synced that would
 * spend the suite's whole budget uploading the plugin to itself.
 */
export function openTestVault(): TestVault {
  const host = hostVaultName()
  buildIfStale()

  const path = join(homedir(), `abele-sync-e2e-${randomBytes(4).toString('hex')}`)
  const name = basename(path)
  const pluginDir = join(path, '.obsidian/plugins/abele')
  mkdirSync(pluginDir, { recursive: true })
  copyFileSync(join(BUILD_DIR, 'main.js'), join(pluginDir, 'main.js'))
  copyFileSync(join(BUILD_DIR, 'main.css'), join(pluginDir, 'styles.css'))
  copyFileSync(MANIFEST, join(pluginDir, 'manifest.json'))
  writeFileSync(join(path, '.obsidian/community-plugins.json'), '["abele"]\n')
  writeFileSync(join(path, '.abele-sync-ignore'), '.obsidian/\n')

  const opened = run(
    [`vault=${host}`],
    [
      'eval',
      `code=window.electron.ipcRenderer.sendSync("vault-open", ${JSON.stringify(path)}, false)`,
    ]
  )
  if (!opened.includes('true')) {
    rmSync(path, { recursive: true, force: true })
    throw new Error(`Obsidian would not open ${path}: ${opened}`)
  }

  const vault: TestVault = {
    name,
    path,
    cli: (args, timeoutMs) => run([`vault=${name}`], args, timeoutMs),
    evalRaw: (code, timeoutMs) => {
      const output = run([`vault=${name}`], ['eval', `code=${code}`], timeoutMs)
      const marker = output.indexOf('=>')
      return marker === -1 ? output : output.slice(marker + 2).trim()
    },
    evalJson: <T>(expression: string, timeoutMs?: number): T => {
      const raw = vault.evalRaw(`(async () => JSON.stringify(await (${expression})))()`, timeoutMs)
      return parseJson<T>(raw)
    },
    dispose: () => dispose(vault),
  }

  // Evaluated, not asked: `vault info=name` is answered from the vault list the moment the
  // folder is registered, which is well before there is a window to run anything in. An
  // expression that comes back with its own answer is the only proof the renderer is up.
  waitFor('the vault window to answer', () => alive(vault))

  // A vault holding community plugins opens in Restricted Mode, behind "Do you trust the
  // author of this vault?". Turning it off loads the plugins into the window that is up and
  // *then* reloads that window — so the test API appears for a second on a renderer that is
  // about to be thrown away. The mark is what tells the two windows apart: it is gone only
  // once the reload has happened, and waiting for the plugin without it hands the suite a
  // window that stops answering a moment later.
  if (vault.cli(['plugins:restrict'], 20_000).trim() === 'on') {
    vault.evalRaw('window.__abeleReloadMark = 1', 20_000)
    vault.cli(['plugins:restrict', 'off'], 60_000)
  }
  waitFor('the vault to reload with the plugin running', () => {
    try {
      return (
        vault.evalRaw(
          'String(typeof window.__abeleReloadMark === "undefined" && typeof window.__abeleTest === "object")',
          20_000
        ) === 'true'
      )
    } catch {
      return false
    }
  })

  return vault
}

/**
 * Waits for something to become true, or says what it was waiting for when it never did.
 *
 * Polled rather than awaited: everything here is a separate process answering a separate
 * question, and there is no event to subscribe to from outside the app.
 */
export function waitFor(what: string, done: () => boolean, timeoutMs = OPEN_MS): void {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (done()) return
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`)
    sleepSync(500)
  }
}

/**
 * Whether a window for this vault is up and running expressions.
 *
 * The CLI answers an unroutable command with a message on standard output and an exit code of
 * zero, so a call that "worked" proves nothing; the value coming back is what proves it.
 */
function alive(vault: TestVault): boolean {
  try {
    return vault.evalRaw('1 + 1', 10_000) === '2'
  } catch {
    return false
  }
}

/**
 * Closes the window, forgets the vault, and removes the folder.
 *
 * Closing is asked for more than once and confirmed by silence held: a window reloading —
 * which is what turning Restricted Mode off does — stops answering for a second or two and
 * would otherwise be taken for one that had gone. Removing the folder under a window that is
 * still up is the failure this guards against: Obsidian writes its `.obsidian` back out and
 * the directory is there again a moment after it was deleted.
 */
function dispose(vault: TestVault): void {
  let closed = false
  for (let attempt = 0; attempt < 3 && !closed; attempt++) {
    try {
      // Closed on a timer, not in the call itself. `eval code=window.close()` tears the
      // context down while the CLI is still waiting on that very request, and the window
      // then hangs half closed with nothing to answer for it. Asking for the close a moment
      // after the call has been answered leaves nothing in flight to deadlock on.
      vault.evalRaw('setTimeout(() => window.close(), 250), "closing"', 15_000)
    } catch {
      /* already closed, or closing */
    }
    closed = goneFor(vault, 3)
  }
  // Left open rather than destroyed: `electronWindow.destroy()` takes the whole application
  // down with it — Obsidian 1.12.7 segfaults in the main process — which is a great deal
  // worse for whoever is using this machine than one window they can close themselves.
  if (!closed) console.warn(`the window on ${vault.name} would not close`)
  // Three goes, in case a window that is still up writes its config out after the first.
  for (let attempt = 0; attempt < 3 && existsSync(vault.path); attempt++) {
    rmSync(vault.path, { recursive: true, force: true })
    sleepSync(1_000)
  }
  // Last, because a window that is still open has Obsidian writing the vault list out again.
  forgetVault(vault.path)
}

/**
 * True when the window has failed to answer `rounds` times in a row, a second apart.
 *
 * The wait comes first: the close is asked for on a timer, and a window looked at the
 * instant after has not had the chance to go yet.
 */
function goneFor(vault: TestVault, rounds: number): boolean {
  for (let round = 0; round < rounds; round++) {
    sleepSync(1_000)
    if (alive(vault)) return false
  }
  return true
}

/**
 * Takes the vault out of `obsidian.json`, so no switcher offers a folder that is gone.
 *
 * Read, change, write — which is what Obsidian itself does to that file, and only this
 * vault's own entry is touched. Obsidian keeps the list in memory as well and may write it
 * back out; a stale entry is harmless, so a failure here is not worth a test.
 */
function forgetVault(path: string): void {
  const file = join(homedir(), 'Library/Application Support/obsidian/obsidian.json')
  try {
    const registry = JSON.parse(readFileSync(file, 'utf8')) as {
      vaults: Record<string, { path: string }>
    }
    let changed = false
    for (const [id, entry] of Object.entries(registry.vaults)) {
      if (entry.path === path) {
        delete registry.vaults[id]
        changed = true
      }
    }
    if (changed) writeFileSync(file, JSON.stringify(registry))
  } catch {
    /* another platform, or Obsidian writing at the same moment */
  }
}

/**
 * Builds the plugin when `build/` is missing or older than the source it came from.
 *
 * The suite installs what is in `build/`, so a stale bundle would be a test of last week's
 * plugin — and the surest way to spend an hour on a failure that was fixed already.
 */
function buildIfStale(): void {
  const main = join(BUILD_DIR, 'main.js')
  const built = existsSync(main) ? statSync(main).mtimeMs : 0
  if (built > newestSourceMs()) return
  const done = spawnSync('npm', ['run', 'build:test'], {
    cwd: PLUGIN_DIR,
    encoding: 'utf8',
    timeout: BUILD_MS,
  })
  if (done.status !== 0) throw new Error(`npm run build:test failed: ${done.stderr || done.stdout}`)
  if (!existsSync(main)) throw new Error(`the build left no ${main}`)
}

function newestSourceMs(): number {
  let newest = 0
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else newest = Math.max(newest, statSync(full).mtimeMs)
    }
  }
  walk(join(PLUGIN_DIR, 'src'))
  return newest
}

function run(prefix: string[], args: string[], timeoutMs = 120_000): string {
  const fullArgs = [...prefix, ...args]
  try {
    return execFileSync(CLI, fullArgs, {
      encoding: 'utf8',
      timeout: timeoutMs,
      // SIGTERM leaves the CLI alive and the suite waiting for ever: the binary does not
      // stop on it, and a timeout that cannot kill what it timed out on is not a timeout.
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024 * 1024,
    }).trim()
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string }
    if (err.code === 'ENOENT')
      throw new ObsidianUnavailableError(`Obsidian CLI not found at ${CLI}`)
    const detail = (err.stderr || err.stdout || err.message || '').toString().trim()
    throw new Error(`obsidian ${fullArgs.join(' ')} failed: ${detail}`)
  }
}

/** The CLI quotes some answers and not others, so both spellings are tried. */
function parseJson<T>(raw: string): T {
  const candidates = [raw, raw.replace(/^'(.*)'$/s, '$1'), raw.replace(/^"(.*)"$/s, '$1')]
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T
    } catch {
      /* try the next spelling */
    }
  }
  throw new Error(`could not parse eval result as JSON: ${raw.slice(0, 400)}`)
}

/**
 * Sleeps without yielding, so a poll loop can be written as a plain function.
 *
 * Every wait here is on another process, and the alternative — making the whole helper
 * asynchronous for the sake of a 500ms pause — would buy the suite nothing.
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
