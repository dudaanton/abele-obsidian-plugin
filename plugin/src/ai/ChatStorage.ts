import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { TFile } from 'obsidian'
import dayjs from 'dayjs'
import { getAvailablePath } from '@/helpers/vaultUtils'
import { renderTemplate } from '@/helpers/notesUtils'
import { DATE_FORMAT } from '@/constants/dates'
import { AiChatHistoryEntry, DEFAULT_AI_SETTINGS, type TouchedNote } from './types'
import { RunStorage } from './RunStorage'
import { ChatService } from './ChatService'
import {
  parseChat,
  parseChatMetadata,
  serializeChat,
  serializeMetadata,
  type ChatSnapshot,
  type ChatWritePlan,
  type ParsedChat,
} from './ChatLog'

export class ChatStorage {
  private static instance: ChatStorage | null = null

  static getInstance(): ChatStorage {
    if (!ChatStorage.instance) {
      ChatStorage.instance = new ChatStorage()
    }
    return ChatStorage.instance
  }

  private resolveChatPath(title: string): string {
    const template = AbeleConfig.getInstance().ai.chatFolder
    const name = title.replace(/[\\/:*?"<>|]/g, '-')
    const rendered = renderTemplate(template, {
      name,
      date: dayjs().format(DATE_FORMAT),
    })
    return rendered.endsWith('.abchat') ? rendered : `${rendered}.abchat`
  }

  /**
   * Writes what the plan says, and nothing more.
   *
   * The plan comes from the session's `ChatLogWriter`, which knows what the file already
   * holds. A turn usually appends a few lines; the whole file is rewritten only for a new
   * chat, a migration, or a compaction.
   */
  async saveChat(
    snapshot: ChatSnapshot,
    plan: ChatWritePlan,
    existingFile?: TFile
  ): Promise<TFile | null> {
    const { app } = GlobalStore.getInstance()
    const { metadata } = snapshot

    if (plan.kind === 'noop') return existingFile ?? null

    if (existingFile) {
      if (plan.kind === 'append') await app.vault.append(existingFile, plan.data)
      else await app.vault.modify(existingFile, plan.content)
      this.updateHistoryEntry(existingFile.path, metadata.title || existingFile.basename)
      return existingFile
    }

    const content = plan.kind === 'rewrite' ? plan.content : serializeChat(snapshot)
    const title = metadata.title || `Chat ${dayjs().format('YYYY-MM-DD HH-mm')}`
    const desiredPath = this.resolveChatPath(title)

    // Ensure parent folder exists
    const folder = desiredPath.substring(0, desiredPath.lastIndexOf('/'))
    if (folder) await this.ensureFolder(folder)

    const path = await getAvailablePath(desiredPath)
    const file = await app.vault.create(path, content)

    this.addHistoryEntry({
      path: file.path,
      title: metadata.title || title,
      created: metadata.created || dayjs().format('YYYY-MM-DD'),
    })

    return file
  }

  async loadChat(file: TFile): Promise<ParsedChat> {
    const { app } = GlobalStore.getInstance()
    const parsed = parseChat(await app.vault.read(file))

    if (parsed.damaged) {
      console.warn(`[Abele] ${file.path}: skipped ${parsed.damaged} unreadable record(s)`)
    }

    return parsed
  }

  getHistory(): AiChatHistoryEntry[] {
    return AbeleConfig.getInstance().ai.chatHistory || []
  }

  /**
   * Walks the chat folder: adds what is not in the index, and re-reads what has changed.
   *
   * Both halves exist for the same reason. The file is the source of truth for a chat's links,
   * its recap and its agent; the index is a copy in `data.json`, and `data.json` does not merge
   * across devices. A chat answered on a phone arrives here as a file this machine has either
   * never seen — the first half — or has an entry for that was written before any of that
   * happened, and names no notes at all. That second one is what a person saw as "I only see
   * the linked chats on the phone".
   *
   * `mtime` is what keeps it cheap: a chat folder is every conversation ever had, and each
   * file is the whole of one. Only a file that has moved on since it was last read is read.
   */
  async refreshHistory(): Promise<AiChatHistoryEntry[]> {
    const config = AbeleConfig.getInstance()
    const { app } = GlobalStore.getInstance()

    if (!config.ai.chatHistory) config.ai.chatHistory = []
    const known = new Map(config.ai.chatHistory.map((e) => [e.path, e]))

    // Derive base folder from chatFolder template (strip {{...}} parts)
    const baseFolder = config.ai.chatFolder.replace(/\/?\{\{.*$/, '').replace(/\/$/, '')
    if (!baseFolder) return config.ai.chatHistory

    const folder = app.vault.getAbstractFileByPath(baseFolder)
    if (!folder) return config.ai.chatHistory

    const files: TFile[] = []
    const collect = (f: any) => {
      if (f instanceof TFile && (f.extension === 'abchat' || f.extension === 'json')) {
        files.push(f)
      }
      if (f.children) f.children.forEach(collect)
    }
    collect(folder)

    let added = 0
    let changed = false
    for (const file of files) {
      const entry = known.get(file.path)
      if (entry) {
        // Ours and open in a tab writes through `linkNotes` as it goes, so the index is
        // already ahead of anything read here; everything else is judged by the clock.
        if (entry.mtime === file.stat.mtime) continue
        changed = (await this.syncEntry(entry, file)) || changed
        continue
      }

      try {
        // Only the metadata is needed here, and in a log that is one line out of thousands.
        const metadata = parseChatMetadata(await app.vault.read(file))
        if (metadata?.type !== 'abele-chat') continue
        config.ai.chatHistory.push({
          path: file.path,
          title: metadata.title || file.basename,
          created: metadata.created || '',
          // The file is the source of truth for these three; this is where the index is
          // rebuilt out of it, for a chat that arrived by sync or a restore.
          notes: metadata.touched?.length ? metadata.touched : undefined,
          recap: metadata.recap || undefined,
          agentId: metadata.agentId || undefined,
          mtime: file.stat.mtime,
        })
        added++
      } catch {
        // Not a valid chat file
      }
    }

    if (added) {
      config.ai.chatHistory.sort((a, b) => (b.created || '').localeCompare(a.created || ''))
    }
    if (added || changed) {
      // Those entries were built out of the files' own `touched`, so they carry links nothing
      // has drawn yet.
      GlobalStore.getInstance().chatLinksVersion.value++
      config.saveSettings()
    }

    return config.ai.chatHistory
  }

  /**
   * One chat file, read back into its entry — for the vault saying it has changed.
   *
   * Sync lands while the app is running, under a footer that is already on screen. Nothing is
   * done for a file with no entry: an unknown chat joins the index through `refreshHistory`,
   * which is where the folder is walked and the file is judged to be a chat at all.
   */
  async refreshEntry(file: TFile): Promise<void> {
    const config = AbeleConfig.getInstance()
    const entry = config.ai.chatHistory?.find((e) => e.path === file.path)
    if (!entry || entry.mtime === file.stat.mtime) return

    if (await this.syncEntry(entry, file)) {
      GlobalStore.getInstance().chatLinksVersion.value++
      config.saveSettings()
    }
  }

  /**
   * Copies what a chat file says about itself into its index entry.
   *
   * Answers whether anything a reader would notice moved, so the caller can decide whether to
   * pay for a settings write: the index is one JSON file holding every chat's entry.
   */
  private async syncEntry(entry: AiChatHistoryEntry, file: TFile): Promise<boolean> {
    const { app } = GlobalStore.getInstance()

    let metadata
    try {
      metadata = parseChatMetadata(await app.vault.read(file))
    } catch {
      return false
    }
    // The clock is recorded either way: a file that cannot be parsed as a chat is not a file
    // to try again on every refresh.
    const seen = entry.mtime
    entry.mtime = file.stat.mtime
    if (metadata?.type !== 'abele-chat') return seen === undefined

    // The three the type calls mirrored, and not the title: a chat renamed here has its new
    // name in the index before the file has been written again, and reading the file back
    // would take that name away from the person who just gave it.
    const notes = metadata.touched?.length ? metadata.touched : undefined
    const recap = metadata.recap || undefined
    const agentId = metadata.agentId || undefined

    const same =
      JSON.stringify(entry.notes) === JSON.stringify(notes) &&
      entry.recap === recap &&
      entry.agentId === agentId

    entry.notes = notes
    entry.recap = recap
    entry.agentId = agentId

    return !same || seen === undefined
  }

  async renameChat(file: TFile, newTitle: string): Promise<TFile | null> {
    const { app } = GlobalStore.getInstance()
    const oldPath = file.path
    const newPath = this.resolveChatPath(newTitle)

    // Same path — nothing to do
    if (oldPath === newPath) return null

    const folder = newPath.substring(0, newPath.lastIndexOf('/'))
    if (folder) await this.ensureFolder(folder)

    const availablePath = await getAvailablePath(newPath)
    await app.fileManager.renameFile(file, availablePath)

    // Update history entry
    const config = AbeleConfig.getInstance()
    const entry = config.ai.chatHistory?.find((e) => e.path === oldPath)
    if (entry) {
      entry.path = availablePath
      entry.title = newTitle
      // The card opens the chat by path, and the title is what it shows.
      GlobalStore.getInstance().chatLinksVersion.value++
      await config.saveSettings()
    }

    return app.vault.getFileByPath(availablePath)
  }

  async deleteChat(path: string): Promise<void> {
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(path)
    if (file instanceof TFile) {
      // Delegated runs live in sidecar files reachable only through this chat. Left behind,
      // they would be unreachable clutter that nothing ever cleans up.
      await this.deleteRunsOf(file)
      await app.fileManager.trashFile(file)
    }
    this.removeHistoryEntry(path)
  }

  private async deleteRunsOf(file: TFile): Promise<void> {
    const { app } = GlobalStore.getInstance()
    try {
      const data = parseChat(await app.vault.read(file))
      const runIds = (data.messages ?? [])
        .map((m) => m.subAgentRun?.runId)
        .filter((id): id is string => Boolean(id))
      if (runIds.length) await RunStorage.getInstance().deleteRuns(runIds)
    } catch {
      // An unreadable chat file has no runs we can identify; deleting it is still correct.
    }
  }

  async migrateChats(): Promise<number> {
    const { app } = GlobalStore.getInstance()
    const config = AbeleConfig.getInstance()
    const history = [...(config.ai.chatHistory || [])]
    let moved = 0

    for (const entry of history) {
      const file = app.vault.getAbstractFileByPath(entry.path)
      if (!(file instanceof TFile)) continue

      const newDesired = this.resolveChatPath(entry.title || file.basename)
      if (newDesired === entry.path) continue

      const folder = newDesired.substring(0, newDesired.lastIndexOf('/'))
      if (folder) await this.ensureFolder(folder)

      const availablePath = await getAvailablePath(newDesired)
      await app.fileManager.renameFile(file, availablePath)
      entry.path = availablePath
      moved++
    }

    config.ai.chatHistory = history
    await config.saveSettings()
    return moved
  }

  // ── History management (stored in plugin data.json) ──

  /** Public because expansion adds a comment file to the history the moment it becomes a chat. */
  addHistoryEntry(entry: AiChatHistoryEntry): void {
    const config = AbeleConfig.getInstance()
    if (!config.ai.chatHistory) config.ai.chatHistory = []
    // The path is the identity of a chat, and expansion runs again every time a comment is
    // reopened from its file — so without this the same conversation is listed twice.
    if (config.ai.chatHistory.some((e) => e.path === entry.path)) return
    config.ai.chatHistory.unshift(entry)
    // A chat arriving in the index may already name notes — an expanded comment does, and so
    // does one that came in by sync. Without this its card never appears under them.
    GlobalStore.getInstance().chatLinksVersion.value++
    config.saveSettings()
  }

  /**
   * Mirrors a chat's note links into its history entry, so a footer never opens a chat file.
   *
   * A no-op when the path has no entry — which is how an unexpanded comment stays out of every
   * footer without a rule of its own: a comment is not in the history until it is expanded.
   */
  linkNotes(chatPath: string, notes: TouchedNote[], recap?: string, agentId?: string): void {
    const config = AbeleConfig.getInstance()
    const entry = config.ai.chatHistory?.find((e) => e.path === chatPath)
    if (!entry) return

    const next = notes.length ? notes : undefined
    const unchanged =
      JSON.stringify(entry.notes) === JSON.stringify(next) &&
      entry.recap === (recap || undefined) &&
      entry.agentId === (agentId || undefined)
    // Settings are one JSON file holding every chat's entry, so a save that changed nothing
    // costs more than the chat write that prompted it. Same guard as `updateHistoryEntry`.
    if (unchanged) return

    entry.notes = next
    entry.recap = recap || undefined
    entry.agentId = agentId || undefined
    GlobalStore.getInstance().chatLinksVersion.value++
    config.saveSettings()
  }

  /**
   * The folder comments live in.
   *
   * Here rather than on `CommentService`, which reads it through this: the two answers have to
   * be the same one, and a blank setting meaning the built-in folder to one reader and nothing
   * at all to the other is how the rename skip stopped holding.
   */
  static commentsFolder(): string {
    return AbeleConfig.getInstance().ai.commentFolder || DEFAULT_AI_SETTINGS.commentFolder
  }

  /** Whether a chat file lives in the comments folder, and so is a comment's to rewrite. */
  private isCommentPath(path: string): boolean {
    return path.startsWith(`${ChatStorage.commentsFolder()}/`)
  }

  /**
   * Rewrites one note path in a list of links, keeping when it was written.
   *
   * Static because `CommentService` needs the same rewrite over a comment's file, and a rename
   * that produced two different answers in the two places is the bug this avoids.
   */
  static renamedNotes(notes: TouchedNote[], oldPath: string, newPath: string): TouchedNote[] {
    return notes.map((note) => (note.path === oldPath ? { path: newPath, at: note.at } : note))
  }

  /**
   * Follows a renamed note into every chat that wrote it — the index entry and the file both.
   *
   * Only the chats that name the old path are read: a rename of a note nothing worked on costs
   * one walk of an in-memory array and no disk at all.
   */
  async handleNoteRename(oldPath: string, newPath: string): Promise<void> {
    const { app } = GlobalStore.getInstance()
    const config = AbeleConfig.getInstance()
    const affected = this.getHistory().filter((entry) =>
      entry.notes?.some((note) => note.path === oldPath)
    )
    if (!affected.length) return

    for (const entry of affected) {
      entry.notes = ChatStorage.renamedNotes(entry.notes ?? [], oldPath, newPath)

      // Through the open session when there is one, so its log writer stays in step with the
      // file it thinks it wrote; otherwise straight onto the end of the file, which is what a
      // chat log is — the last meta record wins.
      const session = ChatService.getInstance().getSessionByFile(entry.path)
      if (session) {
        session.touched.value = ChatStorage.renamedNotes(session.touched.value, oldPath, newPath)
        await session.save()
        continue
      }

      // A comment's file belongs to `CommentService.handleRename`, which rewrites `touched`
      // there alongside the anchor. Both walks run on the same rename, and two of them reading
      // this file and appending to it would leave whichever landed last overwriting the
      // other's field — the anchor or the links, at random.
      if (this.isCommentPath(entry.path)) continue

      const file = app.vault.getAbstractFileByPath(entry.path)
      if (!(file instanceof TFile)) continue
      const metadata = parseChatMetadata(await app.vault.read(file))
      if (!metadata?.touched?.length) continue
      const touched = ChatStorage.renamedNotes(metadata.touched, oldPath, newPath)
      if (JSON.stringify(touched) === JSON.stringify(metadata.touched)) continue
      await app.vault.append(file, serializeMetadata({ ...metadata, touched }))
    }

    GlobalStore.getInstance().chatLinksVersion.value++
    await config.saveSettings()
  }

  /**
   * Settings are a single JSON file holding every setting and every chat's history entry, so
   * writing them on a save that changed no title would cost more than the chat write itself.
   */
  private updateHistoryEntry(path: string, title: string): void {
    const config = AbeleConfig.getInstance()
    const entry = config.ai.chatHistory?.find((e) => e.path === path)
    if (entry && entry.title !== title) {
      entry.title = title
      config.saveSettings()
    }
  }

  /**
   * Public for the other direction: a comment returned to its note is a margin note again,
   * and a margin note has no business in the list of conversations somebody browses.
   */
  removeHistoryEntry(path: string): void {
    const config = AbeleConfig.getInstance()
    if (!config.ai.chatHistory) return
    config.ai.chatHistory = config.ai.chatHistory.filter((e) => e.path !== path)
    // The entry carried the links, so its card has to go with it — a comment sent back to its
    // note, or a chat deleted, must not leave a card behind pointing at nothing.
    GlobalStore.getInstance().chatLinksVersion.value++
    config.saveSettings()
  }

  /** Public because `CommentService` creates the comment folder before writing into it. */
  async ensureFolder(path: string): Promise<void> {
    const { app } = GlobalStore.getInstance()
    const parts = path.split('/')
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      if (!app.vault.getAbstractFileByPath(current)) {
        await app.vault.createFolder(current)
      }
    }
  }

  static destroy(): void {
    ChatStorage.instance = null
  }
}
