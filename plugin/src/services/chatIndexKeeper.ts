import type { AiChatHistoryEntry } from '@/ai/types'
import { chatIndexDiskOf } from '@/ai/chatIndexFile'

/**
 * Where the chat index (`ai.chatHistory`) is kept: in a file of its own (`ai/chatIndexFile.ts`)
 * once that file holds it, in `data.json` until then. `AbeleConfig` asks this whether the
 * settings it writes carry the index, and hands it the index to write.
 */
export class ChatIndexKeeper {
  /**
   * Whether the chat index is in its own file. Until it is — the first launch of this build, or
   * a disk that would not take the file — it stays in `data.json` as it always was, so no step
   * of the move can lose a chat.
   */
  onDisk = false
  /** Whether the settings last applied carried an index of their own: an older build's. */
  inSettings = false
  /** The chat index writes, one after another, and what the last of them wrote. */
  private saving: Promise<void> = Promise.resolve()
  private written: string | null = null
  /**
   * The index file is there and could not be read — not a file that would not parse, which is
   * kept aside, but a disk that would not hand it over: a phone's iCloud copy not downloaded
   * yet. Writing it now would put the index in memory over one nobody has seen, so for this
   * launch it is not written at all, and `data.json` does not take it either: the index is a
   * cache, rebuilt from the chat files.
   */
  blocked = false

  /** A new launch: nothing is known of the file yet. */
  reset(): void {
    this.onDisk = false
    this.written = null
    this.blocked = false
  }

  /** Whether `data.json` goes without the index: it is in its file, or kept out of both. */
  get outOfSettings(): boolean {
    return this.onDisk || this.blocked
  }

  /**
   * The index written to its own file, one write at a time; answers whether the file holds it
   * now. False with no file to write to, or when the disk refused — the index is then in
   * `data.json`'s export again, and the caller decides whether to write that. Both `plugin` and
   * `entries` are asked when the write's turn comes, so a chat listed meanwhile goes with it.
   */
  toFile(plugin: () => unknown, entries: () => AiChatHistoryEntry[]): Promise<boolean> {
    const run = this.saving.then(async (): Promise<boolean> => {
      const disk = chatIndexDiskOf(plugin())
      if (disk === null) return false
      if (this.blocked) return true
      const list = entries()
      const text = JSON.stringify(list)
      if (this.onDisk && text === this.written) return true
      try {
        await disk.write(list)
        this.written = text
        this.onDisk = true
        return true
      } catch (error) {
        console.error('[Abele] the chat index could not be written; keeping it in data.json', error)
        this.onDisk = false
        return false
      }
    })
    this.saving = run.then((): void => undefined)
    return run
  }

  /** The index file's entries, or null when there is none that reads. Never throws. */
  async read(plugin: unknown): Promise<AiChatHistoryEntry[] | null> {
    const disk = chatIndexDiskOf(plugin)
    if (disk === null) return null
    try {
      const entries = await disk.read()
      if (entries !== null) this.written = JSON.stringify(entries)
      return entries
    } catch (error) {
      console.error('[Abele] the chat index could not be read; not writing it this launch', error)
      this.blocked = true
      return null
    }
  }
}
