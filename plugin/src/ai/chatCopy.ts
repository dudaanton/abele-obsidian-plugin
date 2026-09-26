/**
 * A chat file rewritten whole so that a crash at any moment leaves one whole copy of it.
 *
 * Obsidian writes a file by emptying it and then writing it a piece at a time, each piece
 * waiting its turn on the main thread. A long chat is several pieces, and an app that hangs
 * between two of them and is killed leaves the file empty or cut short — measured: a 6MB write
 * killed while the thread was busy left 0 bytes, or exactly 5MB. So the new content goes to a
 * copy in the plugin's folder first, the file second, and the copy is dropped only once the
 * file is whole. Reading the chat puts the copy back when it finds the file torn.
 *
 * The copy is this device's alone: it covers a write this device was making, nothing more.
 */
import type { App, TFile } from 'obsidian'
import { parseChat, type ParsedChat } from './ChatLog'

/** Where a chat's copy sits while it is rewritten: named for its path, out of the vault's sight. */
export function chatCopyPath(app: App, chatPath: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < chatPath.length; i++) {
    hash = Math.imul(hash ^ chatPath.charCodeAt(i), 0x01000193)
  }
  const name = (hash >>> 0).toString(16).padStart(8, '0')
  return `${app.vault.configDir}/plugins/abele/chat-backups/${name}.abchat`
}

/** Replaces the file's content, by way of a copy. The copy's first line names the chat. */
export async function rewriteChat(app: App, file: TFile, content: string): Promise<void> {
  const adapter = app.vault.adapter
  const copy = chatCopyPath(app, file.path)
  let copied = false
  try {
    const folder = copy.slice(0, copy.lastIndexOf('/'))
    if (!(await adapter.exists(folder))) await adapter.mkdir(folder)
    await adapter.write(copy, `${file.path}\n${content}`)
    copied = true
  } catch (err) {
    // The chat is still written, only without the safety net: refusing the write over its
    // copy would leave every later save of this chat failing on the same rewrite.
    console.warn('[Abele] Could not keep a copy of a chat being rewritten', err)
  }
  await app.vault.modify(file, content)
  if (!copied) return
  try {
    await adapter.remove(copy)
  } catch {
    // Left behind beside a whole file, the copy is dropped by the next read, which finds
    // nothing torn to restore.
  }
}

/**
 * The chat, from its file or from the copy a rewrite left behind — whichever holds it whole.
 *
 * A copy exists only while a rewrite is under way, so finding one means the app stopped in the
 * middle. Which half it stopped in decides: a copy that is whole, beside a file that is torn or
 * empty, is the rewrite that did not finish; anything else is a copy cut short — the file was
 * not touched yet — or one that outlived a rewrite that did finish.
 */
export async function readChat(app: App, file: TFile): Promise<ParsedChat> {
  const text = await app.vault.read(file)
  const parsed = parseChat(text)
  const adapter = app.vault.adapter
  const copyPath = chatCopyPath(app, file.path)
  if (!(await adapter.exists(copyPath))) return parsed

  const raw = await adapter.read(copyPath)
  const cut = raw.indexOf('\n')
  const content = raw.slice(cut + 1)
  const copy = cut === -1 || raw.slice(0, cut) !== file.path ? null : parseChat(content)
  // Emptied and killed before the first piece landed reads as no chat at all: torn too.
  const fileTorn =
    parsed.torn || parsed.damaged > 0 || !text.trim() || (parsed.version === 1 && !parsed.metadata)
  const copyWhole = !!copy && copy.version === 2 && !copy.torn && copy.damaged === 0
  if (!copy || !copyWhole || !fileTorn || copy.records < parsed.records) {
    await adapter.remove(copyPath)
    return parsed
  }

  console.warn(`[Abele] ${file.path}: a rewrite was cut short, restored from its copy`)
  await app.vault.modify(file, content)
  await adapter.remove(copyPath)
  return copy
}
