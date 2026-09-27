/**
 * Command buttons in a note's header: icons among Obsidian's own at the top right of the note,
 * each running a command — Obsidian's, another plugin's, the plugin's own or a script's.
 *
 * Which buttons a note shows is decided in `helpers/headerButtons.ts`; this is the part that
 * touches Obsidian. It redraws whenever the settings, the open notes, a note's properties or
 * its place change, and leaves a header alone when the buttons it should show are the ones it
 * already has — so going from one note to another that shows the same buttons does not blink.
 *
 * On a phone the header holds a couple of icons beside the title, so the buttons after the
 * first two go into the note's more-options menu, in their order.
 */
import {
  FileView,
  MarkdownView,
  Platform,
  TFile,
  type App,
  type Menu,
  type Plugin,
  type TAbstractFile,
  type View,
  type WorkspaceLeaf,
} from 'obsidian'
import { watch, type WatchStopHandle } from 'vue'
import { AbeleConfig, type HeaderButtonDefinition } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { commandButtonsFor, noteTags, splitForHeader } from '@/helpers/headerButtons'

/** The class on each button, so tests and styles find them. */
export const COMMAND_ACTION_CLASS = 'abele-command-action'

/** How many command buttons a phone's note header shows before the rest go to its menu. */
export const PHONE_ROOM = 2

/** How often, and how many times, a button waiting for its command looks again. */
const RETRY_MS = 2000
const RETRIES = 15

interface Commands {
  findCommand?(id: string): unknown
  commands?: Record<string, unknown>
  executeCommandById(id: string): boolean
}

function commandsOf(app: App): Commands {
  return (app as unknown as { commands: Commands }).commands
}

/** Whether Obsidian has the command now — not when the plugin giving it is off. */
export function hasCommand(app: App, id: string): boolean {
  const commands = (app as unknown as { commands?: Commands }).commands
  return !!(commands?.findCommand?.(id) ?? commands?.commands?.[id])
}

interface Drawn {
  signature: string
  els: HTMLElement[]
  overflow: HeaderButtonDefinition[]
}

export class HeaderCommands {
  private drawn = new Map<View, Drawn>()
  private stopWatch: WatchStopHandle | null = null
  private stopped = false
  private retryTimer: number | null = null
  private retriesLeft = RETRIES

  start(plugin: Plugin): void {
    const { app } = GlobalStore.getInstance()
    const redraw = () => this.draw()
    plugin.registerEvent(app.workspace.on('layout-change', redraw))
    plugin.registerEvent(app.workspace.on('active-leaf-change', redraw))
    plugin.registerEvent(app.workspace.on('file-open', redraw))
    plugin.registerEvent(
      app.metadataCache.on('changed', (file: TFile) => {
        if (this.isOpen(file)) this.draw()
      })
    )
    plugin.registerEvent(
      app.vault.on('rename', (file: TAbstractFile) => {
        if (file instanceof TFile && this.isOpen(file)) this.draw()
      })
    )
    plugin.registerEvent(
      app.workspace.on('file-menu', (menu: Menu, _file, source: string, leaf?: WorkspaceLeaf) => {
        if (source === 'more-options' && leaf) this.fillMenu(menu, leaf)
      })
    )
    this.stopWatch = watch(
      AbeleConfig.getInstance().version,
      () => {
        this.retriesLeft = RETRIES
        this.draw()
      },
      { flush: 'post' }
    )
    this.draw()
  }

