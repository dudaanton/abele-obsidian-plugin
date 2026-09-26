/**
 * A link to a place in a PDF's text (`[[Paper.pdf#cfi=…]]`) always opens in the book reader:
 * only it knows the place. Obsidian would open it in its own PDF viewer, at the first page, while
 * that viewer is the one PDFs open in. A link to a page (`#page=N`) is left to whichever viewer
 * that is, since both read it; so is every link to a book, which opens in the reader anyway.
 */
import { Platform, TFile, type App, type PaneType, type Plugin } from 'obsidian'
import { noteLinkAt, paneForClick } from '@/lineLinks/register'
import { parsePlaceSubpath } from './bookLinks'
import { followIntoOpenBook } from './bookTabReuse'

const NOTE_SURFACES = '.workspace-leaf-content, .hover-popover, .markdown-rendered'
const OPENING_EVENT: 'click' | 'mousedown' = Platform.isAndroidApp ? 'mousedown' : 'click'

/** The PDF and the place in its text a link names, when it names one. */
export function pdfPlaceLink(
  app: App,
  href: string,
  sourcePath: string
): { file: TFile; subpath: string } | null {
  const hash = href.indexOf('#')
  if (hash <= 0) return null
  const subpath = href.slice(hash)
  const place = parsePlaceSubpath(subpath)
  if (!place || !('cfi' in place)) return null
  let linkpath = href.slice(0, hash)
  try {
    linkpath = decodeURIComponent(linkpath)
  } catch {
    // Written by hand with a stray `%`: taken as it is.
  }
  const file = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)
  return file instanceof TFile && file.extension === 'pdf' ? { file, subpath } : null
}

export async function openPdfPlace(
  app: App,
  target: { file: TFile; subpath: string },
  viewType: string,
  pane: PaneType | false
): Promise<void> {
  // Open in the reader already: that tab goes to the place.
  if (!pane && (await followIntoOpenBook(app, target.file.path + target.subpath, ''))) return
  const leaf = app.workspace.getLeaf(pane)
  await leaf.setViewState({ type: viewType, state: { file: target.file.path }, active: true })
  leaf.setEphemeralState({ subpath: target.subpath })
}

export function registerPlaceLinks(plugin: Plugin, viewType: string): void {
  const { app } = plugin
  const onClick = (evt: MouseEvent) => {
    if ((evt.button !== 0 && evt.button !== 1) || evt.defaultPrevented) return
    const el = evt.target as Element | null
    if (!el?.closest?.(NOTE_SURFACES)) return
    // Only while PDFs open elsewhere; in the reader Obsidian's own opening already lands here.
    const byExt = (
      app as unknown as { viewRegistry?: { typeByExtension?: Record<string, string> } }
    ).viewRegistry?.typeByExtension?.pdf
    if (byExt === viewType) return
    const link = noteLinkAt(el)
    if (!link) return
    const pane = paneForClick(evt, link.sourceMode)
    if (pane === null) return
    const source = app.workspace.getActiveFile()?.path ?? ''
    const target = pdfPlaceLink(app, link.href, source)
    if (!target) return
    evt.preventDefault()
    evt.stopImmediatePropagation()
    void openPdfPlace(app, target, viewType, pane)
  }
  const listen = (doc: Document) => {
    plugin.registerDomEvent(doc, OPENING_EVENT, onClick, { capture: true })
    plugin.registerDomEvent(doc, 'auxclick', onClick, { capture: true })
  }
  listen(document)
  plugin.registerEvent(app.workspace.on('window-open', (_win, win) => listen(win.document)))
}
