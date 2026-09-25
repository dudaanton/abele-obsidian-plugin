import { WorkspaceLeaf, type OpenViewState, type TFile } from 'obsidian'
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
 * one: the chat panel is the one place a chat is shown.
 *
 * Returns the undo, for the plugin's unload. Once undone the wrapper passes straight through,
 * so something that patched `openFile` on top of it keeps working.
 */
export function keepChatFilesOutOfLeaves(
  open: (file: TFile) => Promise<void>,
  proto: { openFile: OpenFile } = WorkspaceLeaf.prototype
): () => void {
  const original = proto.openFile
  let live = true

  const patched: OpenFile = async function (this: WorkspaceLeaf, file, state) {
    if (!live || !file || !isChatLog(file.path)) return original.call(this, file, state)
    if (this.view?.getViewType() === 'empty') this.detach()
    await open(file)
  }
  proto.openFile = patched

  return () => {
    live = false
    if (proto.openFile === patched) proto.openFile = original
  }
}
