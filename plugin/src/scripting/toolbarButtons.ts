/**
 * Puts the toolbar's scripts where they are pressed: a button among the icons at the top right
 * of every note on a computer, and a place on the phone's toolbar above the keyboard.
 *
 * Which scripts those are, and the rules for the phone's list, are in `scriptToolbar.ts`. This is
 * the part that touches Obsidian — the notes' headers and the app's config — and it redraws
 * whenever the scripts, the settings or the open notes change.
 *
 * Every script is an Obsidian command already (`Script: <name>`), so the phone's toolbar only
 * needs its id; a button runs the same command's way, with the note it sits on made the active
 * one first, so the script sees that note and whatever is selected in it.
 */
import {
  MarkdownView,
  Notice,
  Platform,
  type EventRef,
  type View,
  type WorkspaceLeaf,
} from 'obsidian'
import { watch, type WatchStopHandle } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { ScriptService } from './ScriptService'
import type { ParsedScript } from './types'
import {
  TOOLBAR_SCRIPT_ICON,
  mobileToolbarNext,
  toolbarCommandId,
  toolbarScripts,
  toolbarScriptsFrom,
  withToolbarScript,
  withoutToolbarScript,
} from './scriptToolbar'

/** What this device has put on the phone's toolbar, command to script file. */
const OFFERED_KEY = 'abele-script-toolbar-offered'
const PHONE_TOOLBAR = 'mobileToolbarCommands'

/** The class on each button, so tests and styles find them. */
export const SCRIPT_ACTION_CLASS = 'abele-script-action'

interface AppConfig {
  vault: {
    getConfig(key: string): unknown
    setConfig(key: string, value: unknown): void
  }
  loadLocalStorage(key: string): unknown
  saveLocalStorage(key: string, value: unknown): void
}

/** The scripts on the toolbar now, in order. */
export function currentToolbarScripts(service: ScriptService): ParsedScript[] {
  const chosen = toolbarScriptsFrom(AbeleConfig.getInstance().ai.toolbarScripts)
  return toolbarScripts(service.scriptList.value, chosen)
}

export class ScriptToolbar {
  private refs: EventRef[] = []
  private stopWatch: WatchStopHandle | null = null
  private stopped = false
  /** The buttons drawn into each note, and what they were drawn for. */
  private drawn = new Map<View, { signature: string; els: HTMLElement[] }>()

  constructor(private readonly service: ScriptService) {}

  start(): void {
    const { app } = GlobalStore.getInstance()
    const redraw = () => this.drawButtons()
    this.refs = [
      app.workspace.on('layout-change', redraw),
      app.workspace.on('active-leaf-change', redraw),
    ]
    this.stopWatch = watch(
      [this.service.scriptList, AbeleConfig.getInstance().version],
      () => this.sync(),
      { flush: 'sync' }
    )
    // The phone's list waits for the index: read before it, every script would look gone and
    // be taken off.
    void this.service.ready.then(() => this.sync())
  }

  stop(): void {
    this.stopped = true
    const { app } = GlobalStore.getInstance()
    for (const ref of this.refs) app.workspace.offref(ref)
    this.refs = []
    this.stopWatch?.()
    this.stopWatch = null
    for (const { els } of this.drawn.values()) for (const el of els) el.remove()
    this.drawn.clear()
  }

  /** Brings both toolbars up to date. */
  sync(): void {
    if (this.stopped) return
    this.drawButtons()
    this.syncPhoneToolbar()
  }

  /**
   * A button per script in every note's header, on a computer only: on a phone the header has
   * no room, and the toolbar above the keyboard is where they go instead. A note whose buttons
   * already show the same scripts is left alone.
   */
  private drawButtons(): void {
    if (this.stopped) return
    const { app } = GlobalStore.getInstance()
    const scripts = Platform.isMobile ? [] : currentToolbarScripts(this.service)
    const signature = scripts
      .map((s) => `${s.path}\u0000${s.meta.name}\u0000${s.meta.icon}`)
      .join('\n')

    const live = new Set<View>()
    for (const leaf of app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view
      if (!(view instanceof MarkdownView)) continue
      live.add(view)
      const before = this.drawn.get(view)
      if (before?.signature === signature) continue
      for (const el of before?.els ?? []) el.remove()
      // `addAction` puts each new button first, so they are added last to first.
      const els = [...scripts].reverse().map((script) => {
        const el = view.addAction(script.meta.icon || TOOLBAR_SCRIPT_ICON, script.meta.name, () =>
          this.run(leaf, script.path)
        )
        el.addClass(SCRIPT_ACTION_CLASS)
        el.dataset.script = script.meta.name
        return el
      })
      this.drawn.set(view, { signature, els })
    }
    for (const view of [...this.drawn.keys()]) if (!live.has(view)) this.drawn.delete(view)
  }

  /** Runs a script from a note's button, with that note the one in front. */
  private run(leaf: WorkspaceLeaf, path: string): void {
    const { app } = GlobalStore.getInstance()
    app.workspace.setActiveLeaf(leaf, { focus: true })
    void this.service.executeFromCommand(path)
  }

  /** Puts this device's additions to the phone's toolbar in line with the scripts on it. */
  private syncPhoneToolbar(): void {
    const plugin = AbeleConfig.getInstance().plugin
    if (!plugin) return
    const app = GlobalStore.getInstance().app as unknown as AppConfig
    const current = app.vault.getConfig(PHONE_TOOLBAR)
    if (!Array.isArray(current)) return
    const offered = offeredFrom(app.loadLocalStorage(OFFERED_KEY))
    const wanted = currentToolbarScripts(this.service).map((s) => ({
      id: toolbarCommandId(plugin.manifest.id, s),
      path: s.path,
    }))
    const next = mobileToolbarNext(current as string[], wanted, offered)
    if (next.changed) app.vault.setConfig(PHONE_TOOLBAR, next.commands)
    if (JSON.stringify(next.offered) !== JSON.stringify(offered)) {
      app.saveLocalStorage(OFFERED_KEY, Object.keys(next.offered).length ? next.offered : null)
    }
  }

  /**
   * Forgets that the script at `path` was ever put on this device's phone toolbar, so the next
   * sync puts it there again — what switching it on from the library means, even after the person
   * took it off the toolbar by hand.
   */
  forgetOffered(path: string): void {
    const app = GlobalStore.getInstance().app as unknown as AppConfig
    const offered = offeredFrom(app.loadLocalStorage(OFFERED_KEY))
    const kept = Object.fromEntries(Object.entries(offered).filter(([, p]) => p !== path))
    app.saveLocalStorage(OFFERED_KEY, Object.keys(kept).length ? kept : null)
  }
}

function offeredFrom(stored: unknown): Record<string, string> {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
  return Object.fromEntries(
    Object.entries(stored as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === 'string'
    )
  )
}

/** Puts a script on the toolbar from the library, or takes it off, and says so. */
export async function setOnToolbar(
  service: ScriptService,
  script: ParsedScript,
  on: boolean
): Promise<void> {
  const config = AbeleConfig.getInstance()
  const chosen = toolbarScriptsFrom(config.ai.toolbarScripts)
  if (on) service.toolbar?.forgetOffered(script.path)
  config.ai = {
    ...config.ai,
    toolbarScripts: on
      ? withToolbarScript(chosen, script.meta.name)
      : withoutToolbarScript(chosen, script.meta.name),
  }
  await config.saveSettings()
  new Notice(
    on ? `${script.meta.name} is on the toolbar` : `${script.meta.name} is off the toolbar`
  )
}
