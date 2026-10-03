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

interface Rename {
  from: string
  to: string
}
interface RenameQueue {
  pending: Rename[]
  running: Promise<void> | null
}
const queues = new WeakMap<App, RenameQueue>()

/** Coalesce a rename burst and serialize it with an earlier burst still reading drawings. */
export function followNoteRename(app: App, from: string, to: string): Promise<void> {
  let queue = queues.get(app)
  if (!queue) {
    queue = { pending: [], running: null }
    queues.set(app, queue)
  }
  const current = queue
  current.pending.push({ from, to })
  if (!current.running) {
    current.running = Promise.resolve().then(async () => {
      try {
        while (current.pending.length) {
          const batch = current.pending.splice(0)
          try {
            await followBatch(app, batch)
          } catch (error) {
            // Enumeration failed, not a particular write. Do not replay applied steps; keep
            // ownership of the drain so a later queued rename is not stranded.
            console.error('[Abele] could not enumerate drawings after note rename', error)
          }
        }
      } finally {
        current.running = null
      }
    })
  }
  return current.running
}

function renamedBatch(items: readonly DrawingItem[], renames: Rename[]): DrawingItem[] | null {
  let next: readonly DrawingItem[] = items
  for (const { from, to } of renames) next = renamedNotes(next, from, to) ?? next
  return next === items ? null : (next as DrawingItem[])
}

async function followBatch(app: App, renames: Rename[]): Promise<void> {
  const open = new Set<string>()
  for (const leaf of app.workspace.getLeavesOfType(DRAWING_VIEW_TYPE)) {
    const view = leaf.view as DrawingView
    const session = view.session
    if (!view.file || !session) continue
    open.add(view.file.path)
    try {
      const next = renamedBatch(session.items.items, renames)
      if (next) session.replaceItems(next.filter((i, n) => i !== session.items.items[n]))
    } catch (error) {
      console.error('[Abele] could not update drawing after note rename', view.file.path, error)
    }
  }
  const needles = renames.map(({ from }) => JSON.stringify(from).slice(1, -1))
  for (const file of app.vault.getFiles()) {
    if (file.extension !== 'svg' || open.has(file.path)) continue
    try {
      const text = await app.vault.cachedRead(file)
      if (!needles.some((needle) => text.includes(needle))) continue
      if (file instanceof TFile)
        await app.vault.process(file, (current) => {
          const data = parseDrawingSvg(current)
          const next = data && renamedBatch(data.items, renames)
          return next ? drawingSvg({ items: next }) : current
        })
    } catch (error) {
      // Keep the failing path and cause, but never let one file stop unrelated drawings or
      // the next batch. A failed file is not retried implicitly: a write may have applied.
      console.error('[Abele] could not update drawing after note rename', file.path, error)
    }
  }
}
