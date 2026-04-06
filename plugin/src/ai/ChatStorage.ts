import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { TFile } from 'obsidian'
import dayjs from 'dayjs'
import { ChatMessage, ChatMetadata } from './types'

const ESCAPE_TOKEN = '<!-- abele-msg-esc -->'

export class ChatStorage {
  private static instance: ChatStorage

  static getInstance(): ChatStorage {
    if (!ChatStorage.instance) {
      ChatStorage.instance = new ChatStorage()
    }
    return ChatStorage.instance
  }

  private get separator(): string {
    return AbeleConfig.getInstance().ai.messageSeparator
  }

  private get chatFolder(): string {
    const raw = AbeleConfig.getInstance().ai.chatFolder
    return dayjs().format(raw)
  }

  private escape(content: string): string {
    if (!content.includes(this.separator)) return content
    return content.replaceAll(this.separator, ESCAPE_TOKEN)
  }

  private unescape(content: string): string {
    if (!content.includes(ESCAPE_TOKEN)) return content
    return content.replaceAll(ESCAPE_TOKEN, this.separator)
  }

  serializeMessages(messages: ChatMessage[], metadata: ChatMetadata): string {
    const sep = this.separator
    const frontmatter = [
      '---',
      `type: ${metadata.type}`,
      `provider: ${metadata.providerId}`,
      `model: ${metadata.modelId}`,
      `created: ${metadata.created}`,
      metadata.title ? `title: "${metadata.title.replace(/"/g, '\\"')}"` : null,
      '---',
    ]
      .filter(Boolean)
      .join('\n')

    const serializedMessages = messages.map((msg) => {
      const header = [`role: ${msg.role}`]
      if (msg.toolName) header.push(`tool: ${msg.toolName}`)
      if (msg.toolStatus) header.push(`status: ${msg.toolStatus}`)
      if (msg.toolParams) header.push(`params: ${JSON.stringify(msg.toolParams)}`)
      header.push(`timestamp: ${msg.timestamp}`)

      let body = this.escape(msg.content)
      if (msg.thinking) {
        body = `<details><summary>Thinking</summary>\n\n${this.escape(msg.thinking)}\n\n</details>\n\n${body}`
      }

      return `${sep}\n${header.join('\n')}\n---\n${body}`
    })

    return frontmatter + '\n\n' + serializedMessages.join('\n\n')
  }

  parseMessages(content: string): { metadata: ChatMetadata | null; messages: ChatMessage[] } {
    const sep = this.separator

    // Extract frontmatter
    let metadata: ChatMetadata | null = null
    let body = content
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/)
    if (fmMatch) {
      const fm = fmMatch[1]
      metadata = {
        type: 'ai-chat',
        providerId: this.extractYamlValue(fm, 'provider') || '',
        modelId: this.extractYamlValue(fm, 'model') || '',
        created: this.extractYamlValue(fm, 'created') || '',
        title: this.extractYamlValue(fm, 'title')?.replace(/^"|"$/g, '') || undefined,
      }
      body = content.slice(fmMatch[0].length)
    }

    // Split by separator
    const parts = body.split(sep).filter((p) => p.trim())

    const messages: ChatMessage[] = parts.map((part) => {
      const headerBodySplit = part.indexOf('\n---\n')
      if (headerBodySplit === -1) {
        return {
          role: 'user' as const,
          content: this.unescape(part.trim()),
          timestamp: Date.now(),
        }
      }

      const headerStr = part.slice(0, headerBodySplit).trim()
      let bodyStr = part.slice(headerBodySplit + 5).trim()

      const role = (this.extractYamlValue(headerStr, 'role') || 'user') as ChatMessage['role']
      const toolName = this.extractYamlValue(headerStr, 'tool') || undefined
      const toolStatus =
        (this.extractYamlValue(headerStr, 'status') as ChatMessage['toolStatus']) || undefined
      const paramsStr = this.extractYamlValue(headerStr, 'params')
      const toolParams = paramsStr ? JSON.parse(paramsStr) : undefined
      const timestamp = parseInt(this.extractYamlValue(headerStr, 'timestamp') || '0') || Date.now()

      // Extract thinking from <details> block
      let thinking: string | undefined
      const thinkingMatch = bodyStr.match(
        /^<details><summary>Thinking<\/summary>\n\n([\s\S]*?)\n\n<\/details>\n\n/
      )
      if (thinkingMatch) {
        thinking = this.unescape(thinkingMatch[1])
        bodyStr = bodyStr.slice(thinkingMatch[0].length)
      }

      return {
        role,
        content: this.unescape(bodyStr),
        thinking,
        toolName,
        toolParams,
        toolStatus,
        timestamp,
      }
    })

    return { metadata, messages }
  }

  private extractYamlValue(yaml: string, key: string): string | null {
    const match = yaml.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))
    return match ? match[1].trim() : null
  }

  async saveChat(
    messages: ChatMessage[],
    metadata: ChatMetadata,
    existingFile?: TFile
  ): Promise<TFile> {
    const { app } = GlobalStore.getInstance()
    const content = this.serializeMessages(messages, metadata)

    if (existingFile) {
      await app.vault.modify(existingFile, content)
      return existingFile
    }

    const folder = this.chatFolder
    await this.ensureFolder(folder)

    const title = metadata.title || `Chat ${dayjs().format('YYYY-MM-DD HH-mm')}`
    const safeName = title.replace(/[\\/:*?"<>|]/g, '-')
    const path = `${folder}/${safeName}.md`

    const existing = app.vault.getAbstractFileByPath(path)
    if (existing instanceof TFile) {
      await app.vault.modify(existing, content)
      return existing
    }

    return await app.vault.create(path, content)
  }

  async loadChat(file: TFile): Promise<{ metadata: ChatMetadata | null; messages: ChatMessage[] }> {
    const { app } = GlobalStore.getInstance()
    const content = await app.vault.read(file)
    return this.parseMessages(content)
  }

  async listChats(): Promise<TFile[]> {
    const { app } = GlobalStore.getInstance()
    const files = app.vault.getMarkdownFiles()

    return files
      .filter((f) => {
        const cache = app.metadataCache.getFileCache(f)
        return cache?.frontmatter?.type === 'ai-chat'
      })
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
  }

  private async ensureFolder(path: string): Promise<void> {
    const { app } = GlobalStore.getInstance()
    const parts = path.split('/')
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      const existing = app.vault.getAbstractFileByPath(current)
      if (!existing) {
        await app.vault.createFolder(current)
      }
    }
  }
}
