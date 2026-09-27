/**
 * Which scripts are on the toolbar, and what that makes of the phone's toolbar above the keyboard.
 *
 * A script gets there two ways, as on the book menu: by its own header (`// @toolbar`), or by
 * being put there from the script library, which keeps its name in `ai.toolbarScripts`. On a
 * computer each one is an icon on the left ribbon; on a phone it is
 * a place on Obsidian's own toolbar above the keyboard, which lists commands by id in the app's
 * config (`mobileToolbarCommands`).
 *
 * That list is Obsidian's and the person's too — they arrange it in Settings → Toolbar — so it is
 * only ever touched where this plugin put something: what was added is remembered, per device,
 * and only that is taken off again. One the person took off by hand is not put back.
 *
 * Everything here is pure, so the rules are tested without an app. `toolbarButtons.ts` is the
 * part that touches Obsidian.
 */
import type { ParsedScript } from './types'

/** The icon a script has on the toolbar when its header chose none. */
export const TOOLBAR_SCRIPT_ICON = 'scroll-text'

/** The list as stored, made whole: names only, blanks and repeats dropped. */
export function toolbarScriptsFrom(stored: unknown): string[] {
  if (!Array.isArray(stored)) return []
  const out: string[] = []
  for (const raw of stored) {
    if (typeof raw !== 'string') continue
    const name = raw.trim()
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/**
 * The scripts on the toolbar, in order: those put there from the library that still exist, in
 * the order they were put there, then those whose header says `@toolbar`, by name.
 */
export function toolbarScripts(all: ParsedScript[], chosen: string[]): ParsedScript[] {
  const byName = new Map(all.map((s) => [s.meta.name, s]))
  const first = chosen.map((name) => byName.get(name)).filter((s): s is ParsedScript => !!s)
  const headed = all
    .filter((s) => s.meta.toolbar && !chosen.includes(s.meta.name))
    .sort((a, b) => a.meta.name.localeCompare(b.meta.name))
  return [...first, ...headed]
}

/** Whether a script is on the toolbar, and by what; null when it is not. */
export function toolbarPlace(script: ParsedScript, chosen: string[]): 'setting' | 'header' | null {
  if (chosen.includes(script.meta.name)) return 'setting'
  return script.meta.toolbar ? 'header' : null
}

export function withToolbarScript(chosen: string[], name: string): string[] {
  return chosen.includes(name) ? chosen : [...chosen, name]
}

export function withoutToolbarScript(chosen: string[], name: string): string[] {
  return chosen.filter((n) => n !== name)
}

/**
 * The command's id as Obsidian knows it. A plugin registers `script-…` and Obsidian puts the
 * plugin's own id in front, so the script's `commandId` (`abele:script-…`) is one short of it.
 */
export function toolbarCommandId(pluginId: string, script: ParsedScript): string {
  return `${pluginId}:${script.commandId}`
}

/** One script's icon on the left ribbon, as Obsidian's ribbon takes it. */
export interface RibbonItem {
  /** Named by the script's file, not its name: renaming a script keeps its place and whether
   * the person hid it in Obsidian's ribbon settings, which are kept by this id. */
  id: string
  icon: string
  /** The tooltip, and the name the ribbon settings list it by. */
  title: string
  path: string
}

/** The ribbon's items for the scripts on the toolbar, in their order. */
export function toolbarRibbonItems(pluginId: string, scripts: ParsedScript[]): RibbonItem[] {
  return scripts.map((s) => ({
    id: `${pluginId}:script:${s.path}`,
    icon: s.meta.icon || TOOLBAR_SCRIPT_ICON,
    title: s.meta.name,
    path: s.path,
  }))
}

/** One script the phone's toolbar should carry: its command, and the file, to follow a rename. */
export interface WantedCommand {
  id: string
  path: string
}

/**
 * The phone's toolbar after the scripts on it are brought up to date.
 *
 * `offered` is what this device has put on it before, command to file. A script wanted there and
 * never offered goes at the start, where it is seen without scrolling; one offered and no longer wanted is taken off, if it is still
 * there. A script whose name changed has a new command for the same file: it takes the old one's
 * place rather than moving to the end — and stays off when the person had taken it off.
 */
export function mobileToolbarNext(
  current: string[],
  wanted: WantedCommand[],
  offered: Record<string, string>
): { commands: string[]; offered: Record<string, string>; changed: boolean } {
  const commands = [...current]
  const next: Record<string, string> = {}
  const wantedIds = new Set(wanted.map((w) => w.id))

  for (const [id, path] of Object.entries(offered)) {
    if (wantedIds.has(id)) {
      next[id] = path
      continue
    }
    const at = commands.indexOf(id)
    const renamed = wanted.find((w) => w.path === path && !(w.id in offered) && !(w.id in next))
    if (renamed) {
      next[renamed.id] = path
      if (at >= 0) {
        if (commands.includes(renamed.id)) commands.splice(at, 1)
        else commands[at] = renamed.id
      }
    } else if (at >= 0) {
      commands.splice(at, 1)
    }
  }

  // In front, in their own order: the toolbar is longer than a phone is wide, and the end of it
  // is a scroll away. The person moves them from there if they like.
  const added: string[] = []
  for (const w of wanted) {
    if (w.id in next) continue
    if (!commands.includes(w.id)) added.push(w.id)
    next[w.id] = w.path
  }
  commands.unshift(...added)

  const changed = commands.length !== current.length || commands.some((id, i) => id !== current[i])
  return { commands, offered: next, changed }
}
