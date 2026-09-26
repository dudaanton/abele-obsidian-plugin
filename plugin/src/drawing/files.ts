/**
 * Drawings as files: telling one from any other SVG, making one, and opening one in its tab.
 *
 * A drawing is an `.svg`, and so is every other picture of that kind in a vault, which Obsidian
 * shows in its own image tab. Taking `.svg` over would take them all; so it stays Obsidian's, and
 * a tab of theirs that opens one of ours — its root carries `data-abele-drawing` — is switched to
 * the drawing's tab as it opens. Every other SVG opens as it always did.
 */
import { Notice, TFile, TFolder, normalizePath, type App, type PaneType } from 'obsidian'
import { emptyDrawingSvg, isDrawingSvg } from './drawingFile'
import { drawingCallout } from './embedFormat'
import { DRAWING_VIEW_TYPE } from './viewType'
import type { DrawingView } from './DrawingView'
import type { Rect } from './items'

/** What was found in each SVG, by path, while it has the size and time it had. */
export const known = new Map<string, { mtime: number; size: number; drawing: boolean }>()

/** Whether a vault file is a drawing the plugin made. */
export async function isDrawingFile(app: App, file: TFile): Promise<boolean> {
  if (file.extension !== 'svg') return false
  const seen = known.get(file.path)
  if (seen && seen.mtime === file.stat.mtime && seen.size === file.stat.size) return seen.drawing
  let drawing = false
  try {
    drawing = isDrawingSvg((await app.vault.cachedRead(file)).slice(0, 2000))
  } catch {
    drawing = false
  }
  known.set(file.path, { mtime: file.stat.mtime, size: file.stat.size, drawing })
  return drawing
}

interface LeafLike {
  view: { getViewType(): string; file?: TFile | null }
  getViewState(): { type: string; state?: Record<string, unknown> }
  setViewState(state: { type: string; state?: Record<string, unknown> }): Promise<void>
}

/** Every one of Obsidian's image tabs showing a drawing moves to the drawing's tab. */
export async function adoptDrawingLeaves(app: App): Promise<number> {
  const leaves: LeafLike[] = []
  app.workspace.iterateAllLeaves((leaf) => {
    const l = leaf as unknown as LeafLike
    if (l.view.getViewType() === 'image' && l.view.file?.extension === 'svg') leaves.push(l)
  })
  let moved = 0
  for (const leaf of leaves) {
    const file = leaf.view.file
    if (!file || !(await isDrawingFile(app, file))) continue
    const vs = leaf.getViewState()
    try {
      await leaf.setViewState({ ...vs, type: DRAWING_VIEW_TYPE, state: { file: file.path } })
      moved++
    } catch (e) {
      console.warn('[Abele] could not open a drawing in its tab', e)
    }
  }
  return moved
}

/** A name for a new drawing in a folder, one no file has yet. */
function freePath(app: App, folder: string, base: string): string {
  const dir = folder && folder !== '/' ? `${folder}/` : ''
  for (let n = 1; ; n++) {
    const path = normalizePath(`${dir}${base}${n > 1 ? ` ${n}` : ''}.svg`)
    if (!app.vault.getAbstractFileByPath(path)) return path
  }
}

/** Makes a new drawing, in a folder or where new notes go, and opens it ready to draw on. */
export async function newDrawing(app: App, folder?: TFolder): Promise<TFile | null> {
  const parent =
    folder ?? app.fileManager.getNewFileParent(app.workspace.getActiveFile()?.path ?? '')
  const base = `Drawing ${window.moment().format('YYYY-MM-DD HH.mm')}`
  try {
    const file = await app.vault.create(freePath(app, parent.path, base), emptyDrawingSvg())
    await openDrawing(app, file, { draw: true })
    return file
  } catch (e) {
    new Notice(`The drawing could not be made: ${String(e)}`)
    return null
  }
}

/** Opens a drawing in a tab of its own, or in the one already showing it. */
export async function openDrawing(
  app: App,
  file: TFile,
  state: Record<string, unknown> = {},
  where: PaneType | false = 'tab'
): Promise<void> {
  const open = app.workspace
    .getLeavesOfType(DRAWING_VIEW_TYPE)
    .find((l) => (l.view as DrawingView).file?.path === file.path)
  const leaf = open ?? app.workspace.getLeaf(where)
  await leaf.setViewState({
    type: DRAWING_VIEW_TYPE,
    state: { file: file.path, ...state },
    active: true,
  })
  await app.workspace.revealLeaf(leaf)
}

/**
 * A new drawing for a note: made where the note's attachments go, shown in the note at the
 * cursor, and opened beside it ready to draw on. Says the text it put in the note.
 */
export async function insertDrawing(
  app: App,
  note: TFile,
  insert: (text: string) => void
): Promise<TFile | null> {
  const name = `Drawing ${window.moment().format('YYYY-MM-DD HH.mm.ss')}.svg`
  try {
    const path = await app.fileManager.getAvailablePathForAttachment(name, note.path)
    const file = await app.vault.create(path, emptyDrawingSvg())
    insert(`${drawingCallout(`!${app.fileManager.generateMarkdownLink(file, note.path)}`)}\n`)
    await openDrawing(app, file, { draw: true }, 'split')
    return file
  } catch (e) {
    new Notice(`The drawing could not be made: ${String(e)}`)
    return null
  }
}

/** A drawing's callout on the clipboard, to paste into a note. */
export async function copyEmbed(embed: string, view?: Rect | null): Promise<void> {
  await navigator.clipboard.writeText(drawingCallout(embed, view))
  new Notice('Copied: paste it into a note to show the drawing there')
}
