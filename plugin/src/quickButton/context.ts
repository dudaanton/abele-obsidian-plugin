/**
 * Which view the quick button is over, and what on screen it must stand clear of.
 *
 * On a phone a sidebar is a drawer over everything, so while one is open the button is over the
 * drawer's view, not over the note behind it. Otherwise it is over the main area's view.
 */
import type { App, View, WorkspaceLeaf } from 'obsidian'
import type { Box } from './placement'
import { hasQuickMenu } from './menu'

export interface QuickContext {
  view: View | null
  drawer: 'closed' | 'quick' | 'other'
}

interface Split {
  collapsed: boolean
}

const shown = (el: HTMLElement | undefined | null): boolean => {
  if (!el || !el.isConnected) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

/** The leaf of a split that is on screen: a drawer shows one of its tabs at a time. */
function shownLeaf(app: App, split: unknown): WorkspaceLeaf | null {
  let found: WorkspaceLeaf | null = null
  app.workspace.iterateAllLeaves((leaf) => {
    if (found || leaf.getRoot() !== split) return
    if (shown(leaf.view?.containerEl)) found = leaf
  })
  return found
}

export function quickContext(app: App): QuickContext {
  const { workspace } = app
  for (const split of [workspace.leftSplit, workspace.rightSplit] as unknown as Split[]) {
    if (!split || split.collapsed) continue
    const view = shownLeaf(app, split)?.view ?? null
    return { view, drawer: hasQuickMenu(view) ? 'quick' : 'other' }
  }
  const leaf = workspace.getMostRecentLeaf(workspace.rootSplit) ?? workspace.getMostRecentLeaf()
  return { view: leaf?.view ?? null, drawer: 'closed' }
}

/**
 * The things at the bottom of the screen the button stands on rather than over: Obsidian's
 * navigation bar and its toolbar above the keyboard, and inside the view a book's line under
 * the page — or the bar that takes its place — and a chat's composer.
 */
const APP_OBSTACLES = ['.mobile-navbar', '.mobile-toolbar']
const VIEW_OBSTACLES = ['.abele-book-reader__foot', '.abele-chat-input']

export function obstacles(doc: Document, view: View | null): HTMLElement[] {
  const found: HTMLElement[] = []
  for (const selector of APP_OBSTACLES)
    found.push(...Array.from(doc.querySelectorAll<HTMLElement>(selector)))
  const root = view?.containerEl
  if (root)
    for (const selector of VIEW_OBSTACLES)
      found.push(...Array.from(root.querySelectorAll<HTMLElement>(selector)))
  return found
}

export const boxOf = (el: HTMLElement): Box => {
  const r = el.getBoundingClientRect()
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
}
