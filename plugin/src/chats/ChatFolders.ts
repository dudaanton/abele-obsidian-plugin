import { t } from '@/i18n'
import { computed, shallowRef } from 'vue'
import { TFile, type App, type EventRef } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { ChatService } from '@/ai/ChatService'
import type { ToolMode } from '@/ai/types'
import { withFolderAccess, type ChatTreeFolder } from './chatTree'
import { ChatStorage } from '@/ai/ChatStorage'
import { parseChat, parseChatMetadata, serializeMetadata, serializeChat } from '@/ai/ChatLog'

const validName = (name: string) =>
  !!name.trim() &&
  !/[\\/:*?"<>|]/.test(name) &&
  !['.', '..'].includes(name) &&
  !name.startsWith('.')

interface FolderRecord {
  id: string
  name: string
  parent: string | null
  order: number
  access?: Record<string, ToolMode>
}
interface Catalog {
  version: 1
  folders: FolderRecord[]
  nodes: Record<string, string | null>
}
const CATALOG_FILE = '_folders.abelechats'

/** Synced logical folders; storage directories never determine placement. */
export class ChatFolders {
  readonly access = shallowRef<Record<string, Record<string, ToolMode>>>({})
  readonly revision = shallowRef(0)
  private catalog: Catalog = { version: 1, folders: [], nodes: {} }
  private membership = new Map<string, string | null | undefined>()
  private metadata = new Map<TFile, { mtime: number; size: number; folder?: string | null }>()
  private events: EventRef[] = []
  private loadedRoot = ''
  private dead = false
  private mutation: Promise<unknown> = Promise.resolve()
  private releaseSettings: () => void
  private mutate<T>(action: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(action, action)
    this.mutation = result.catch(() => {})
    return result
  }
  private readonly configuredRoot = () =>
    (AbeleConfig.getInstance().ai?.chatFolder ?? '').replace(/\/?\{\{.*$/, '').replace(/\/$/, '')
  readonly root = computed(() => {
    void this.revision.value
    return this.configuredRoot()
  })
  constructor(
    private app: App,
    private service: ChatService
  ) {
    this.releaseSettings = AbeleConfig.getInstance().onSaved(() => {
      void this.reload()
    })
    for (const event of ['create', 'delete', 'modify', 'rename'] as const)
      this.events.push(
        app.vault.on(event as 'create', (file) => {
          if (file instanceof TFile) this.metadata.delete(file)
          if (file instanceof TFile && (file.extension === 'abchat' || file.name === CATALOG_FILE))
            void this.reload().catch((error) =>
              console.debug('[Abele] Could not reload chat folders', error)
            )
        })
      )
    void this.reload().catch((error) =>
      console.debug('[Abele] Could not reload chat folders', error)
    )
  }
  private folderPath(id: string | null | undefined, seen = new Set<string>()): string {
    if (!id || seen.has(id)) return ''
    seen.add(id)
    const folder = this.catalog.folders.find((folder) => folder.id === id)
    if (!folder) return ''
    const parent = this.folderPath(folder.parent, seen)
    return parent ? `${parent}/${folder.name}` : folder.name
  }
  get paths(): string[] {
    void this.revision.value
    return [...this.catalog.folders]
      .sort((a, b) => a.order - b.order)
      .map((folder) => this.folderPath(folder.id))
  }
  private record(path: string): FolderRecord | undefined {
    return this.catalog.folders.find((folder) => this.folderPath(folder.id) === path)
  }
  membershipOf(key: string): string | null | undefined {
    void this.revision.value
    if (this.membership.has(key)) return this.membership.get(key)
    const session = this.service.getSessionByFile(key)
    if (session && this.membership.has(session.id)) return this.membership.get(session.id)
    return this.catalog.nodes[key]
  }
  noteFile(file: TFile, folder: string | null | undefined): void {
    const previous = this.membership.get(file.path)
    const session = this.service.getSessionByFile(file.path)
    if (session) this.membership.delete(session.id)
    // Keep an absent placement absent, so saving an unfiled chat does not rewrite its metadata.
    this.membership.set(file.path, folder)
    if (file.stat) this.metadata.set(file, { mtime: file.stat.mtime, size: file.stat.size, folder })
    if (previous !== folder) this.revision.value++
  }
  folderOf(key: string): string {
    return this.folderPath(this.membershipOf(key))
  }
  /** The configured storage root, never a logical folder's directory. */
  path(_folder: string): string {
    if (!this.root.value) throw new Error(t('chatTree.configureFolder'))
    return this.root.value
  }
  private async persist(): Promise<void> {
    await ChatStorage.getInstance().ensureFolder(this.path(''))
    await ChatStorage.getInstance().writeFolderAccess(
      `${this.root.value}/${CATALOG_FILE}`,
      JSON.stringify(this.catalog)
    )
    this.publish()
  }
  private publish(): void {
    this.access.value = Object.fromEntries(
      this.catalog.folders.map((folder) => [this.folderPath(folder.id), folder.access ?? {}])
    )
    this.revision.value++
  }
  reload(): Promise<void> {
    return this.mutate(() => this.load())
  }
  private async load(): Promise<void> {
    if (this.dead) return
    if (this.loadedRoot !== this.root.value) {
      this.catalog = { version: 1, folders: [], nodes: {} }
      this.membership.clear()
      this.loadedRoot = this.root.value
    }
    const file = this.app.vault.getAbstractFileByPath(`${this.root.value}/${CATALOG_FILE}`)
    if (file instanceof TFile) {
      const data = JSON.parse(await ChatStorage.getInstance().readNavigationFile(file)) as Catalog
      if (data.version !== 1 || !Array.isArray(data.folders) || !data.nodes)
        throw new Error('Invalid chat folder catalog')
      this.catalog = data
    }
    const membership = new Map(
      [...this.membership].filter(([key]) => !!this.service.getSession(key))
    )
    for (const chat of this.app.vault.getFiles()) {
      if (chat.extension !== 'abchat') continue
      let cached = this.metadata.get(chat)
      if (!cached || cached.mtime !== chat.stat.mtime || cached.size !== chat.stat.size) {
        const metadata = parseChatMetadata(await ChatStorage.getInstance().readNavigationFile(chat))
        if (metadata?.type !== 'abele-chat') continue
        cached = { mtime: chat.stat.mtime, size: chat.stat.size, folder: metadata.treeFolderId }
        this.metadata.set(chat, cached)
      }
      membership.set(chat.path, cached.folder)
    }
    const present = new Set(this.app.vault.getFiles())
    for (const cached of this.metadata.keys())
      if (!present.has(cached)) this.metadata.delete(cached)
    this.membership = membership
    this.publish()
  }
  accessFor(path: string, base: Record<string, ToolMode>) {
    return this.accessForFolder(this.folderOf(path), base)
  }
  accessForFolder(path: string, base: Record<string, ToolMode>) {
    const parts = path.split('/').filter(Boolean)
    return withFolderAccess(
      base,
      parts.map(
        (name, index): ChatTreeFolder => ({
          kind: 'folder',
          name,
          path: parts.slice(0, index + 1).join('/'),
          children: [],
          access: this.access.value[parts.slice(0, index + 1).join('/')],
        })
      )
    )
  }
  create(parent: string, name: string): Promise<void> {
    return this.mutate(async () => {
      await this.load()
      if (!validName(name)) throw new Error(t('chatTree.invalidFolder'))
      if (parent && !this.record(parent)) throw new Error(t('chatTree.folderMissing'))
      if (this.record(parent ? `${parent}/${name}` : name))
        throw new Error(t('chatTree.folderExists'))
      this.catalog.folders.push({
        id: crypto.randomUUID(),
        name,
        parent: this.record(parent)?.id ?? null,
        order: this.catalog.folders.length,
      })
      await this.persist()
    })
  }
  setAccess(folder: string, modes: Record<string, ToolMode>): Promise<void> {
    return this.mutate(async () => {
      await this.load()
      const record = this.record(folder)
      if (!record) throw new Error(t('chatTree.folderMissing'))
      record.access = { ...record.access, ...modes }
      await this.persist()
    })
  }
  move(id: string, folder: string): Promise<void> {
    return this.moveMany([id], folder)
  }
  moveMany(ids: string[], folder: string): Promise<void> {
    const sources = ids.map((id) => ({
      id,
      version: this.service.getSession(id)?.conversationVersion.value,
    }))
    return this.mutate(async () => {
      await this.load()
      const target = this.record(folder)
      if (folder && !target) throw new Error(t('chatTree.folderMissing'))
      for (const source of sources) {
        const session = this.service.getSession(source.id)
        if (
          source.version !== undefined &&
          (!session || session.conversationVersion.value !== source.version)
        )
          continue
        const id = target?.id ?? null
        if (session) {
          if (session.currentChatFile.value) await session.saveForRelease()
          const file = session.currentChatFile.value
          if (file) await this.assignFile(file, id)
          else this.membership.set(source.id, id)
        } else {
          const file = this.app.vault.getAbstractFileByPath(source.id)
          if (file instanceof TFile && file.extension === 'abchat') await this.assignFile(file, id)
          else if (source.id.startsWith('node:')) this.catalog.nodes[source.id] = id
        }
      }
      await this.persist()
    })
  }
  /** Drops a deleted node chat's placement from the synced catalog. */
  forgetNode(id: string): Promise<void> {
    return this.mutate(async () => {
      await this.load()
      if (!(id in this.catalog.nodes)) return
      delete this.catalog.nodes[id]
      await this.persist()
    })
  }
  private async assignFile(file: TFile, id: string | null): Promise<void> {
    await ChatStorage.getInstance().transformDiscussion(file, (content) => {
      const parsed = parseChat(content)
      if (!parsed.metadata) throw new Error('Invalid chat metadata')
      if (parsed.metadata.treeFolderId === id) return content
      const metadata = { ...parsed.metadata, treeFolderId: id }
      return parsed.version === 1
        ? serializeChat({ ...parsed, metadata })
        : content + serializeMetadata(metadata)
    })
    this.membership.set(file.path, id)
    this.metadata.set(file, { mtime: file.stat.mtime, size: file.stat.size, folder: id })
  }
  rename(folder: string, name: string): Promise<void> {
    return this.mutate(async () => {
      await this.load()
      if (!folder) throw new Error(t('chatTree.renameRoot'))
      if (!validName(name)) throw new Error(t('chatTree.invalidFolder'))
      const record = this.record(folder)
      if (!record) throw new Error(t('chatTree.folderMissing'))
      if (
        this.catalog.folders.some((other) => other.parent === record.parent && other.name === name)
      )
        throw new Error(t('chatTree.folderExists'))
      record.name = name
      await this.persist()
    })
  }
  remove(folder: string): Promise<void> {
    return this.mutate(async () => {
      await this.load()
      if (!folder) throw new Error(t('chatTree.deleteRoot'))
      const record = this.record(folder)
      if (!record) return
      for (const child of this.catalog.folders) {
        if (child.parent !== record.id) continue
        const original = child.name
        let suffix = 2
        while (
          this.catalog.folders.some(
            (other) =>
              other !== child && other.parent === record.parent && other.name === child.name
          )
        )
          child.name = `${original} ${suffix++}`
        child.parent = record.parent
      }
      for (const [key, id] of this.membership) {
        if (id !== record.id) continue
        const file = this.app.vault.getAbstractFileByPath(key)
        if (file instanceof TFile) await this.assignFile(file, record.parent)
        else this.membership.set(key, record.parent)
      }
      for (const [key, id] of Object.entries(this.catalog.nodes))
        if (id === record.id) this.catalog.nodes[key] = record.parent
      this.catalog.folders = this.catalog.folders.filter((folder) => folder !== record)
      await this.persist()
    })
  }
  destroy(): void {
    this.releaseSettings()
    this.dead = true
    for (const event of this.events) this.app.vault.offref(event)
    this.events = []
  }
}
