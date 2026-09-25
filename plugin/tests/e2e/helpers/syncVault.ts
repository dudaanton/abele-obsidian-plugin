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
 * Every call goes through `vaultCli`, which puts `vault=` first — after the command the CLI
 * takes it for one of the command's own arguments, and a test that did that would drive
 * whatever window the developer last clicked on — and keeps the tier's per-call ceiling.
 */
import { randomBytes } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { activeVaultName, obsidianUnavailableReason, vaultCli, type VaultCli } from './obsidianCli'
import { delay, siblingPath } from './syncServer'

/** `plugin/`, four levels up from `plugin/tests/e2e/helpers`. */
const PLUGIN_DIR = fileURLToPath(new URL('../../..', import.meta.url))
const BUILD_DIR = join(PLUGIN_DIR, 'build')
const MANIFEST = join(PLUGIN_DIR, '..', 'manifest.json')
/**
 * Where test vaults live on this machine, one folder each, the folder's name being the vault's.
 * Only folders this module made — `abele-sync-e2e-` and a random suffix — are ever removed.
 */
const VAULTS_DIR = join(homedir(), 'obsidian')
const PREFIX = 'abele-sync-e2e-'
/** How long a window has to appear, load the plugin, and answer for itself. */
const OPEN_MS = 90_000
/** How long a closed window has to be gone from the app's window list. */
const CLOSE_MS = 15_000
/** The core plugins a new vault gets in Obsidian 1.12, with Obsidian Sync switched off. */
const CORE_PLUGINS: Record<string, boolean> = {
  'file-explorer': true,
  'global-search': true,
  switcher: true,
  graph: true,
  backlink: true,
  canvas: true,
  'outgoing-link': true,
  'tag-pane': true,
  footnotes: false,
  properties: true,
  'page-preview': true,
  'daily-notes': true,
  templates: true,
  'note-composer': true,
  'command-palette': true,
  'slash-command': false,
  'editor-status': true,
  bookmarks: true,
  'markdown-importer': false,
  'zk-prefixer': false,
  'random-note': false,
  outline: true,
  'word-count': true,
  slides: false,
  'audio-recorder': false,
  workspaces: false,
  'file-recovery': true,
  publish: false,
  sync: false,
  bases: true,
  webviewer: false,
}

export interface TestVault extends VaultCli {
  /** Where it is on disk. */
  path: string
  /** Closes the window and takes the vault off disk and out of Obsidian's vault list. */
  dispose(): Promise<void>
}

/** Why there is no Obsidian to open a vault in, or null when there is. */
export function obsidianMissing(): string | null {
  const reason = obsidianUnavailableReason()
  if (reason !== null) return `Obsidian is not answering its CLI: ${reason}`
  return hostVaultName() === '' ? 'Obsidian has no vault open to open another from' : null
}

/**
 * The name of a vault that is open right now, to send the `vault-open` message from.
 *
 * A window is needed because the message is one a renderer sends; which window it is does not
 * matter, and nothing is written to whatever vault it holds. It is `OBSIDIAN_TEST_VAULT` when
 * that is set, and otherwise whichever window is in front.
 */
function hostVaultName(): string {
  try {
    return activeVaultName()
  } catch {
    return ''
  }
}

/**
 * What is wrong with `build/` for this suite, or null when it can be installed as it is.
 *
 * The suite installs what is in `build/`, so a stale bundle would be a test of last week's
 * plugin. Three ways it can be stale: older than `src/`; older than the sibling's `core` or
 * `protocol` `dist`, which the bundle inlines; or a production build, which shares the output
 * folder and has no test API — installed, it looks exactly like a plugin that never loaded.
 * Nothing is built here: a build takes minutes, and a test worker silent for one is killed.
 */
export function buildProblem(): string | null {
  const main = join(BUILD_DIR, 'main.js')
  const fix = 'run `npm run build:test` in plugin/ first'
  if (!existsSync(main)) return `there is no ${main}; ${fix}`
  // The other two files the vault is given. Checked here, before a folder exists, so a missing
  // one refuses the suite rather than leaving a half-made vault behind.
  for (const needed of [join(BUILD_DIR, 'main.css'), MANIFEST]) {
    if (!existsSync(needed)) return `there is no ${needed}; ${fix}`
  }
  const built = statSync(main).mtimeMs
  const newest = Math.max(
    newestMs(join(PLUGIN_DIR, 'src')),
    newestMs(join(siblingPath, 'packages/core/dist')),
    newestMs(join(siblingPath, 'packages/protocol/dist'))
  )
  if (built < newest) return `${main} is older than the source it is built from; ${fix}`
  if (!readFileSync(main, 'utf8').includes('__abeleTest'))
    return `${main} is a production build, with no test API in it; ${fix}`
  return null
}

/**
 * A vault nobody else is using, with the plugin in it, open and loaded.
 *
 * `ignore` is written before the vault is ever opened: the config folder holds the sixteen
 * megabytes of `main.js` this very function copied in, and a device that synced that would
 * spend the suite's whole budget uploading the plugin to itself.
 */
