import type { App, TFile } from 'obsidian'
import type { ChatMessage, ChatMetadata } from './types'
import { parseChat } from './ChatLog'
import { activeBranch } from './chatText'
import { foldQuery, foldText, occurrences, snippetAt, type Snippet } from './chatFind'

/**
 * The words of every chat, kept in memory for searching them all at once.
 *
 * Built when somebody first searches, not before: most sessions never do, and a chat folder is
 * every conversation ever had. Each chat is read once and kept with the modification time it was
 * read at; a later search reads again only the chats that have moved on since — the one being
 * talked in, one arrived by sync — and forgets the ones that are gone. Typing then searches
 * memory, never the disk.
 *
 * What is kept is what the person and the agent said on the branch each chat is showing — the
 * same text the chat itself draws as the conversation. Tool results, reasoning and the agent's
 * own records are most of a chat file and are neither read nor kept: the find bar inside a chat
 * reaches those, and here they would make every search and the memory it takes several times
 * larger.
 */

export interface IndexedMessage {
  id: string
  text: string
  /** `text` folded for matching (`foldText`), kept rather than folded again on every key. */
  folded: string
  timestamp: number
}

interface IndexedChat {
  mtime: number
  messages: IndexedMessage[]
}

/** One chat's answer to a search. */
export interface ChatSearchHit {
  path: string
  /** How many times the chat holds the words. */
  count: number
  /** The first message holding them, which a result opens on. */
  messageId: string
  snippet: Snippet
  /** When that message was written. */
  timestamp: number
}

/** Files read at once while the index is built: enough to keep the disk busy, not to flood it. */
const READ_BATCH = 8

const MSG_PREFIX = '{"k":"msg"'
const META_START = '{"v":'

/**
 * The conversation of one chat file, as the index keeps it.
 *
 * A log is read line by line and only the lines that can be messages or metadata are parsed:
 * the agent's own records (`int`) are three quarters of a long chat's file, and nothing in them
 * is searched. An older single-object file is parsed whole.
 */
export function extractConversation(content: string): IndexedMessage[] {
  let messages: ChatMessage[]
  let activeLeafId: string | undefined

  if (content.startsWith(META_START)) {
    const byId = new Map<string, ChatMessage>()
    for (const line of content.split('\n')) {
      if (line.startsWith(MSG_PREFIX)) {
        try {
          const message = JSON.parse(line) as ChatMessage
          // A later record of a message replaces the earlier one, keeping its place.
          byId.set(message.id, message)
        } catch {
          // A torn line: the chat itself skips it too.
        }
      } else if (line.startsWith(META_START)) {
        try {
          const record = JSON.parse(line) as ChatMetadata & { k?: string }
          if (record.k === 'meta') activeLeafId = record.activeLeafId
        } catch {
          // As above.
        }
      }
    }
    messages = [...byId.values()]
  } else {
    const parsed = parseChat(content)
    messages = parsed.messages
    activeLeafId = parsed.metadata?.activeLeafId
  }

  const kept: IndexedMessage[] = []
  for (const message of activeBranch(messages, activeLeafId)) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    if (message.draft === true || typeof message.content !== 'string') continue
    const text = message.content.trim()
    if (!text) continue
    kept.push({ id: message.id, text, folded: foldText(text), timestamp: message.timestamp })
  }
  return kept
}

/** Searches one chat's messages; null when the words are not in it. */
export function searchConversation(
  path: string,
  messages: readonly IndexedMessage[],
  foldedQuery: string
): ChatSearchHit | null {
  if (!foldedQuery) return null
  let hit: ChatSearchHit | null = null
  for (const message of messages) {
    const at = occurrences(message.folded, foldedQuery)
    if (!at.length) continue
    if (!hit) {
      hit = {
        path,
        count: 0,
        messageId: message.id,
        snippet: snippetAt(message.text, at[0], foldedQuery.length),
        timestamp: message.timestamp,
      }
    }
    hit.count += at.length
  }
  return hit
}

export interface PrepareProgress {
  done: number
  total: number
}

export class ChatSearchIndex {
  private static instance: ChatSearchIndex | null = null

  static getInstance(): ChatSearchIndex {
    if (!ChatSearchIndex.instance) ChatSearchIndex.instance = new ChatSearchIndex()
    return ChatSearchIndex.instance
  }

  static destroy(): void {
    ChatSearchIndex.instance = null
  }

  private chats = new Map<string, IndexedChat>()

  /** How many chats are held — for a test to see that nothing was read twice. */
  get size(): number {
    return this.chats.size
  }

  /** Whether every one of these files is read at its current modification time. */
  isReady(files: readonly TFile[]): boolean {
    return files.every((f) => this.chats.get(f.path)?.mtime === f.stat.mtime)
  }

  /**
   * Reads what is missing or out of date among these chats, and forgets every chat not among
   * them — deleted, renamed, or no longer in the history.
   *
   * `stopped` is asked between batches, so a search typed over does not go on reading for one
   * nobody is waiting for; what it read by then is kept.
   */
  async prepare(
    app: App,
    files: readonly TFile[],
    onProgress?: (progress: PrepareProgress) => void,
    stopped: () => boolean = () => false
  ): Promise<void> {
    const wanted = new Set(files.map((f) => f.path))
    for (const path of [...this.chats.keys()]) if (!wanted.has(path)) this.chats.delete(path)

    const stale = files.filter((f) => this.chats.get(f.path)?.mtime !== f.stat.mtime)
    let done = files.length - stale.length
    onProgress?.({ done, total: files.length })

    for (let i = 0; i < stale.length; i += READ_BATCH) {
      if (stopped()) return
      const batch = stale.slice(i, i + READ_BATCH)
      await Promise.all(
        batch.map(async (file) => {
          const mtime = file.stat.mtime
          try {
            const messages = extractConversation(await app.vault.cachedRead(file))
            this.chats.set(file.path, { mtime, messages })
          } catch {
            // Unreadable now: kept as empty until it changes, rather than read on every key.
            this.chats.set(file.path, { mtime, messages: [] })
          }
        })
      )
      done += batch.length
      onProgress?.({ done, total: files.length })
    }
  }

  /** Every chat read so far that holds the words, by path. */
  search(query: string): Map<string, ChatSearchHit> {
    const hits = new Map<string, ChatSearchHit>()
    const q = foldQuery(query)
    if (!q) return hits
    for (const [path, chat] of this.chats) {
      const hit = searchConversation(path, chat.messages, q)
      if (hit) hits.set(path, hit)
    }
    return hits
  }
}