  stop(): void {
    this.stopped = true
    this.stopWatch?.()
    this.stopWatch = null
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer)
    this.retryTimer = null
    for (const { els } of this.drawn.values()) for (const el of els) el.remove()
    this.drawn.clear()
  }

  private isOpen(file: TFile): boolean {
    for (const view of this.drawn.keys()) if ((view as FileView).file === file) return true
    return this.leaves().some((leaf) => (leaf.view as FileView).file === file)
  }

  /** The tabs that may carry buttons: notes, and other files when some button asks for them. */
  private leaves(): WorkspaceLeaf[] {
    const { app } = GlobalStore.getInstance()
    const buttons = AbeleConfig.getInstance().headerButtons
    const beyondNotes = buttons.some((b) => b.runs === 'command' && b.otherFiles)
    const leaves: WorkspaceLeaf[] = []
    app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view
      if (view instanceof MarkdownView) leaves.push(leaf)
      else if (beyondNotes && view instanceof FileView && view.file) leaves.push(leaf)
    })
    return leaves
  }

  /** The buttons one tab should show, in order. */
  private buttonsFor(view: View): HeaderButtonDefinition[] {
    const { app } = GlobalStore.getInstance()
    const file = (view as FileView).file
    if (!(file instanceof TFile)) return []
    const markdown = view instanceof MarkdownView
    const frontmatter = markdown
      ? (app.metadataCache.getFileCache(file)?.frontmatter ?? null)
      : null
    const type: unknown = frontmatter?.type
    return commandButtonsFor(
      AbeleConfig.getInstance().headerButtons,
      {
        type: typeof type === 'string' ? type : null,
        path: file.path,
        frontmatter,
        tags: markdown ? noteTags(file.path) : [],
        markdown,
      },
      { hasCommand: (id) => hasCommand(app, id) }
    )
  }

  /** Brings every open tab's buttons up to date. */
  draw(): void {
    if (this.stopped) return
    const room = Platform.isPhone ? PHONE_ROOM : Infinity
    const live = new Set<View>()

    for (const leaf of this.leaves()) {
      const view = leaf.view as FileView
      live.add(view)
      const { shown, overflow } = splitForHeader(this.buttonsFor(view), room)
      const signature = shown
        .map((b) => `${b.id}\u0000${b.icon}\u0000${b.name}\u0000${b.commandId}`)
        .join('\n')
      const before = this.drawn.get(view)
      if (before?.signature === signature) {
        before.overflow = overflow
        continue
      }
      for (const el of before?.els ?? []) el.remove()
      // `addAction` puts each new button first, so they are added last to first.
      const els = [...shown].reverse().map((button) => this.addAction(view, leaf, button))
      this.drawn.set(view, { signature, els, overflow })
    }

    for (const [view, { els }] of [...this.drawn]) {
      if (live.has(view)) continue
      for (const el of els) el.remove()
      this.drawn.delete(view)
    }
    this.retryMissing()
  }

  private addAction(view: FileView, leaf: WorkspaceLeaf, button: HeaderButtonDefinition) {
    const label = this.labelOf(button)
    const el = view.addAction(button.icon || 'play', label, () => this.run(leaf, button))
    el.addClass(COMMAND_ACTION_CLASS)
    el.dataset.button = button.id
    return el
  }

  private labelOf(button: HeaderButtonDefinition): string {
    if (button.name.trim()) return button.name.trim()
    const { app } = GlobalStore.getInstance()
    const found = commandsOf(app).findCommand?.(button.commandId ?? '') as
      | { name?: string }
      | undefined
    return found?.name ?? button.commandId ?? ''
  }

  /** Runs a button's command with its tab the one in front, as the command palette would. */
  private run(leaf: WorkspaceLeaf, button: HeaderButtonDefinition): void {
    const { app } = GlobalStore.getInstance()
    app.workspace.setActiveLeaf(leaf, { focus: true })
    commandsOf(app).executeCommandById(button.commandId ?? '')
  }

  /** The buttons the header had no room for, at the top of the tab's more-options menu. */
  private fillMenu(menu: Menu, leaf: WorkspaceLeaf): void {
    const overflow = this.drawn.get(leaf.view)?.overflow ?? []
    for (const button of overflow) {
      menu.addItem((item) =>
        item
          .setTitle(this.labelOf(button))
          .setIcon(button.icon || 'play')
          // Right under Close: Obsidian orders a tab's menu close, pane, open, action…, and an
          // unknown section would sink to the bottom, under everything else.
          .setSection('pane')
          .onClick(() => this.run(leaf, button))
      )
    }
  }

  /**
   * Another plugin registers its commands when it loads, which may be after this one drew the
   * headers — and a button whose command is not there yet is hidden. So while any enabled button
   * waits on a command, the headers are looked at again a few times; switching the plugin on
   * later is caught by the next redraw, a note opened or the settings touched.
   */
  private retryMissing(): void {
    if (this.retryTimer !== null || this.retriesLeft <= 0) return
    const { app } = GlobalStore.getInstance()
    const waiting = AbeleConfig.getInstance().headerButtons.some(
      (b) =>
        b.runs === 'command' &&
        b.enabled !== false &&
        !!b.commandId?.trim() &&
        !hasCommand(app, b.commandId.trim())
    )
    if (!waiting) return
    this.retriesLeft--
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null
      this.draw()
    }, RETRY_MS)
  }
}
