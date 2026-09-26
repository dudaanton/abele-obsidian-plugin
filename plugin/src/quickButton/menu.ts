/**
 * What the quick button's menu holds for the thing on screen.
 *
 * Obsidian's own `Menu`, so on a phone it is their bottom sheet with its grouped sections and
 * looks like every other menu in the app. Top to bottom:
 *
 * - the user's own actions — any command, any script — and the note's header buttons, which are
 *   his too. A command that says it cannot run here (`checkCallback`, an editor command with no
 *   note being edited) is left out, which is what makes one flat list of his contextual: a
 *   command for notes is simply not offered over a book;
 * - what the plugin offers for the view in front — a view says it through `fillQuickMenu`, the
 *   same method its own ⋯ menu is filled by, so the two cannot drift apart; a note's are asked
 *   of `noteActions`;
 * - the command palette, the way to everything that is not listed.
 */
import { MarkdownView, type App, type Menu, type TFile, type View } from 'obsidian'
import type { QuickAction } from './settings'

export const MINE = 'abele-mine'
export const HERE = 'abele-here'
export const ALWAYS = 'abele-always'

/** A view with something of its own to offer in the quick menu. */
export interface QuickMenuSource {
  fillQuickMenu(menu: Menu): void
}

export const hasQuickMenu = (view: unknown): view is QuickMenuSource =>
  !!view && typeof (view as Partial<QuickMenuSource>).fillQuickMenu === 'function'

/** A header button of the note in front, already worked out and ready to run. */
export interface QuickHeaderButton {
  id: string
  name: string
  icon: string
  run: () => void
}

export interface QuickMenuDeps {
  app: App
  /** The view the button is over. */
  view: View | null
  actions: QuickAction[]
  headerButtons: QuickHeaderButton[]
  runScript: (name: string, params: Record<string, unknown>) => Promise<void>
  openSettings: () => void
  /** What the plugin offers for a note. */
  noteActions: (menu: Menu, file: TFile) => void
}

interface CommandLike {
  id: string
  name: string
  icon?: string
  checkCallback?: (checking: boolean) => boolean | void
  editorCallback?: unknown
  editorCheckCallback?: (checking: boolean, editor: unknown, view: unknown) => boolean | void
}

interface Commands {
  commands?: Record<string, CommandLike>
  findCommand?: (id: string) => CommandLike | undefined
  executeCommandById: (id: string) => boolean
}

const commandsOf = (app: App): Commands => (app as unknown as { commands: Commands }).commands

function findCommand(app: App, id: string): CommandLike | undefined {
  const commands = commandsOf(app)
  return commands.findCommand?.(id) ?? commands.commands?.[id]
}

/**
 * Whether a command would run if chosen now — the question the command palette asks before it
 * lists one. Not part of the plugin API; this is where the reach for it lives.
 */
export function commandAvailable(app: App, id: string): boolean {
  const command = findCommand(app, id)
  if (!command) return false
  try {
    if (command.checkCallback) return !!command.checkCallback(true)
    if (command.editorCallback || command.editorCheckCallback) {
      const view = app.workspace.getActiveViewOfType(MarkdownView)
      const editor = (view as { editor?: unknown } | null)?.editor
      if (!view || !editor) return false
      if (command.editorCheckCallback) return !!command.editorCheckCallback(true, editor, view)
    }
    return true
  } catch (err) {
    console.debug('[Abele] quick menu: a command failed to say whether it can run', id, err)
    return false
  }
}

/** A command's own name without the `Plugin: ` Obsidian puts in front of it. */
const bareName = (name: string): string => name.replace(/^[^:]{1,40}:\s+/, '')

function addOwn(menu: Menu, deps: QuickMenuDeps, action: QuickAction): boolean {
  if (action.type === 'command') {
    if (!action.commandId || !commandAvailable(deps.app, action.commandId)) return false
    const command = findCommand(deps.app, action.commandId)
    menu.addItem((item) =>
      item
        .setTitle(action.name || bareName(command?.name ?? action.commandId))
        .setIcon(action.icon || command?.icon || 'terminal-square')
        .setSection(MINE)
        .onClick(() => void commandsOf(deps.app).executeCommandById(action.commandId))
    )
    return true
  }
  if (!action.scriptName) return false
  menu.addItem((item) =>
    item
      .setTitle(action.name || action.scriptName)
      .setIcon(action.icon || 'play')
      .setSection(MINE)
      .onClick(() => void deps.runScript(action.scriptName, {}))
  )
  return true
}

/**
 * The menu as a view fills it, with everything it adds put into one section. A book sorts its
 * own ⋯ items into several; here they are one group, "what this is".
 */
function inSection(menu: Menu, section: string): Menu {
  return new Proxy(menu, {
    get(target, key, receiver) {
      if (key === 'addItem')
        return (build: Parameters<Menu['addItem']>[0]) =>
          target.addItem((item) => {
            build(item)
            item.setSection(section)
          })
      const value = Reflect.get(target, key, receiver) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
}

export function fillQuickMenu(menu: Menu, deps: QuickMenuDeps): void {
  let own = 0
  for (const action of deps.actions) if (addOwn(menu, deps, action)) own++

  for (const button of deps.headerButtons) {
    own++
    menu.addItem((item) =>
      item
        .setTitle(button.name)
        .setIcon(button.icon || 'play')
        .setSection(MINE)
        .onClick(() => button.run())
    )
  }

  const view = deps.view
  const here = inSection(menu, HERE)
  if (hasQuickMenu(view)) view.fillQuickMenu(here)
  else if (view instanceof MarkdownView && view.file) deps.noteActions(here, view.file)

  // Nothing of his own anywhere: the way to put something there, rather than an empty group.
  if (own === 0 && deps.actions.length === 0) {
    menu.addItem((item) =>
      item
        .setTitle('Choose what this menu holds…')
        .setIcon('settings')
        .setSection(ALWAYS)
        .onClick(() => deps.openSettings())
    )
  }
  menu.addItem((item) =>
    item
      .setTitle('Command palette')
      .setIcon('terminal-square')
      .setSection(ALWAYS)
      .onClick(() => void commandsOf(deps.app).executeCommandById('command-palette:open'))
  )
}
