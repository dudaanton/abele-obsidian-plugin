import type { App, TAbstractFile } from 'obsidian'
import type { ChangeOrigin } from './types'

/**
 * Which notes this device has just written, and which automations wrote them.
 *
 * Obsidian raises the same `modify` for a note saved here and for one that Obsidian Sync,
 * Syncthing or another app rewrote on disk. The difference is the road: everything written
 * here — the editor, the properties panel, the plugin, a script — goes through the vault's
 * own methods, and a file changed underneath Obsidian never does. So those methods are wrapped
 * to mark the path, and a change that arrives with no mark on it came from elsewhere.
 *
 * The same record carries the automations whose scripts did the writing, which is how a rule
 * recognises its own echo.
 */

/** Which argument of each method names the file, or the path it writes to. */
const VAULT_METHODS: Record<string, number[]> = {
  modify: [0],
  modifyBinary: [0],
  process: [0],
  append: [0],
  create: [0],
  createBinary: [0],
  rename: [0, 1],
  copy: [1],
  delete: [0],
  trash: [0],
}
const FILE_MANAGER_METHODS: Record<string, number[]> = {
  renameFile: [0, 1],
  trashFile: [0],
  processFrontMatter: [0],
}

type Method = (...args: unknown[]) => unknown

interface Mark {
  until: number
  chain: string[]
}

const pathOf = (arg: unknown): string | null => {
  if (typeof arg === 'string') return arg
  if (arg && typeof arg === 'object' && typeof (arg as TAbstractFile).path === 'string') {
    return (arg as TAbstractFile).path
  }
  return null
}

export class LocalWrites {
  private marks = new Map<string, Mark>()
  private active = false

  /** How long a write stays attributed: the metadata cache reports a save a moment after it. */
  constructor(private readonly windowMs = 5000) {}

  mark(path: string): void {
    const mark = this.marks.get(path)
    const until = Date.now() + this.windowMs
    if (mark && mark.until > Date.now()) mark.until = until
    else this.marks.set(path, { until, chain: [] })
    this.prune()
  }

  /** The automations — oldest first — whose script is writing this path. */
  markChain(path: string, chain: string[]): void {
    const mark = this.marks.get(path)
    const live = mark && mark.until > Date.now() ? mark.chain : []
    const merged = [...live]
    for (const id of chain) if (!merged.includes(id)) merged.push(id)
    this.marks.set(path, { until: Date.now() + this.windowMs, chain: merged })
  }

  originOf(path: string): { origin: ChangeOrigin; chain: string[] } {
    const mark = this.marks.get(path)
    if (!mark || mark.until <= Date.now()) return { origin: 'external', chain: [] }
    return { origin: 'local', chain: [...mark.chain] }
  }

  /** Forgets expired marks, so the map holds only the last few seconds of writing. */
  private prune(): void {
    if (this.marks.size < 200) return
    const now = Date.now()
    for (const [path, mark] of this.marks) if (mark.until <= now) this.marks.delete(path)
  }

  /**
   * Wraps the write methods, and returns how to undo it.
   *
   * Undone only where the method is still ours: another plugin that wrapped it after us holds
   * a reference to our wrapper, and putting the original back under it would cut its chain.
   * Left in place, our wrapper simply stops marking.
   */
  install(app: App): () => void {
    this.active = true
    const undo: (() => void)[] = []

    const wrap = (target: Record<string, unknown>, methods: Record<string, number[]>) => {
      for (const [name, positions] of Object.entries(methods)) {
        const original = target[name]
        if (typeof original !== 'function') continue
        const hadOwn = Object.prototype.hasOwnProperty.call(target, name)
        const markArgs = (args: unknown[]) => {
          if (!this.active) return
          for (const position of positions) {
            const path = pathOf(args[position])
            if (path) this.mark(path)
          }
        }
        // A plain function, not an arrow: the original is called with whatever `this` the
        // caller gave, as it would have been unwrapped.
        const wrapper: Method = function (this: unknown, ...args: unknown[]) {
          markArgs(args)
          return (original as Method).apply(this, args)
        }
        target[name] = wrapper
        undo.push(() => {
          if (target[name] !== wrapper) return
          if (hadOwn) target[name] = original
          else delete target[name]
        })
      }
    }

    wrap(app.vault as unknown as Record<string, unknown>, VAULT_METHODS)
    if (app.fileManager) {
      wrap(app.fileManager as unknown as Record<string, unknown>, FILE_MANAGER_METHODS)
    }

    return () => {
      this.active = false
      for (const step of undo) step()
      this.marks.clear()
    }
  }
}
