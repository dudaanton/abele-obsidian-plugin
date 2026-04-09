import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { TFile } from 'obsidian'
import dayjs from 'dayjs'
import { getAvailablePath } from '@/helpers/vaultUtils'
import { renderTemplate } from '@/helpers/notesUtils'
import { DATE_FORMAT } from '@/constants/dates'
import { ChatMessage, ChatMetadata, AiChatHistoryEntry } from './types'
import type { Message } from './client'

interface ChatFile {
  metadata: ChatMetadata
  messages: ChatMessage[]
  internalMessages?: Message[]
}

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
    return rendered.endsWith('.json') ? rendered : `${rendered}.json`
  }

  async saveChat(
    messages: ChatMessage[],
    metadata: ChatMetadata,
    existingFile?: TFile,
    internalMessages?: Message[]
  ): Promise<TFile> {
    const { app } = GlobalStore.getInstance()
    const data: ChatFile = { metadata, messages, internalMessages }
    const content = JSON.stringify(data, null, 2)

    if (existingFile) {
      await app.vault.modify(existingFile, content)
      this.updateHistoryEntry(existingFile.path, metadata.title || existingFile.basename)
      return existingFile
    }

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

  async loadChat(file: TFile): Promise<{
    metadata: ChatMetadata | null
    messages: ChatMessage[]
    internalMessages?: Message[]
  }> {
    const { app } = GlobalStore.getInstance()
    const content = await app.vault.read(file)
    try {
      const data: ChatFile = JSON.parse(content)
      return {
        metadata: data.metadata,
        messages: data.messages || [],
        internalMessages: data.internalMessages,
      }
    } catch {
      return { metadata: null, messages: [] }
    }
  }

  getHistory(): AiChatHistoryEntry[] {
    return AbeleConfig.getInstance().ai.chatHistory || []
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

    return app.vault.getAbstractFileByPath(availablePath) as TFile
  }

  async deleteChat(path: string): Promise<void> {
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(path)
    if (file instanceof TFile) {
      await app.vault.trash(file, false)
    }
    this.removeHistoryEntry(path)
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

  private addHistoryEntry(entry: AiChatHistoryEntry): void {
    const config = AbeleConfig.getInstance()
    if (!config.ai.chatHistory) config.ai.chatHistory = []
    config.ai.chatHistory.unshift(entry)
    config.saveSettings()
  }

  private updateHistoryEntry(path: string, title: string): void {
    const config = AbeleConfig.getInstance()
    const entry = config.ai.chatHistory?.find((e) => e.path === path)
    if (entry) {
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

  private async ensureFolder(path: string): Promise<void> {
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
