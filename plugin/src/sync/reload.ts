import type { App } from 'obsidian'

/**
 * Reloading Obsidian, so the settings files a sync wrote are read again (phase 3b, decision 11).
 *
 * Obsidian reads its own settings, its hotkeys and every plugin's `data.json` once, when the
 * vault opens; a file written under it afterwards is read by nothing, and the next save writes
 * the old values back. The one road that makes all of them take is a reload of the app.
 *
 * `app:reload` is the command Obsidian's own palette calls "Reload app without saving". Checked
 * in the installed bundle (`obsidian.asar`, `app.js`, Obsidian 1.13.7): it is registered beside
 * `app:open-help`, outside the `isDesktopApp` block that holds the desktop-only commands, and
 * its callback is `window.location.reload()` — which a phone's WebView has as well. The mobile
 * bundle is not on this machine, so the command is looked up rather than assumed: where it is
 * missing, nothing is reloaded and the person is asked to restart Obsidian instead.
 *
 * `executeCommandById` answers false for a command it does not know, and for one whose callback
 * threw; either way the reload did not happen.
 */

export const RELOAD_COMMAND = 'app:reload'

/** What reloads Obsidian: the real command, or a test's stand-in (`StagedSettingsPrompt.reloader`). */
export interface Reloader {
  /** Whether Obsidian here has a reload command to run. */
  available(): boolean
  /** Reload; answers whether it was started. */
  reload(): boolean
}

/** The part of Obsidian's private command registry this uses. */
interface Commands {
  findCommand?(id: string): unknown
  executeCommandById?(id: string): boolean
}

const commandsOf = (app: App | null): Commands | null =>
  ((app as unknown as { commands?: Commands } | null)?.commands ?? null) as Commands | null

/** Obsidian's own reload, through its command registry. */
export function obsidianReloader(app: () => App | null): Reloader {
  return {
    available: () => {
      const found = commandsOf(app())?.findCommand?.(RELOAD_COMMAND)
      return found !== undefined && found !== null
    },
    reload: () => commandsOf(app())?.executeCommandById?.(RELOAD_COMMAND) === true,
  }
}
