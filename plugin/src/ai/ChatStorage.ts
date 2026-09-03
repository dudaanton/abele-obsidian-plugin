import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { TFile } from 'obsidian'
import dayjs from 'dayjs'
import { getAvailablePath } from '@/helpers/vaultUtils'
import { renderTemplate } from '@/helpers/notesUtils'
import { DATE_FORMAT } from '@/constants/dates'
import { AiChatHistoryEntry } from './types'
import { RunStorage } from './RunStorage'
import {
  parseChat,
  parseChatMetadata,
  serializeChat,
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

  /** Scan chat folder for files not yet in history and add them */
  async refreshHistory(): Promise<AiChatHistoryEntry[]> {
    const config = AbeleConfig.getInstance()
    const { app } = GlobalStore.getInstance()

    if (!config.ai.chatHistory) config.ai.chatHistory = []
    const known = new Set(config.ai.chatHistory.map((e) => e.path))

    // Derive base folder from chatFolder template (strip {{...}} parts)
    const baseFolder = config.ai.chatFolder.replace(/\/?\{\{.*$/, '').replace(/\/$/, '')
    if (!baseFolder) return config.ai.chatHistory

    const folder = app.vault.getAbstractFileByPath(baseFolder)
    if (!folder) return config.ai.chatHistory

    const files: TFile[] = []
    const collect = (f: any) => {
      if (
        f instanceof TFile &&
        (f.extension === 'abchat' || f.extension === 'json') &&
        !known.has(f.path)
      ) {
        files.push(f)
      }
      if (f.children) f.children.forEach(collect)
    }
    collect(folder)

    let added = 0
    for (const file of files) {
      try {
        // Only the metadata is needed here, and in a log that is one line out of thousands.
        const metadata = parseChatMetadata(await app.vault.read(file))
        if (metadata?.type !== 'abele-chat') continue
        config.ai.chatHistory.push({
          path: file.path,
          title: metadata.title || file.basename,
          created: metadata.created || '',
        })
        added++
      } catch {
        // Not a valid chat file
      }
    }

    if (added) {
      config.ai.chatHistory.sort((a, b) => (b.created || '').localeCompare(a.created || ''))
      config.saveSettings()
    }

    return config.ai.chatHistory
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
    config.saveSettings()
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

  private removeHistoryEntry(path: string): void {
    const config = AbeleConfig.getInstance()
    if (!config.ai.chatHistory) return
    config.ai.chatHistory = config.ai.chatHistory.filter((e) => e.path !== path)
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
