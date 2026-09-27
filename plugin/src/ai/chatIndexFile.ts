import type { AiChatHistoryEntry } from './types'

/**
 * The chat index on disk: `chat-index.json` in the plugin's own folder, beside `data.json`.
 *
 * It used to be `ai.chatHistory` inside `data.json`. That file syncs between devices now and
 * the later save wins, and the index was written into it on every new chat, rename and summary
 * — so every chat on any device would have rewritten the file the others race against.
 *
 * A file rather than Obsidian's local storage, for three reasons. Local storage is one quota of
 * a few megabytes shared by every vault the app opens, and an index of a few thousand chats with
 * their note links reaches that. A file goes where the vault goes — a copy made in Finder lists
 * its chats. And no sync carries it: Obsidian Sync takes only `manifest.json`, `main.js`,
 * `styles.css` and `data.json` out of a plugin's folder, and Abele Sync (plugin and daemon) the
 * same four, filing anything else there as a plugin's cache that never travels. Each device
 * keeps its own index, rebuilt from the chat files it holds (`ChatStorage.refreshHistory`).
 */
export const CHAT_INDEX_FILE = 'chat-index.json'

/** Where an index that would not parse is kept, rather than written over. */
export const BROKEN_CHAT_INDEX_FILE = 'chat-index.broken.json'

/** The slice of Obsidian's `DataAdapter` the index is read and written through. */
interface IndexAdapter {
  exists(path: string): Promise<boolean>
  readBinary(path: string): Promise<ArrayBuffer>
  writeBinary(path: string, data: ArrayBuffer): Promise<void>
  mkdir(path: string): Promise<void>
}

/** What a plugin must offer for its index to be on disk: the app's adapter and its folder. */
interface IndexPlugin {
  app?: { vault?: { adapter?: unknown; configDir?: string } }
  manifest?: { id?: string; dir?: string }
}

export interface ChatIndexDisk {
  /** The index the file holds; null when there is no file, or one that would not parse. */
  read(): Promise<AiChatHistoryEntry[] | null>
  write(entries: AiChatHistoryEntry[]): Promise<void>
}

/** The index file of a running plugin, or null for one with no vault to write to. */
export function chatIndexDiskOf(plugin: unknown): ChatIndexDisk | null {
  const host = plugin as IndexPlugin | null | undefined
  const adapter = host?.app?.vault?.adapter as IndexAdapter | undefined
  if (!adapter || typeof adapter.writeBinary !== 'function') return null
  const configDir = host?.app?.vault?.configDir
  const dir =
    host?.manifest?.dir ??
    (configDir ? `${configDir}/plugins/${host?.manifest?.id ?? 'abele'}` : null)
  if (dir === null) return null
  const path = `${dir}/${CHAT_INDEX_FILE}`
  const encoder = new TextEncoder()
  const bytes = (text: string): ArrayBuffer => encoder.encode(text).buffer

  return {
    async read() {
      if (!(await adapter.exists(path))) return null
      const raw = await adapter.readBinary(path)
      const text = new TextDecoder().decode(raw)
      const entries = parseChatIndex(text)
      if (entries !== null) return entries
      // Kept aside rather than written over by the next save: what was in it cannot be read
      // back now, but a person can, and the chats themselves are rebuilt from their files.
      console.error(`[Abele] ${path} could not be read; kept as ${BROKEN_CHAT_INDEX_FILE}`)
      await adapter.writeBinary(`${dir}/${BROKEN_CHAT_INDEX_FILE}`, raw)
      return null
    },
    async write(entries) {
      if (!(await adapter.exists(dir))) await adapter.mkdir(dir)
      await adapter.writeBinary(path, bytes(JSON.stringify({ chats: entries })))
    },
  }
}

/** The entries out of an index file's text, or null when it is not an index. */
function parseChatIndex(text: string): AiChatHistoryEntry[] | null {
  try {
    const parsed = JSON.parse(text) as { chats?: unknown }
    if (!Array.isArray(parsed?.chats)) return null
    return parsed.chats.filter(isEntry)
  } catch {
    return null
  }
}

function isEntry(raw: unknown): raw is AiChatHistoryEntry {
  const entry = raw as Partial<AiChatHistoryEntry> | null
  return typeof entry?.path === 'string' && entry.path !== ''
}

/**
 * One index out of the one this device holds and one that arrived — an older build's, out of a
 * `data.json`. A path is one chat: this device's entry for it stands, and the other only adds
 * the chats this one did not list. Newest first, as the history shows them.
 */
export function mergeChatIndex(
  held: AiChatHistoryEntry[],
  arriving: unknown[]
): AiChatHistoryEntry[] {
  const merged = [...held]
  const known = new Set(held.map((entry) => entry.path))
  let added = false
  for (const entry of arriving.filter(isEntry)) {
    if (known.has(entry.path)) continue
    known.add(entry.path)
    merged.push(entry)
    added = true
  }
  if (added) merged.sort((a, b) => (b.created || '').localeCompare(a.created || ''))
  return merged
}