export async function openTestVault(): Promise<TestVault> {
  const problem = buildProblem()
  if (problem !== null) throw new Error(problem)
  const host = vaultCli(hostVaultName())
  if (host.name === '') throw new Error('Obsidian has no vault open to open another from')

  const path = join(VAULTS_DIR, `${PREFIX}${randomBytes(4).toString('hex')}`)
  const pluginDir = join(path, '.obsidian/plugins/abele')
  // Nothing is registered with Obsidian yet, so a copy that fails takes only the folder with it.
  try {
    mkdirSync(pluginDir, { recursive: true })
    copyFileSync(join(BUILD_DIR, 'main.js'), join(pluginDir, 'main.js'))
    copyFileSync(join(BUILD_DIR, 'main.css'), join(pluginDir, 'styles.css'))
    copyFileSync(MANIFEST, join(pluginDir, 'manifest.json'))
    writeFileSync(join(path, '.obsidian/community-plugins.json'), '["abele"]\n')
    writeFileSync(join(path, '.abele-sync-ignore'), '.obsidian/\n')
    // Menus drawn in the page rather than by macOS: a native menu is nothing the page can see
    // or click, and the history dialog is opened from the file list's context menu.
    writeFileSync(join(path, '.obsidian/app.json'), '{ "nativeMenus": false }\n')
    // Obsidian's own Sync off. It puts an item called "Open version history" in the same menu,
    // and the suite must press the plugin's. The rest is what a new vault gets by default — the
    // file is read whole, so a core plugin left out of it would be switched off too.
    writeFileSync(join(path, '.obsidian/core-plugins.json'), JSON.stringify(CORE_PLUGINS, null, 2))
  } catch (error) {
    removeFolder(path)
    throw error
  }

  let windowId: number | null = null
  const vault: TestVault = {
    ...vaultCli(basename(path)),
    path,
    dispose: () => dispose(host, vault, windowId),
  }

  let opened = ''
  try {
    opened = host.evalRaw(
      `window.electron.ipcRenderer.sendSync("vault-open", ${JSON.stringify(path)}, false)`,
      20_000
    )
  } catch (error) {
    opened = String(error)
  }
  if (opened !== 'true') {
    // It may have been registered even so; the folder and the entry go either way.
    removeFolder(path)
    forgetVault(host, path)
    throw new Error(`Obsidian would not open ${path}: ${opened}`)
  }

  // From here on the vault is in the app, and a failure that did not take it away again would
  // leave a window, sixteen megabytes and a vault-list entry behind with nobody to dispose of
  // them — the caller never got the vault to do it with.
  try {
    // Evaluated, not asked: `vault info=name` is answered from the vault list the moment the
    // folder is registered, which is well before there is a window to run anything in. An
    // expression that comes back with its own answer is the only proof the renderer is up.
    await waitFor('the vault window to answer', () => alive(vault))

    // A vault holding community plugins opens in Restricted Mode, behind "Do you trust the
    // author of this vault?". Turning it off loads the plugins into the window that is up and
    // *then* reloads that window — so the test API appears for a second on a renderer that is
    // about to be thrown away. The mark is what tells the two windows apart: it is gone only
    // once the reload has happened, and waiting for the plugin without it hands the suite a
    // window that stops answering a moment later.
    if (vault.run(['plugins:restrict'], 20_000).trim() === 'on') {
      vault.evalRaw('window.__abeleReloadMark = 1', 20_000)
      vault.run(['plugins:restrict', 'off'], 30_000)
    }
    await waitFor('the vault to reload with the plugin running', () => {
      try {
        return (
          vault.evalRaw(
            'String(typeof window.__abeleReloadMark === "undefined" && typeof window.__abeleTest === "object")',
            10_000
          ) === 'true'
        )
      } catch {
        return false
      }
    })

    // The window's id, which a reload keeps, so the close can be asked for from outside it.
    // And throttling off: this window opens behind whatever the person is working in, and a
    // background renderer runs its timers late — the engine's debounce and the dialogs' own
    // timers included.
    windowId = Number(
      vault.evalRaw(
        `(() => {
          const remote = require('@electron/remote')
          remote.getCurrentWebContents().setBackgroundThrottling(false)
          return String(remote.getCurrentWindow().id)
        })()`,
        10_000
      )
    )
  } catch (error) {
    await dispose(host, vault, windowId)
    throw error
  }

  return vault
}

/**
 * Waits for something to become true, or says what it was waiting for when it never did.
 *
 * Polled rather than awaited — everything here is a separate process answering a separate
 * question, and there is no event to subscribe to from outside the app — but polled with an
 * `await` between tries, so the test worker answers the runner while it waits. `what` may be a
 * function, for a message that says what was seen last rather than what was seen first.
 */
