/**
 * A note renamed or moved: every drawing that shows it follows, as a link would. An open drawing
 * changes in its tab, where undo can take it back and the file is written as after any change;
 * one that is not open has its file rewritten.
 */
import { TFile, type App } from 'obsidian'
import { drawingSvg, parseDrawingSvg } from './drawingFile'
import type { DrawingItem } from './items'
import { DRAWING_VIEW_TYPE } from './viewType'
import type { DrawingView } from './DrawingView'

/** The items with the note's new path; null when none shows it. */
export function renamedNotes(
  items: readonly DrawingItem[],
  from: string,
  to: string
): DrawingItem[] | null {
  if (!items.some((i) => i.type === 'note' && i.path === from)) return null
  return items.map((i) => (i.type === 'note' && i.path === from ? { ...i, path: to } : i))
}

export async function followNoteRename(app: App, from: string, to: string): Promise<void> {
  const open = new Set<string>()
  for (const leaf of app.workspace.getLeavesOfType(DRAWING_VIEW_TYPE)) {
    const view = leaf.view as DrawingView
    const session = view.session
    if (!view.file || !session) continue
    open.add(view.file.path)
    const next = renamedNotes(session.items.items, from, to)
    if (!next) continue
    session.replaceItems(next.filter((i, n) => i !== session.items.items[n]))
  }
  const needle = JSON.stringify(from).slice(1, -1)
  for (const file of app.vault.getFiles()) {
    if (file.extension !== 'svg' || open.has(file.path)) continue
    const text = await app.vault.cachedRead(file)
    if (!text.includes(needle)) continue
    const data = parseDrawingSvg(text)
    const next = data && renamedNotes(data.items, from, to)
    if (next && file instanceof TFile) await app.vault.modify(file, drawingSvg({ items: next }))
  }
}
