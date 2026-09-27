/**
 * Puts the toolbar's scripts where they are pressed: an icon on the left ribbon on a computer,
 * and a place on the phone's toolbar above the keyboard.
 *
 * Which scripts those are, and the rules for the phone's list, are in `scriptToolbar.ts`. This is
 * the part that touches Obsidian — its ribbon and the app's config — and it redraws whenever the
 * scripts or the settings change.
 *
 * The ribbon icons are Obsidian's own ribbon items, so its ribbon settings list them and the
 * person reorders or hides them there. Every script is an Obsidian command already
 * (`Script: <name>`), so the phone's toolbar only needs its id; a ribbon icon runs the script the
 * command's way, on the note in front and whatever is selected in it.
 */
import { Notice, Platform } from 'obsidian'
import { watch, type WatchStopHandle } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { ScriptService } from './ScriptService'
import type { ParsedScript } from './types'
import {
  mobileToolbarNext,
  toolbarCommandId,
  toolbarRibbonItems,
  toolbarScripts,
  toolbarScriptsFrom,
  withToolbarScript,
  withoutToolbarScript,
} from './scriptToolbar'

/** What this device has put on the phone's toolbar, command to script file. */
const OFFERED_KEY = 'abele-script-toolbar-offered'
const PHONE_TOOLBAR = 'mobileToolbarCommands'

/** The class on each ribbon icon, so tests and styles find them. */
export const SCRIPT_RIBBON_CLASS = 'abele-script-ribbon'

/** Obsidian's left ribbon, as its own `addRibbonIcon` uses it. */
interface Ribbon {
  addRibbonItemButton(
    id: string,
    icon: string,
    title: string,
    callback: (evt: MouseEvent) => unknown
  ): HTMLElement
  removeRibbonAction(id: string): void
}

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
  private stopWatch: WatchStopHandle | null = null
  private stopped = false
  /** The ribbon icons drawn, by id, and what each was drawn for. */
  private drawn = new Map<string, { signature: string; el: HTMLElement }>()

  constructor(private readonly service: ScriptService) {}

  start(): void {
    this.stopWatch = watch(
      [this.service.scriptList, AbeleConfig.getInstance().version],
      () => this.sync(),
      { flush: 'sync' }
    )
    // Both wait for the index: read before it, every script would look gone, and the phone's
    // list would lose them.
    void this.service.ready.then(() => this.sync())
  }

  stop(): void {
    this.stopped = true
    this.stopWatch?.()
    this.stopWatch = null
    for (const id of [...this.drawn.keys()]) this.removeIcon(id)
  }

  /** Brings both toolbars up to date. */
  sync(): void {
    if (this.stopped) return
    this.drawRibbon()
    this.syncPhoneToolbar()
  }

  private ribbon(): Ribbon | null {
    const { app } = GlobalStore.getInstance()
    return (app.workspace as unknown as { leftRibbon?: Ribbon }).leftRibbon ?? null
  }

  /**
   * An icon per script on the left ribbon, on a computer only: a phone has the toolbar above the
   * keyboard for them. An icon already showing the same script is left alone; one whose script
   * is gone, or off the toolbar, is taken away.
   */
  private drawRibbon(): void {
    const plugin = AbeleConfig.getInstance().plugin
    const ribbon = this.ribbon()
    if (!plugin || !ribbon) return
    const scripts = Platform.isMobile ? [] : currentToolbarScripts(this.service)
    const items = toolbarRibbonItems(plugin.manifest.id, scripts)
    const wanted = new Set(items.map((i) => i.id))
    for (const id of [...this.drawn.keys()]) if (!wanted.has(id)) this.removeIcon(id)
    for (const item of items) {
      const signature = `${item.icon}\u0000${item.title}`
      if (this.drawn.get(item.id)?.signature === signature) continue
      this.removeIcon(item.id)
      const el = ribbon.addRibbonItemButton(item.id, item.icon, item.title, () => {
        void this.service.executeFromCommand(item.path)
      })
      el.addClass(SCRIPT_RIBBON_CLASS)
      el.dataset.script = item.title
      this.drawn.set(item.id, { signature, el })
    }
  }

  /** Takes an icon off the ribbon the way Obsidian does for a plugin's own: its place is kept. */
  private removeIcon(id: string): void {
    const drawn = this.drawn.get(id)
    if (!drawn) return
    this.ribbon()?.removeRibbonAction(id)
    drawn.el.detach()
    this.drawn.delete(id)
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