export async function waitFor(
  what: string | (() => string),
  done: () => boolean,
  timeoutMs = OPEN_MS
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (done()) return
    if (Date.now() > deadline) {
      const said = typeof what === 'string' ? what : what()
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${said}`)
    }
    await delay(500)
  }
}

/**
 * Whether a window for this vault is up and running expressions.
 *
 * The CLI answers an unroutable command with a message on standard output and an exit code of
 * zero, so a call that "worked" proves nothing; the value coming back is what proves it.
 */
function alive(vault: VaultCli): boolean {
  try {
    return vault.evalRaw('1 + 1', 10_000) === '2'
  } catch {
    return false
  }
}

/**
 * Closes the window, forgets the vault, and removes the folder.
 *
 * The close is asked for from the host window, not from inside the test one: evaluated in
 * the window that is closing, `window.close()` tears the context down while the CLI is still
 * waiting on that very request, and on a timer it waits on a background renderer's timers.
 * From outside there is nothing in flight in the closing renderer, and "gone" is read from the
 * app's own window list rather than inferred from silence. Popouts of the vault — a settings
 * window, say — are told by the vault's random name in their title and go with it.
 *
 * Never `destroy()`: Obsidian 1.12.7 segfaults in the main process on it and the whole
 * application goes down, which is a great deal worse for whoever is using this machine than
 * one window they can close themselves.
 */
async function dispose(host: VaultCli, vault: TestVault, windowId: number | null): Promise<void> {
  const windows = `(() => {
    const remote = require('@electron/remote')
    return remote.BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() &&
      (w.id === ${JSON.stringify(windowId)} || w.getTitle().includes(${JSON.stringify(vault.name)})))
  })()`
  const open = (): number => {
    try {
      return Number(host.evalRaw(`String(${windows}.length)`, 10_000))
    } catch {
      return -1
    }
  }
  let closed = false
  for (let attempt = 0; attempt < 3 && !closed; attempt++) {
    try {
      host.evalRaw(`${windows}.forEach((w) => w.close()), "closing"`, 10_000)
    } catch {
      /* the host is busy; the next attempt asks again */
    }
    try {
      await waitFor('the window to close', () => open() === 0, CLOSE_MS)
      closed = true
    } catch {
      /* asked again below */
    }
  }
  if (!closed) {
    // Left exactly as it is. With the window open, Obsidian writes `.obsidian` back out a moment
    // after the folder goes and refuses to take the vault off its list, so removing anything now
    // would leave a stub folder and a list entry instead of one vault a person can close.
    console.warn(
      `the window on ${vault.name} would not close, so ${vault.path} is left in place: ` +
        'close that window, remove the vault from the vault switcher, then delete the folder'
    )
    return
  }
  // Removed only once the window is gone, or Obsidian writes `.obsidian` back out a moment
  // after the folder was deleted. Three goes, in case one did anyway.
  for (let attempt = 0; attempt < 3 && existsSync(vault.path); attempt++) {
    removeFolder(vault.path)
    await delay(1_000)
  }
  // Last, because a window that is still open has Obsidian writing the vault list out again.
  forgetVault(host, vault.path)
}

/** Removes a vault folder this module made, and refuses anything else. */
function removeFolder(path: string): void {
  if (dirname(path) !== VAULTS_DIR || !basename(path).startsWith(PREFIX)) {
    throw new Error(`refusing to remove ${path}: not a vault this suite made`)
  }
  rmSync(path, { recursive: true, force: true })
}

/**
 * Takes the vault out of Obsidian's vault list, so no switcher offers a folder that is gone.
 *
 * Asked of the app first, with the message the vault switcher's "Remove from list" sends: the
 * list lives in the main process's memory and is written out on every vault event, so an entry
 * taken out of `obsidian.json` alone came back the next time any vault opened. The app refuses
 * while the vault's window is open, which is why this runs last.
 *
 * The file is then checked on its own, in case the app could not be asked. Only this vault's
 * entry is touched, and the write goes to a file beside it that is renamed into place, so the
 * app never reads a half-written list of the person's vaults.
 */
function forgetVault(host: VaultCli, path: string): void {
  if (host.name !== '') {
    try {
      host.evalRaw(
        `window.electron.ipcRenderer.sendSync("vault-remove", ${JSON.stringify(path)})`,
        10_000
      )
    } catch {
      /* the file below still gets its entry taken out */
    }
  }
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
    if (!changed) return
    const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`
    writeFileSync(temporary, JSON.stringify(registry))
    renameSync(temporary, file)
  } catch {
    /* another platform, or Obsidian writing at the same moment */
  }
}

/** The newest modification time under a folder, or 0 when there is no such folder. */
function newestMs(dir: string): number {
  if (!existsSync(dir)) return 0
  let newest = 0
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name)
      if (entry.isDirectory()) walk(full)
      else newest = Math.max(newest, statSync(full).mtimeMs)
    }
  }
  walk(dir)
  return newest
}
