/**
 * Linking a chat to a note by hand, and unlinking it.
 *
 * Not a second kind of link: a chat that writes to a note records it in its file's `touched`
 * and `ChatStorage.linkNotes` copies that into the index the note's footer reads. Attaching by
 * hand is that same entry, dated when it was attached — so a card cannot tell the two apart, a
 * rename follows both, and a later write to an attached note only dates the link again.
 * Detaching removes the entry whichever way it got there; a chat that writes the note again
 * links it again, as it would have in the first place.
 */
import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { isScriptPath } from '@/scripting/scriptPath'
import { ChatService } from './ChatService'
import { ChatStorage } from './ChatStorage'
import { parseChatMetadata, serializeMetadata } from './ChatLog'
import type { AiChatHistoryEntry, TouchedNote } from './types'

/** The chats in the index linked to `notePath`, by a write or by hand. Reads no file. */
export function chatsOf(notePath: string): AiChatHistoryEntry[] {
  return ChatStorage.getInstance()
    .getHistory()
    .filter((entry) => entry.notes?.some((note) => note.path === notePath))
}

/**
 * Whether a path is something a chat can be linked to: a note, which has a footer, or a script,
 * whose code view lists its chats the same way.
 */
export function isLinkableNote(path: string): boolean {
  const file = GlobalStore.getInstance().app.vault.getAbstractFileByPath(path)
  return file instanceof TFile && (file.extension === 'md' || isScriptPath(file.path))
}

/**
 * Links a chat to a note. Answers whether anything changed: a note already linked keeps its
 * one entry and its date, and a path that is not a note, or a chat with no index entry — a
 * comment, which reaches a footer by being expanded — is refused.
 */
export async function attachNote(chatPath: string, notePath: string): Promise<boolean> {
  if (notePath === chatPath || !isLinkableNote(notePath)) return false
  return rewriteLinks(chatPath, (notes) =>
    notes.some((note) => note.path === notePath)
      ? notes
      : [...notes, { path: notePath, at: new Date().toISOString() }]
  )
}

/** Unlinks a chat from a note, whichever way it was linked. Answers whether it was linked. */
export function detachNote(chatPath: string, notePath: string): Promise<boolean> {
  return rewriteLinks(chatPath, (notes) => notes.filter((note) => note.path !== notePath))
}

/**
 * Rewrites one chat's `touched`, in its file and its index entry — the two places a write
 * keeps it. Through the open session when there is one, so its log writer stays in step with
 * the file and its next save does not take the change back; otherwise one meta record onto
 * the end of the file, which is what a chat log is. The same two roads as a note's rename.
 */
async function rewriteLinks(
  chatPath: string,
  change: (notes: TouchedNote[]) => TouchedNote[]
): Promise<boolean> {
  const storage = ChatStorage.getInstance()
  if (!storage.getHistory().some((entry) => entry.path === chatPath)) return false

  const session = ChatService.getInstance().getSessionByFile(chatPath)
  if (session) {
    const next = change(session.touched.value)
    if (sameLinks(next, session.touched.value)) return false
    session.touched.value = next
    await session.save()
    // `mirrorNoteLinks` skips a chat that names no notes, and one whose last link was just
    // taken away is exactly that — so the index is told here, either way.
    storage.linkNotes(chatPath, next, session.recap.value, session.agentId.value)
    return true
  }

  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(chatPath)
  if (!(file instanceof TFile)) return false
  const metadata = parseChatMetadata(await app.vault.read(file))
  if (metadata?.type !== 'abele-chat') return false
  const current = metadata.touched ?? []
  const next = change(current)
  if (sameLinks(next, current)) return false
  await app.vault.append(
    file,
    serializeMetadata({ ...metadata, touched: next.length ? next : undefined })
  )
  storage.linkNotes(chatPath, next, metadata.recap, metadata.agentId)
  return true
}

const sameLinks = (a: TouchedNote[], b: TouchedNote[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b)
