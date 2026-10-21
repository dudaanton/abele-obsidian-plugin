import { computed, ref, shallowRef, watch, type WatchStopHandle } from 'vue'
import { Notice, TFile, TFolder } from 'obsidian'
import { ChatStorage } from '@/ai/ChatStorage'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { DEFAULT_AI_SETTINGS, type ToolMode, type ChatMessage } from '@/ai/types'
import { parseChat, parseChatMetadata, serializeMetadata } from '@/ai/ChatLog'
import { firstQuestion } from '@/ai/chatText'
import { CommentService } from '@/ai/CommentService'
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
  private readonly helpers = shallowRef<Array<{ parent: string; chat: ChatTreeChat }>>([])
  private readonly files = new Map<
    string,
    {
      mtime: number
      size: number
      open: boolean
      parent?: string
      title?: string
      agentId?: string
      created?: string
      at?: number
      kind?: 'chat' | 'comment'
      helpers: Array<{ parent: string; chat: ChatTreeChat }>
    }
  >()
  private readonly stops: WatchStopHandle[] = []
  private dead = false
  private generation = 0
  private refreshing: Promise<void> | null = null
  private refreshAgain = false
  private activated = false
  constructor(readonly service: ChatService) {
    this.activeId = service.activeTabId
    this.stops.push(
      watch(service.folders.revision, () => {
        this.refreshInBackground()
      })
    )
    this.stops.push(
      watch(GlobalStore.getInstance().chatLinksVersion, () => {
        this.refreshInBackground()
      })
    )
    this.refreshInBackground()
  }

  private refreshInBackground(): void {
    if (!this.activated) return
    void this.refresh().catch((error: unknown) =>
      console.debug('[Abele] Could not refresh chat navigation', error)
    )
  }

  refresh(): Promise<void> {
    this.activated = true
    this.refreshAgain = true
    if (this.refreshing) return this.refreshing
    this.refreshing = Promise.resolve()
      .then(async () => {
        while (this.refreshAgain && !this.dead) {
          this.refreshAgain = false
          await this.readTree()
        }
      })
      .finally(() => {
        this.refreshing = null
      })
    return this.refreshing
  }

  private async readTree(): Promise<void> {
    const generation = ++this.generation
    const history = (await ChatStorage.getInstance().refreshHistory()).map((entry) => ({
      ...entry,
    }))
    const known = new Set(history.map((entry) => entry.path))
    for (const file of await ChatStorage.getInstance().discussionFiles())
      if (!known.has(file.path)) history.push({ path: file.path, title: '', created: '' })
    const parents: Record<string, string> = {}
    const helpers: Array<{ parent: string; chat: ChatTreeChat }> = []
    const { app } = GlobalStore.getInstance()
    const openPaths = new Set(
      this.service.getAllSessions().map((session) => session.currentChatFile.value?.path)
    )
    const present = new Set(history.map((entry) => entry.path))
    for (const path of this.files.keys()) if (!present.has(path)) this.files.delete(path)
    for (const entry of history) {
      if (this.dead || generation !== this.generation) return
      const file = app.vault.getAbstractFileByPath(entry.path)
      if (!(file instanceof TFile)) continue
      let cached = this.files.get(file.path)
      const open = openPaths.has(file.path)
      if (
        !cached ||
        cached.mtime !== file.stat.mtime ||
        cached.size !== file.stat.size ||
        (cached.open && !open)
      ) {
        const content = await ChatStorage.getInstance().readNavigationFile(file, true)
        const metadata = parseChatMetadata(content)
        const parsed =
          content.includes('"subAgentRun"') || metadata?.kind === 'comment'
            ? parseChat(content)
            : null
        cached = {
          mtime: file.stat.mtime,
          size: file.stat.size,
          open,
          parent: metadata?.anchor?.note,
          title:
            metadata?.title ||
            (metadata?.kind === 'comment' ? firstQuestion(parsed?.messages ?? []) : undefined),
          agentId: metadata?.agentId,
          created: metadata?.created,
          kind: metadata?.kind,
          at: metadata?.kind === 'comment' ? (parsed?.messages.at(-1)?.timestamp ?? 0) : undefined,
          helpers: parsed ? this.helperChats(file.path, parsed.messages) : [],
        }
        this.files.set(file.path, cached)
      }
      cached.open = open
      entry.title = cached.title || entry.title
      entry.agentId = cached.agentId ?? entry.agentId
      entry.created = cached.created ?? entry.created
      entry.lastMessageAt = cached.at || entry.lastMessageAt
      if (cached.parent) parents[entry.path] = cached.parent
      helpers.push(...cached.helpers)
    }
    if (!this.dead && generation === this.generation) {
      this.parents.value = parents
      this.helpers.value = helpers
      this.history.value = [...history]
    }
  }

  private helperChats(parent: string, messages: ChatMessage[]) {
    return messages.flatMap((message): Array<{ parent: string; chat: ChatTreeChat }> => {
      const run = message.subAgentRun
      if (!run) return []
      return [
        {
          parent,
          chat: {
            kind: 'chat',
            id: `run:${run.runId}`,
            title: run.agentName,
            nested: 'helper',
            open: true,
            at: message.timestamp,
            children: [],
            state:
              run.status === 'running' ? 'working' : run.status === 'error' ? 'failed' : undefined,
          },
        },
      ]
    })
  }

  readonly root = computed<ChatTreeEntry[]>(() => {
    void this.service.folders.revision.value
    const { app } = GlobalStore.getInstance()
    const root: ChatTreeEntry[] = []
    const indexedTimes = new Map(
      this.history.value.map((entry) => [entry.path, entry.lastMessageAt])
    )
    const timeFor = (path: string, live?: number) => {
      if (live) return live
      const indexed = indexedTimes.get(path)
      if (indexed) return indexed
      const file = app.vault.getAbstractFileByPath(path)
      return file instanceof TFile ? file.stat.mtime : 0
    }
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
      const directory = app.vault.getAbstractFileByPath(
        `${this.service.folders.root.value}/${path}`
      )
      folder.canDelete =
        directory instanceof TFolder &&
        directory.children.every((child) => child.name === '_folder.abeleaccess')
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
        nested: this.service.getNodeSession(info.id) ? 'node' : undefined,
        at: timeFor(path, presentation.messages.value.at(-1)?.timestamp),
        children: [],
      }
      entries.set(chat.id, {
        chat,
        path,
        parent: session?.anchor.value?.note ?? this.service.nodeParentPaths.value[info.id],
      })
      if (path) byPath.set(path, chat)
    }
    for (const entry of this.history.value) {
      if (byPath.has(entry.path) || !(app.vault.getAbstractFileByPath(entry.path) instanceof TFile))
        continue
      const live =
        this.files.get(entry.path)?.kind === 'comment'
          ? CommentService.getInstance().getSessionByFile(entry.path)
          : null
      const state = live?.commentState.value
      const chat: ChatTreeChat = {
        kind: 'chat',
        id: entry.path,
        title:
          live?.chatTitle.value ||
          (live ? firstQuestion(live.messages.value) : '') ||
          entry.title ||
          t('chatTree.discussion'),
        open: false,
        at: timeFor(entry.path, live?.messages.value.at(-1)?.timestamp),
        state:
          state === 'pending'
            ? 'waiting'
            : state === 'busy'
              ? 'working'
              : state === 'error'
                ? 'failed'
                : undefined,
        children: [],
      }
      entries.set(chat.id, { chat, path: entry.path, parent: this.parents.value[entry.path] })
      byPath.set(entry.path, chat)
    }
    for (const closed of this.service.closedNodeChats.value) {
      const id = `node:${closed.reference.registrationId}:${closed.reference.sessionId}`
      if (entries.has(id)) continue
      entries.set(id, {
        chat: {
          kind: 'chat',
          id,
          title: closed.reference.title,
          open: false,
          nested: 'node',
          at: closed.at,
          children: [],
        },
        path: '',
        parent: this.service.nodeParentPaths.value[id],
      })
    }
    const helpers = [...this.helpers.value]
    for (const session of this.service.getAllSessions()) {
      const path = session.currentChatFile.value?.path
      if (path) helpers.push(...this.helperChats(path, session.allMessages.value))
    }
    for (const helper of helpers)
      entries.set(helper.chat.id, {
        chat: {
          ...helper.chat,
          open: !this.service.closedRunIds.value.includes(helper.chat.id),
          children: [],
        },
        path: '',
        parent: helper.parent,
      })
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
      entries.set(id, { chat, path: '', parent: entries.get(id)?.parent ?? run.parentChat })
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
      } else
        ensure(
          this.service.folders.folderOf(
            entry.path ||
              (entry.parent && app.vault.getAbstractFileByPath(entry.parent) ? entry.parent : '')
          )
        ).push(entry.chat)
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

  toolFloorFor(folder: string) {
    const modes = { ...(AbeleConfig.getInstance().ai.toolModes ?? DEFAULT_AI_SETTINGS.toolModes) }
    const rank = { off: 0, ask: 1, auto: 2 }
    const registry = AgentRegistry.getInstance()
    const inside = (path: string) => {
      const seen = new Set<string>()
      while (
        !this.service.folders.folderOf(path) &&
        this.parents.value[path]?.endsWith('.abchat') &&
        !seen.has(path)
      ) {
        seen.add(path)
        path = this.parents.value[path]
      }
      const location = this.service.folders.folderOf(path)
      return location === folder || location.startsWith(`${folder}/`)
    }
    const agents = [
      registry.defaultAgent(),
      ...this.service
        .getAllSessions()
        .filter((session) => inside(this.service.folderLocation(session)))
        .map((session) => session.agent.value),
      ...this.history.value
        .filter((entry) => inside(entry.path))
        .map((entry) => (entry.agentId ? registry.get(entry.agentId) : null)),
    ]
    for (const agent of agents)
      for (const [key, mode] of Object.entries(agent?.toolModes ?? {}))
        if (rank[mode] > rank[modes[key] ?? 'off']) modes[key] = mode
    return modes
  }
  readonly floor = computed(() => this.toolFloorFor(this.accessFolder.value ?? ''))

  accessFloorFor(folder: string) {
    const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : ''
    return this.service.folders.accessFor(
      `${this.service.folders.path(parent)}/sample.abchat`,
      this.toolFloorFor(folder)
    ).modes
  }
  readonly accessFloor = computed(() => this.accessFloorFor(this.accessFolder.value ?? ''))

  private run(action: () => Promise<unknown>): void {
    void action().catch((error: unknown) => {
      console.debug('[Abele] Chat tree action failed', error)
      new Notice(error instanceof Error ? error.message : String(error))
    })
  }
  open(id: string): void {
    if (this.service.tabOrder.value.includes(id)) this.service.switchTab(id)
    else if (id.startsWith('run:'))
      this.run(async () => {
        if (!(await this.service.openRun(id.slice(4)))) throw new Error(t('chatTree.missing'))
      })
    else
      this.run(async () => {
        const node = this.service.closedNodeChats.value.find(
          (chat) => `node:${chat.reference.registrationId}:${chat.reference.sessionId}` === id
        )
        if (node) {
          await this.service.openNodeSession(node.reference)
          return
        }
        const file = GlobalStore.getInstance().app.vault.getAbstractFileByPath(id)
        if (file instanceof TFile) await this.service.openChatFile(file)
        else throw new Error(t('chatTree.missing'))
      })
  }
  close(id: string): void {
    this.run(() => this.service.closeTab(id))
  }
  move(id: string, folder: string): void {
    this.run(async () => {
      await this.refresh()
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
  saveAccessFor(folder: string, modes: Record<string, ToolMode>): void {
    this.run(() => this.service.folders.setAccess(folder, modes))
  }
  destroy(): void {
    this.dead = true
    this.generation++
    this.stops.forEach((stop) => stop())
  }
}
