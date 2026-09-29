import { WorkspaceLeaf, type OpenViewState, type TFile, type Workspace } from 'obsidian'
import { isChatLog } from './chatText'

type OpenFile = (this: WorkspaceLeaf, file: TFile, state?: OpenViewState) => Promise<void>

/**
 * A chat file is never opened into a leaf: it goes to the chat panel, and the leaf keeps what
 * it had.
 *
 * Every way Obsidian opens a file — a click in the file explorer, the quick switcher, a link in
 * a note, search results, "open in new tab" or in a split — ends in `WorkspaceLeaf.openFile`,
 * on the leaf holding the note in front or on one made for the occasion. Letting the chat land
 * there and moving it out afterwards cost the note: the leaf it had been replaced in was the
 * one detached. So the chat is turned away at the door instead.
 *
 * A leaf that is still blank was opened only for this chat — a new tab, a split, a window — and
 * would stay behind empty, so it goes. Asking for a new tab or split does not put a chat in
 * one: the chat panel is the one place a chat is shown. Closing that tab would leave Obsidian
 * to pick which tab comes to the front — a neighbour, not the one that was there — so the tab
 * that was in front before is put back in front, and whatever had the focus gets it back.
 *
 * Returns the undo, for the plugin's unload. Once undone the wrapper passes straight through,
 * so something that patched `openFile` on top of it keeps working.
 */
export function keepChatFilesOutOfLeaves(
  open: (file: TFile) => Promise<void>,
  workspace: () => LeafWorkspace,
  proto: { openFile: OpenFile } = WorkspaceLeaf.prototype
): () => void {
  const original = proto.openFile
  let live = true

  const patched: OpenFile = async function (this: WorkspaceLeaf, file, state) {
    if (!live || !file || !isChatLog(file.path)) return original.call(this, file, state)
    if (this.view?.getViewType() !== 'empty') {
      await open(file)
      return
    }
    const ws = workspace()
    const inFront = lastActive(ws, this)
    this.detach()
    await open(file)
    restore(ws, inFront)
  }
  proto.openFile = patched

  return () => {
    live = false
    if (proto.openFile === patched) proto.openFile = original
  }
}

/** What of `Workspace` putting the front tab back needs. */
export type LeafWorkspace = Pick<
  Workspace,
  'iterateRootLeaves' | 'iterateAllLeaves' | 'setActiveLeaf'
>

interface InFront {
  /** The tab in the main area (or a window of its own) active last. */
  tab: WorkspaceLeaf | null
  /** The leaf anywhere active last — the tab, or a sidebar the focus was in. */
  focused: WorkspaceLeaf | null
}

/** Active last, by the time Obsidian stamps on a leaf each time it is made active. */
const newest = (
  iterate: (cb: (leaf: WorkspaceLeaf) => void) => void,
  except: WorkspaceLeaf
): WorkspaceLeaf | null => {
  let best: WorkspaceLeaf | null = null
  let time = -1
  iterate((leaf) => {
    const t = (leaf as { activeTime?: number }).activeTime ?? 0
    if (leaf !== except && t > time) {
      best = leaf
      time = t
    }
  })
  return best
}

/** Which tab was in front, and where the focus was, before the blank one was opened. */
function lastActive(ws: LeafWorkspace, blank: WorkspaceLeaf): InFront {
  return {
    tab: newest((cb) => ws.iterateRootLeaves(cb), blank),
    focused: newest((cb) => ws.iterateAllLeaves(cb), blank),
  }
}

/** The tab back in front of its group, and the focus back where it was. */
function restore(ws: LeafWorkspace, { tab, focused }: InFront): void {
  if (tab) ws.setActiveLeaf(tab, { focus: focused === tab || !focused })
  if (focused && focused !== tab) ws.setActiveLeaf(focused, { focus: true })
}
