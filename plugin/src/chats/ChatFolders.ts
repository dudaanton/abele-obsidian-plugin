import { t } from '@/i18n'
import { computed, shallowRef } from 'vue'
import { TFile, TFolder, type App, type EventRef } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { ChatService } from '@/ai/ChatService'
import type { ToolMode } from '@/ai/types'
import { withFolderAccess, type ChatTreeFolder } from './chatTree'
import { ChatStorage } from '@/ai/ChatStorage'
import { parseChatMetadata, serializeMetadata } from '@/ai/ChatLog'
import { CommentService } from '@/ai/CommentService'
import { RunStorage } from '@/ai/RunStorage'
import { renameDelegationIdentity } from '@/ai/delegationIdentity'

const ACCESS_FILE = '_folder.abeleaccess'
const validName = (name: string) =>
  !!name.trim() &&
  !/[\\/:*?"<>|]/.test(name) &&
  !['.', '..'].includes(name) &&
  !name.startsWith('.')

interface MoveSource {
  id: string
  file: TFile | null
  version?: number
}

/** Vault-backed placement and additive permissions. Nothing moves during discovery. */
export class ChatFolders {
  readonly access = shallowRef<Record<string, Record<string, ToolMode>>>({})
  readonly revision = shallowRef(0)
  private events: EventRef[] = []
  private generation = 0
  private dead = false
  private mutation: Promise<unknown> = Promise.resolve()
  private mutate<T>(action: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(action, action)
    this.mutation = result.catch(() => {})
    return result
  }
  private readonly configuredRoot = () =>
    (AbeleConfig.getInstance().ai?.chatFolder ?? '').replace(/\/?\{\{.*$/, '').replace(/\/$/, '')
  private releaseSettings: () => void
  readonly root = computed(() => {
    void this.revision.value
    return this.configuredRoot()
  })

  constructor(
    private app: App,
    private service: ChatService
  ) {
    this.releaseSettings = AbeleConfig.getInstance().onSaved(() => {
      if (this.configuredRoot() === this.root.value) return
      this.revision.value++
      void this.reload()
    })
    for (const event of ['create', 'delete', 'rename'] as const)
      this.events.push(
        app.vault.on(event as 'create', (file) => {
          if (file.path === this.root.value || file.path.startsWith(`${this.root.value}/`))
            void this.reload()
        })
      )
    this.events.push(
      app.vault.on('modify', (file) => {
        if (file.name === ACCESS_FILE && file.path.startsWith(`${this.root.value}/`))
          void this.reload()
      })
    )
    void this.reload()
  }

  folderOf(path: string): string {
    const parent = path.slice(0, path.lastIndexOf('/'))
    return parent.startsWith(`${this.root.value}/`) ? parent.slice(this.root.value.length + 1) : ''
  }

  path(folder: string): string {
    if (folder && folder.split('/').some((part) => !validName(part)))
      throw new Error(t('chatTree.invalidFolder'))
    if (!this.root.value) throw new Error(t('chatTree.configureFolder'))
    return folder ? `${this.root.value}/${folder}` : this.root.value
  }

  async reload(): Promise<void> {
    const generation = ++this.generation
    const access: Record<string, Record<string, ToolMode>> = {}
    for (const file of this.app.vault.getFiles()) {
      if (!file.path.startsWith(`${this.root.value}/`) || file.name !== ACCESS_FILE) continue
      try {
        const data: unknown = JSON.parse(await this.app.vault.read(file))
        if (!data || typeof data !== 'object' || Array.isArray(data)) continue
        access[this.folderOf(file.path)] = Object.fromEntries(
          Object.entries(data).filter(([, value]) =>
            ['off', 'ask', 'auto'].includes(value as string)
          )
        )
      } catch (error) {
        console.debug('[Abele] Could not read chat folder access', error)
      }
    }
    if (!this.dead && generation === this.generation) {
      this.access.value = access
      this.revision.value++
    }
  }

  accessFor(path: string, base: Record<string, ToolMode>) {
    const parts = this.folderOf(path).split('/').filter(Boolean)
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

  async create(parent: string, name: string): Promise<void> {
    return this.mutate(() => this.createNow(parent, name))
  }
  private async createNow(parent: string, name: string): Promise<void> {
    if (!validName(name)) throw new Error(t('chatTree.invalidFolder'))
    const target = this.path(parent ? `${parent}/${name}` : name)
    await this.ensureRoot()
    await this.app.vault.createFolder(target)
    await this.reload()
  }

  private async ensureRoot(): Promise<void> {
    let path = ''
    for (const part of this.path('').split('/')) {
      path = path ? `${path}/${part}` : part
      if (!this.app.vault.getAbstractFileByPath(path)) await this.app.vault.createFolder(path)
    }
  }

  async setAccess(folder: string, modes: Record<string, ToolMode>): Promise<void> {
    return this.mutate(() => this.setAccessNow(folder, modes))
  }
  private async setAccessNow(folder: string, modes: Record<string, ToolMode>): Promise<void> {
    const path = `${this.path(folder)}/${ACCESS_FILE}`
    if (!(this.app.vault.getAbstractFileByPath(this.path(folder)) instanceof TFolder))
      throw new Error(t('chatTree.folderMissing'))
    const content = JSON.stringify({ ...this.access.value[folder], ...modes })
    const file = this.app.vault.getAbstractFileByPath(path)
    if (file instanceof TFile) await this.app.vault.modify(file, content)
    else await this.app.vault.create(path, content)
    await this.reload()
  }

  async move(id: string, folder: string): Promise<void> {
    return this.moveMany([id], folder)
  }

  async moveMany(ids: string[], folder: string): Promise<void> {
    const sources = ids.map((id): MoveSource => {
      const session = this.service.getSession(id)
      const file = session?.currentChatFile.value ?? this.app.vault.getAbstractFileByPath(id)
      return {
        id,
        file: file instanceof TFile ? file : null,
        version: session?.conversationVersion.value,
      }
    })
    return this.mutate(() => this.moveNow(sources, folder))
  }
  private async moveNow(sources: MoveSource[], folder: string): Promise<void> {
    const target = this.path(folder)
    if (!(this.app.vault.getAbstractFileByPath(target) instanceof TFolder))
      throw new Error(t('chatTree.folderMissing'))
    const files = new Set<TFile>()
    for (const source of sources) {
      const session = this.service.getSession(source.id)
      if (
        source.version !== undefined &&
        (!session || session.conversationVersion.value !== source.version)
      )
        continue
      if (session) await session.saveForRelease()
      if (session && !session.currentChatFile.value) await session.createInDirectory(target)
      const file = session?.currentChatFile.value ?? source.file
      if (!(file instanceof TFile)) continue
      files.add(file)
    }
    const destinations = new Set<string>()
    for (const file of files) {
      const destination = `${target}/${file.name}`
      const occupied = this.app.vault.getAbstractFileByPath(destination)
      if ((occupied && occupied !== file) || destinations.has(destination))
        throw new Error(t('chatTree.chatExists'))
      destinations.add(destination)
    }
    const moved = new Map<string, string>()
    try {
      for (const file of files) {
        const destination = `${target}/${file.name}`
        if (file.path !== destination) {
          const previous = file.path
          await this.app.fileManager.renameFile(file, destination)
          moved.set(previous, destination)
          await CommentService.getInstance().handleConversationRename(file, previous)
        }
      }
    } finally {
      await this.followMoves(moved, files)
      this.service.saveTabs()
      await this.reload()
    }
  }

  async rename(folder: string, name: string): Promise<void> {
    return this.mutate(() => this.renameNow(folder, name))
  }
  private async renameNow(folder: string, name: string): Promise<void> {
    if (!folder) throw new Error(t('chatTree.renameRoot'))
    if (!validName(name)) throw new Error(t('chatTree.invalidFolder'))
    const file = this.app.vault.getAbstractFileByPath(this.path(folder))
    if (!(file instanceof TFolder)) throw new Error(t('chatTree.folderMissing'))
    const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : ''
    const destination = this.path(parent ? `${parent}/${name}` : name)
    if (this.app.vault.getAbstractFileByPath(destination))
      throw new Error(t('chatTree.folderExists'))
    const files = this.app.vault
      .getFiles()
      .filter((child) => child.path.startsWith(`${file.path}/`) && child.extension === 'abchat')
    const moved = new Map(
      files.map((child) => [child.path, `${destination}${child.path.slice(file.path.length)}`])
    )
    for (const session of this.service.getAllSessions())
      if (session.currentChatFile.value && moved.has(session.currentChatFile.value.path))
        await session.saveForRelease()
    await this.app.fileManager.renameFile(file, destination)
    for (const [previous, next] of moved) {
      const child = this.app.vault.getAbstractFileByPath(next)
      if (child instanceof TFile)
        await CommentService.getInstance().handleConversationRename(child, previous)
    }
    await this.followMoves(moved, new Set(files))
    this.service.saveTabs()
    await this.reload()
  }

  private async followMoves(moved: Map<string, string>, files: Set<TFile>): Promise<void> {
    if (!moved.size) return
    for (const [previous, next] of moved) renameDelegationIdentity(previous, next)
    for (const file of files) {
      const session = this.service.getSessionByFile(file.path)
      const anchor = session?.anchor.value
      if (session && anchor && moved.has(anchor.note)) {
        session.anchor.value = { ...anchor, note: moved.get(anchor.note)! }
        await session.save()
      } else if (!session) {
        await ChatStorage.getInstance().transformDiscussion(file, (content) => {
          const metadata = parseChatMetadata(content)
          const note = metadata?.anchor?.note
          return metadata && note && moved.has(note)
            ? content +
                serializeMetadata({
                  ...metadata,
                  anchor: { ...metadata.anchor!, note: moved.get(note)! },
                })
            : content
        })
      }
    }
    for (const id of this.service.tabOrder.value) {
      const run = this.service.getRun(id)
      if (run && moved.has(run.parentChat)) {
        run.parentChat = moved.get(run.parentChat)!
        await RunStorage.getInstance().save(run)
      }
    }
    this.service.followChatMoves(moved)
  }

  async remove(folder: string): Promise<void> {
    return this.mutate(() => this.removeNow(folder))
  }
  private async removeNow(folder: string): Promise<void> {
    if (!folder) throw new Error(t('chatTree.deleteRoot'))
    const file = this.app.vault.getAbstractFileByPath(this.path(folder))
    if (!(file instanceof TFolder)) return
    if (file.children.some((child) => child.name !== ACCESS_FILE))
      throw new Error(t('chatTree.folderNotEmpty'))
    await this.app.fileManager.trashFile(file)
    await this.reload()
  }

  destroy(): void {
    this.releaseSettings()
    this.dead = true
    this.generation++
    for (const event of this.events) this.app.vault.offref(event)
    this.events = []
  }
}
