/**
 * The drawing's hooks into Obsidian: its tab, drawings opening in it, and the ways to make one.
 *
 * A drawing is an `.svg`, and so is every other picture of that kind in a vault, which Obsidian
 * shows in its own image tab. Taking `.svg` over would take them all; so it stays Obsidian's, and
 * a tab of theirs that opens one of ours — its root carries `data-abele-drawing` — is switched to
 * the drawing's tab as it opens. Every other SVG opens as it always did.
 */
import { Notice, TFile, TFolder, normalizePath, type App, type Plugin } from 'obsidian'
import { emptyDrawingSvg, isDrawingSvg } from './drawingFile'
import { DRAWING_VIEW_TYPE, DrawingView } from './DrawingView'

/** What was found in each SVG, by path, while it has the size and time it had. */
const known = new Map<string, { mtime: number; size: number; drawing: boolean }>()

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
  newTab = true
): Promise<void> {
  const open = app.workspace
    .getLeavesOfType(DRAWING_VIEW_TYPE)
    .find((l) => (l.view as DrawingView).file?.path === file.path)
  const leaf = open ?? app.workspace.getLeaf(newTab ? 'tab' : false)
  await leaf.setViewState({
    type: DRAWING_VIEW_TYPE,
    state: { file: file.path, ...state },
    active: true,
  })
  await app.workspace.revealLeaf(leaf)
}

export function registerDrawing(plugin: Plugin): void {
  const { app } = plugin
  plugin.registerView(DRAWING_VIEW_TYPE, (leaf) => new DrawingView(leaf))

  let pending = 0
  const adopt = () => {
    window.clearTimeout(pending)
    pending = window.setTimeout((): void => void adoptDrawingLeaves(app), 30)
  }
  app.workspace.onLayoutReady(adopt)
  plugin.registerEvent(app.workspace.on('file-open', adopt))
  plugin.registerEvent(app.workspace.on('layout-change', adopt))
  plugin.register(() => window.clearTimeout(pending))
  plugin.registerEvent(app.vault.on('delete', (file) => known.delete(file.path)))

  plugin.addCommand({
    id: 'new-drawing',
    name: 'New drawing',
    icon: 'pen-line',
    callback: () => void newDrawing(app),
  })

  plugin.registerEvent(
    app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFolder) {
        menu.addItem((item) =>
          item
            .setTitle('New drawing')
            .setIcon('pen-line')
            .setSection('action-primary')
            .onClick(() => void newDrawing(app, file))
        )
      }
    })
  )
}
