/**
 * A link to a book, or to a place in it, followed while the book is already open in the reader:
 * that tab comes forward and goes to the place, with its words selected, rather than the book
 * opening a second time in the tab the link was in or a new one.
 *
 * Obsidian opens every link through `workspace.openLinkText` — notes in reading view and in the
 * editor, the plugin's own chats — so the reuse is wrapped around that one call. Only a plain
 * click is taken: a Mod-click, a middle click or "Open in new tab" ask for a tab of their own and
 * get one, as before.
 */
import type { App, PaneType, TFile } from 'obsidian'
import { bringForward, leavesShowing } from '@/helpers/openLeaves'
import { BOOK_VIEW_TYPE, READER_EXTENSIONS } from './viewType'

type OpenLinkText = (
  linktext: string,
  sourcePath: string,
  newLeaf?: PaneType | boolean,
  openViewState?: unknown
) => Promise<void>

/** The file a link names, read as written or with its escapes undone. */
function linkedFile(app: App, linkpath: string, sourcePath: string): TFile | null {
  const found = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)
  if (found) return found
  try {
    const decoded = decodeURIComponent(linkpath)
    return decoded === linkpath ? null : app.metadataCache.getFirstLinkpathDest(decoded, sourcePath)
  } catch {
    // Written by hand with a stray `%`.
    return null
  }
}

/**
 * Follows `linktext` in the reader tab already showing its book, when there is one. Says whether
 * it did; false leaves the link to open the way it always did.
 */
export async function followIntoOpenBook(
  app: App,
  linktext: string,
  sourcePath: string
): Promise<boolean> {
  const hash = linktext.indexOf('#')
  const linkpath = hash < 0 ? linktext : linktext.slice(0, hash)
  const subpath = hash < 0 ? '' : linktext.slice(hash)
  if (!linkpath) return false
  const file = linkedFile(app, linkpath, sourcePath)
  if (!file || !READER_EXTENSIONS.includes(file.extension)) return false
  const leaf = leavesShowing(app, file.path, BOOK_VIEW_TYPE)[0]
  if (!leaf) return false
  await bringForward(app, leaf)
  if (subpath) leaf.setEphemeralState({ subpath })
  return true
}

/** Plain clicks on links to open books go to their tabs from now on; the result undoes it. */
export function reuseBookTabs(app: App): () => void {
  const workspace = app.workspace as unknown as { openLinkText: OpenLinkText }
  const original = workspace.openLinkText
  let on = true
  const wrapped: OpenLinkText = async function (
    this: unknown,
    linktext,
    sourcePath,
    newLeaf,
    openViewState
  ) {
    if (on && !newLeaf) {
      try {
        if (await followIntoOpenBook(app, linktext, sourcePath)) return
      } catch (e) {
        console.warn('[Abele] could not go to the open book; opening the link as usual', e)
      }
    }
    return original.call(this ?? workspace, linktext, sourcePath, newLeaf, openViewState)
  }
  workspace.openLinkText = wrapped
  return () => {
    on = false
    // Wrapped again by something else meanwhile: left in place, passing everything through.
    if (workspace.openLinkText === wrapped) workspace.openLinkText = original
  }
}
