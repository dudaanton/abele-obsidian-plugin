import { computed, ref, shallowRef, watch, type WatchStopHandle } from 'vue'
import { Notice, TFile, TFolder } from 'obsidian'
import { ChatStorage } from '@/ai/ChatStorage'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { DEFAULT_AI_SETTINGS, type ToolMode } from '@/ai/types'
import { parseChatMetadata, serializeMetadata } from '@/ai/ChatLog'
import { promptDialog } from '@/components/obsidian/dialogs'
import { t } from '@/i18n'
import {
  chatsOf,
  type ChatTreeChat,
  type ChatTreeEntry,
  type ChatTreeFolder,
  type ChatTreeSource,
} from './chatTree'

/** A presentation adapter over live sessions and the vault's existing history index. */
export class ChatTreeModel implements ChatTreeSource {
  readonly activeId
  readonly accessFolder = ref<string | null>(null)
  private readonly history = shallowRef(AbeleConfig.getInstance().ai.chatHistory ?? [])
  private readonly parents = shallowRef<Record<string, string>>({})
  private readonly stops: WatchStopHandle[] = []
  private dead = false
  private generation = 0
  constructor(readonly service: ChatService) {
    this.activeId = service.activeTabId
    this.stops.push(
      watch(service.folders.revision, () => {
        void this.refresh()
      })
    )
    this.stops.push(
      watch(GlobalStore.getInstance().chatLinksVersion, () => {
        void this.refresh()
      })
    )
    void this.refresh()
  }

  async refresh(): Promise<void> {
    const generation = ++this.generation
    const history = await ChatStorage.getInstance().refreshHistory()
    const parents: Record<string, string> = {}
    const { app } = GlobalStore.getInstance()
    for (const entry of history) {
      const file = app.vault.getAbstractFileByPath(entry.path)
      if (!(file instanceof TFile)) continue
      const metadata = parseChatMetadata(await app.vault.cachedRead(file))
      if (metadata?.anchor?.note) parents[entry.path] = metadata.anchor.note
    }
    if (!this.dead && generation === this.generation) {
      this.parents.value = parents
      this.history.value = [...history]
    }
  }

  readonly root = computed<ChatTreeEntry[]>(() => {
    void this.service.folders.revision.value
    const { app } = GlobalStore.getInstance()
    const root: ChatTreeEntry[] = []
    const folders = new Map<string, ChatTreeFolder>()
    const ensure = (path: string): ChatTreeEntry[] => {
      if (!path) return root
      const known = folders.get(path)
      if (known) return known.children
      const parts = path.split('/')
      const name = parts.pop()!
      const folder: ChatTreeFolder = {
        kind: 'folder',
        name,
        path,
        access: this.service.folders.access.value[path],
        children: [],
      }
      ensure(parts.join('/')).push(folder)
      folders.set(path, folder)
      return folder.children
    }
    const walk = (folder: TFolder) => {
      for (const child of folder.children)
        if (child instanceof TFolder) {
          ensure(child.path.slice(this.service.folders.root.value.length + 1))
          walk(child)
        }
    }
    const directory = app.vault.getAbstractFileByPath(this.service.folders.root.value)
    if (directory instanceof TFolder) walk(directory)
    const byPath = new Map<string, ChatTreeChat>()
    const entries = new Map<string, { chat: ChatTreeChat; path: string; parent?: string }>()
    for (const info of this.service.listOpenChats()) {
      const session = this.service.getSession(info.id)
      const presentation = this.service.getPresentation(info.id)!
      const path = session?.currentChatFile.value?.path ?? ''
      const chat: ChatTreeChat = {
        kind: 'chat',
        id: info.id,
        title: info.title,
        open: true,
        state: info.state === 'idle' ? undefined : info.state,
        at: presentation.messages.value.at(-1)?.timestamp ?? 0,
        children: [],
      }
      entries.set(chat.id, { chat, path, parent: session?.anchor.value?.note })
      if (path) byPath.set(path, chat)
    }
    for (const entry of this.history.value) {
      if (byPath.has(entry.path) || !(app.vault.getAbstractFileByPath(entry.path) instanceof TFile))
        continue
      const chat: ChatTreeChat = {
        kind: 'chat',
        id: entry.path,
        title: entry.title,
        open: false,
        at: entry.lastMessageAt ?? 0,
        children: [],
      }
      entries.set(chat.id, { chat, path: entry.path, parent: this.parents.value[entry.path] })
      byPath.set(entry.path, chat)
    }
    for (const id of this.service.tabOrder.value) {
      const run = this.service.getRun(id)
      if (!run) continue
      const chat: ChatTreeChat = {
        kind: 'chat',
        id,
        title: run.agentName,
        open: true,
        nested: 'helper',
        at: Date.parse(run.created) || 0,
        state: run.status === 'running' ? 'working' : run.status === 'error' ? 'failed' : undefined,
        children: [],
      }
      entries.set(id, { chat, path: '', parent: run.parentChat })
    }
    for (const entry of entries.values()) {
      if (this.service.getNodeSession(entry.chat.id)) {
        const parent = this.service.tabOrder.value.find((id) =>
          this.service.childTabs(id).includes(entry.chat.id)
        )
        const parentChat = parent && entries.get(parent)?.chat
        if (parentChat) {
          entry.chat.nested = 'node'
          parentChat.children!.push(entry.chat)
          continue
        }
      }
      const parent = entry.parent && byPath.get(entry.parent)
      // Guard malformed anchors from forming a cycle in the rendered tree.
      const seen = new Set([entry.path])
      let ancestor = entry.parent
      let cycle = false
      while (ancestor) {
        if (seen.has(ancestor)) {
          cycle = true
          break
        }
        seen.add(ancestor)
        ancestor = this.parents.value[ancestor]
      }
      if (parent && !cycle) {
        entry.chat.nested ??= 'discussion'
        parent.children!.push(entry.chat)
      } else ensure(this.service.folders.folderOf(entry.path)).push(entry.chat)
    }
    const sort = (entries: ChatTreeEntry[]) => {
      entries.sort((a, b) =>
        a.kind !== b.kind
          ? a.kind === 'folder'
            ? -1
            : 1
          : a.kind === 'folder' && b.kind === 'folder'
            ? a.name.localeCompare(b.name)
            : (b as ChatTreeChat).at - (a as ChatTreeChat).at
      )
      for (const entry of entries) if (entry.children) sort(entry.children)
    }
    sort(root)
    return root
  })

