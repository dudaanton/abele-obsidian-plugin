/**
 * Opening the quick menu over whatever is in front: from the button, or from the command that
 * does the same with no button at all.
 */
import { MarkdownView, Menu, type App } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { buttonParams, buttonsForNote, noteVariables } from '@/helpers/headerButtons'
import { getFrontmatterFromCache } from '@/helpers/notesUtils'
import { runScriptByName } from '@/scripting/runScript'
import { openAbeleSettings } from '@/components/settings/settingsTab'
import { fillQuickMenu, type QuickHeaderButton } from './menu'
import { noteQuickActions } from './noteActions'
import { quickContext } from './context'
import type { View } from 'obsidian'

/** The note's header buttons, as the quick menu offers them. */
function headerButtonsOf(view: View | null): QuickHeaderButton[] {
  if (!(view instanceof MarkdownView) || !view.file) return []
  const path = view.file.path
  const frontmatter = getFrontmatterFromCache(path)
  const type = typeof frontmatter?.type === 'string' ? frontmatter.type : null
  return buttonsForNote(AbeleConfig.getInstance().headerButtons, { type, path, frontmatter }).map(
    (button) => ({
      id: button.id,
      name: button.name || button.scriptName,
      icon: button.icon,
      run: () => void runScriptByName(button.scriptName, buttonParams(button, noteVariables(path))),
    })
  )
}

/**
 * Builds the menu for the view in front and shows it at a point — on a phone Obsidian draws it
 * as a sheet from the bottom wherever that is. `onHide` is told when it closes.
 */
export function openQuickMenu(app: App, at: { x: number; y: number }, onHide?: () => void): Menu {
  const { view } = quickContext(app)
  const menu = new Menu()
  fillQuickMenu(menu, {
    app,
    view,
    actions: AbeleConfig.getInstance().quickButton.actions,
    headerButtons: headerButtonsOf(view),
    runScript: (name, params) => runScriptByName(name, params),
    openSettings: () => openAbeleSettings(app, 'quick-button'),
    noteActions: (m, file) => noteQuickActions(app, m, file),
  })
  if (onHide) menu.onHide(onHide)
  menu.showAtPosition(at)
  return menu
}
