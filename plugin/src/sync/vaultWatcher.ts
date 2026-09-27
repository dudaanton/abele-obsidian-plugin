import { TFolder } from 'obsidian'
import type { App, EventRef, TAbstractFile } from 'obsidian'

/**
 * Watching the vault for `ObsidianFileSystem.watch`: the vault's own events for everything the
 * file index sees, and a poll of the config folder and the ignore file for what it does not.
 * Changes are gathered into batches — a burst of events is one batch, held back no longer than
 * a ceiling — and handed to the host first and the engine after.
 */

/** How long the watcher waits for a burst to end before it reports a batch. */
const WATCH_DEBOUNCE_MS = 300
/** How long a batch may be held back by a burst that never lets up. */
const WATCH_MAX_WAIT_MS = 2000

/** What the watcher is handed by the file system it watches for. */
export interface WatchHost {
  app: App
  /** The clock the watcher's ceiling reads. */
  now: () => number
  /** Handed every batch before the engine is; a throw is logged and swallowed. */
  onWatch: ((paths: string[]) => void) | null
  /** How often the config folder is polled. */
  pollMs: number
  configDir: string
  /** path → `size:mtime` for the config folder and the ignore file. */
  snapshot: () => Promise<Map<string, string>>
}

/** A running watch: look at the config folder now, or stop. */
export interface VaultWatch {
  kick: () => void
  stop: () => void
}

export function watchVault(host: WatchHost, cb: (paths: string[]) => void): VaultWatch {
  const pending = new Set<string>()
  let timer: number | undefined
  let firstPendingAt = 0
  let stopped = false

  const fire = (): void => {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
    firstPendingAt = 0
    if (stopped || pending.size === 0) return
    const paths = [...pending]
    pending.clear()
    console.debug(`[abele-sync] the vault changed at ${paths.length} path(s)`)
    try {
      host.onWatch?.(paths)
    } catch (error) {
      console.debug('[abele-sync] the host threw at a batch of changes', error)
    }
    try {
      cb(paths)
    } catch (error) {
      // Whoever is listening threw. The batch is spent either way — holding it back would
      // report the same paths on every tick from here on.
      console.debug('[abele-sync] a listener threw at a batch of changes', error)
    }
  }

  const add = (paths: string[]): void => {
    if (stopped) return
    for (const path of paths) if (path !== '') pending.add(path)
    if (pending.size === 0) return
    const now = host.now()
    if (firstPendingAt === 0) firstPendingAt = now
    // Past the ceiling the running timer is left alone, so a burst that never lets up still
    // hands over what it has instead of holding everything to the end.
    if (timer !== undefined && now - firstPendingAt >= WATCH_MAX_WAIT_MS) return
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(fire, WATCH_DEBOUNCE_MS)
  }

  /** The config folder as it was last seen; null until the first walk has finished. */
  let seen: Map<string, string> | null = null
  let walking = false
  let again = false
  const poll = async (): Promise<void> => {
    if (stopped) return
    // One walk at a time: a `kick` during a walk is answered by the walk after it, which
    // is the only one that can see what the kick was about.
    if (walking) {
      again = true
      return
    }
    walking = true
    try {
      do {
        again = false
        let taken: Map<string, string>
        try {
          taken = await host.snapshot()
        } catch (error) {
          // A folder that would not be listed is not a reason to say its files are gone.
          console.debug('[abele-sync] cannot read the settings folder', error)
          continue
        }
        if (stopped) return
        const before = seen
        // Written down before anything is reported: a listener that throws must not leave
        // the watcher holding the old snapshot and reporting the same batch for ever.
        seen = taken
        if (before === null) continue
        const changed = changedBetween(before, taken)
        if (changed.length > 0) {
          add(changed)
          fire()
        }
      } while (again)
    } finally {
      walking = false
    }
  }

  const kick = (): void => void poll()

  const refs: EventRef[] = [
    host.app.vault.on('create', (file) => add(pathsOf(file))),
    host.app.vault.on('modify', (file) => add(pathsOf(file))),
    host.app.vault.on('delete', (file) => add(pathsOf(file))),
    host.app.vault.on('rename', (file, oldPath) => add(pathsOf(file, oldPath))),
  ]
  // Obsidian rewrites its appearance settings and then says the CSS changed; that is the
  // one moment it tells a plugin anything at all about the config folder. This watcher's
  // own poll, not the file system's `kick()`, which is whichever watcher started last.
  const cssRef = host.app.workspace.on('css-change', kick)

  const ticker = window.setInterval(kick, host.pollMs)
  // The baseline, so the first tick reports what changed since watching began rather than
  // every settings file there is.
  kick()
  console.debug(`[abele-sync] watching the vault, ${host.configDir} every ${host.pollMs} ms`)

  const stop = (): void => {
    stopped = true
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
    window.clearInterval(ticker)
    for (const ref of refs) host.app.vault.offref(ref)
    host.app.workspace.offref(cssRef)
    console.debug('[abele-sync] stopped watching the vault')
  }

  return { kick, stop }
}

/**
 * Which on-disk paths one vault event is about.
 *
 * Obsidian names the thing that changed and nothing under it, so a folder renamed in the
 * sidebar arrives as one path though it moved every note inside. The children are named
 * here, under both spellings, or the engine would hear about the move and not about the
 * notes until its next full scan. The folder itself goes in too: it stats as nothing, and a
 * batch that holds it is still a reason to look at the vault.
 */
function pathsOf(file: TAbstractFile, oldPath?: string): string[] {
  const paths = [file.path]
  if (oldPath !== undefined) paths.push(oldPath)
  if (!(file instanceof TFolder)) return paths
  for (const path of filesUnder(file)) {
    paths.push(path)
    // `Notes/Trips/a.md` under `Notes/Trips` renamed from `Trips` is `Trips/a.md`.
    if (oldPath !== undefined) paths.push(oldPath + path.slice(file.path.length))
  }
  return paths
}

/** Every file below a folder, however deep. A deleted folder may already have none. */
function filesUnder(folder: TFolder): string[] {
  const paths: string[] = []
  for (const child of folder.children) {
    if (child instanceof TFolder) paths.push(...filesUnder(child))
    else paths.push(child.path)
  }
  return paths
}

/** What changed between two walks of the config folder: written, added, or gone. */
function changedBetween(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths: string[] = []
  for (const [path, mark] of after) if (before.get(path) !== mark) paths.push(path)
  for (const path of before.keys()) if (!after.has(path)) paths.push(path)
  return paths
}