  readonly floor = computed(() => {
    const modes = { ...DEFAULT_AI_SETTINGS.toolModes }
    const rank = { off: 0, ask: 1, auto: 2 }
    for (const agent of AgentRegistry.getInstance().list({ includeUtility: true }))
      for (const [key, mode] of Object.entries(agent.toolModes ?? {}))
        if (rank[mode] > rank[modes[key] ?? 'off']) modes[key] = mode
    return modes
  })

  readonly accessFloor = computed(() => {
    const folder = this.accessFolder.value ?? ''
    const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : ''
    return this.service.folders.accessFor(
      `${this.service.folders.path(parent)}/sample.abchat`,
      this.floor.value
    ).modes
  })

  private run(action: () => Promise<unknown>): void {
    void action().catch((error: unknown) => {
      console.debug('[Abele] Chat tree action failed', error)
      new Notice(error instanceof Error ? error.message : String(error))
    })
  }
  open(id: string): void {
    if (this.service.tabOrder.value.includes(id)) this.service.switchTab(id)
    else
      this.run(async () => {
        const file = GlobalStore.getInstance().app.vault.getAbstractFileByPath(id)
        if (file instanceof TFile) await this.service.openChatFile(file)
      })
  }
  close(id: string): void {
    this.run(() => this.service.closeTab(id))
  }
  move(id: string, folder: string): void {
    this.run(async () => {
      const entry = chatsOf(this.root.value).find((chat) => chat.id === id)
      const ids = entry ? chatsOf([entry]).map((chat) => chat.id) : [id]
      await this.service.folders.moveMany(
        ids.filter((child) => !this.service.isRunTab(child)),
        folder
      )
    })
  }
  newChat(folder: string): void {
    this.run(async () => {
      if (!this.service.canCreateTab) {
        new Notice(ChatService.TABS_FULL)
        return
      }
      const id = this.service.newTab()
      if (folder)
        await this.service.getSession(id)?.createInDirectory(this.service.folders.path(folder))
    })
  }
  newFolder(parent: string, name: string): void {
    this.run(() => this.service.folders.create(parent, name))
  }
  renameFolder(path: string, name: string): void {
    this.run(() => this.service.folders.rename(path, name))
  }
  deleteFolder(path: string): void {
    this.run(() => this.service.folders.remove(path))
  }
  folderAccess(path: string): void {
    this.accessFolder.value = path
  }
  rename(id: string): void {
    this.run(async () => {
      const chat = chatsOf(this.root.value).find((entry) => entry.id === id)
      const title = await promptDialog({ title: t('chatTree.renameChat'), value: chat?.title })
      if (!title) return
      const session = this.service.getSession(id)
      if (session) {
        session.chatTitle.value = title
        await session.save()
        const file = session.currentChatFile.value
        if (file) await ChatStorage.getInstance().renameChat(file, title)
        this.service.saveTabs()
      } else {
        const file = GlobalStore.getInstance().app.vault.getAbstractFileByPath(id)
        if (file instanceof TFile) {
          await ChatStorage.getInstance().transformDiscussion(file, (content) => {
            const metadata = parseChatMetadata(content)
            return metadata ? content + serializeMetadata({ ...metadata, title }) : content
          })
          await ChatStorage.getInstance().renameChat(file, title)
        }
      }
      await this.refresh()
    })
  }
  delete(id: string): void {
    this.run(async () => {
      if (this.service.getSession(id)) await this.service.deleteChat(id)
      else await ChatStorage.getInstance().deleteChat(id)
      await this.refresh()
    })
  }
  saveAccess(modes: Record<string, ToolMode>): void {
    const folder = this.accessFolder.value
    if (folder !== null) this.run(() => this.service.folders.setAccess(folder, modes))
  }
  destroy(): void {
    this.dead = true
    this.generation++
    this.stops.forEach((stop) => stop())
  }
}
