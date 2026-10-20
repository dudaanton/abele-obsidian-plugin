import { presentUiError } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import { ItemView, Notice, Platform, type ViewStateResult, type WorkspaceLeaf } from 'obsidian'
import { h, shallowRef, watch, type WatchStopHandle } from 'vue'
import { z } from 'zod'
import { NodeService } from '@/node/NodeService'
import { NodePathService } from '@/node/NodePathService'
import { NodePathModel, pathTargetKey, type PathFileStage } from '@/node/NodePathModel'
import { nodeResourceTarget } from '@/node/NodeFilesModel'
import {
  createLocalNodeDiscovery,
  localNodeRegistrationUrl,
  type LocalNode,
} from '@/node/localDiscovery'
import { streamBTime as formatTimestamp } from '@/i18n/streamBDate'
import {
  NODE_SIDEBAR_VIEW,
  NODE_FILE_VIEW,
  NODE_EDITOR_VIEW,
  NodePathTabSchema,
  openNodePathTab,
  type NodePathTabState,
} from '@/node/nodePathNavigation'
import {
  nodePathAction,
  openFolderForNode,
  openNodePathPairing,
  newNodePathChat,
  showNodePathNodeMenu,
  showNodePathFileMenu,
  showNodePathPlaceMenu,
  pickNodePathPlace,
  chooseNodePathBase,
} from '@/node/NodePathController'
import { discardNodePathFile, takeNodePathStep } from '@/node/nodePathGitActions'
import type { BranchStep } from '@/components/nodeWork/branchStep'
import NodePathSidebar from '@/components/nodeWork/NodePathSidebar.vue'
import { mountKit, type KitMount } from '@/components/obsidian/mount'

const State = z.object({ registrationId: z.string().min(1).max(128).optional() }).strict()
export class NodeSidebarView extends ItemView {
  private ui?: KitMount
  private stop?: WatchStopHandle
  private readonly registrationId = shallowRef('')
  private readonly activeFile = shallowRef<Extract<NodePathTabState, { kind: 'file' | 'editor' }>>()
  private readonly local = shallowRef<LocalNode>()
  private readonly localPhase = shallowRef<
    'looking' | 'found' | 'connecting' | 'not-found' | 'remote'
  >(Platform.isMobile ? 'remote' : 'looking')
  private readonly localError = shallowRef('')
  private readonly discovery = createLocalNodeDiscovery()
  private discoveryController?: AbortController
  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
  }
  getViewType(): string {
    return NODE_SIDEBAR_VIEW
  }
  getDisplayText(): string {
    return t('streamB.node.e93372')
  }
  getIcon(): string {
    return 'server'
  }
  getState(): Record<string, unknown> {
    return this.registrationId.value ? { registrationId: this.registrationId.value } : {}
  }
  async setState(raw: unknown, result: ViewStateResult): Promise<void> {
    const state = State.parse(raw ?? {})
    const nodes = NodeService.getInstance().nodes.value
    const selected = state.registrationId ?? this.registrationId.value
    this.registrationId.value = nodes.some((node) => node.id === selected)
      ? selected
      : (nodes[0]?.id ?? '')
    await super.setState(raw, result)
    this.refreshLocalDiscovery()
  }
  async onOpen(): Promise<void> {
    this.contentEl.addClass('abele-node-sidebar')
    const workspace = this.app.workspace
    const updateFile = () => {
      const state = workspace.getMostRecentLeaf(workspace.rootSplit)?.getViewState()
      const parsed =
        state && [NODE_FILE_VIEW, NODE_EDITOR_VIEW].includes(state.type)
          ? NodePathTabSchema.safeParse(state.state)
          : undefined
      const file = parsed?.success ? parsed.data : undefined
      this.activeFile.value =
        file && (file.kind === 'file' || file.kind === 'editor') ? file : undefined
    }
    this.registerEvent(workspace.on('active-leaf-change', updateFile))
    this.registerEvent(workspace.on('layout-change', updateFile))
    updateFile()
    const service = NodeService.getInstance()
    this.stop = watch(
      service.nodes,
      (nodes) => {
        if (!nodes.some((n) => n.id === this.registrationId.value))
          this.registrationId.value = nodes[0]?.id ?? ''
      },
      { immediate: true }
    )
    this.ui = mountKit(
      this.contentEl,
      {
        render: () => {
          const node = service.nodes.value.find((n) => n.id === this.registrationId.value)
          const model: NodePathModel | undefined = node
            ? NodePathService.getInstance().model(node.id)
            : undefined
          const connection = node ? service.connection(node.id) : undefined
          const file = this.activeFile.value
          const current = model?.current.value
          const fileHere =
            file &&
            current &&
            file.target.registrationId === current.registrationId &&
            file.target.projectId === current.projectId &&
            pathTargetKey(file.target) === pathTargetKey(current)
          const selected = () => model?.current.value
          // A chat chosen in the place search opens in its tab, as its row in the panel did.
          const openChat = (id: string) => {
            const session = model?.sessions.value.find((s) => s.session.session_id === id)
            if (session?.target && model) {
              model.selectedChat.value = id
              nodePathAction(() =>
                openNodePathTab(
                  this.app.workspace,
                  {
                    kind: 'chat',
                    target: session.target!,
                    sessionId: id,
                    title: session.session.title,
                  },
                  Platform.isMobile
                )
              )
            }
          }
          return h(NodePathSidebar, {
            model,
            file: fileHere ? nodeResourceTarget(file.path).path : undefined,
            phase: node ? 'ready' : this.localPhase.value,
            error: this.localError.value || undefined,
            onConnect: () => this.connectLocal(),
            node:
              node && connection && model
                ? {
                    name: node.label,
                    address: node.url,
                    status: connection.state.value,
                    seen: formatTimestamp(model.receivedAt.value).label,
                  }
                : this.local.value
                  ? {
                      name: this.local.value.nodeName,
                      version: this.local.value.nodeVersion,
                      status: 'offline',
                      address: this.local.value.endpoint,
                    }
                  : undefined,
            onPair: openNodePathPairing,
            onOpenFolder: () => {
              if (model) nodePathAction(() => openFolderForNode(model))
            },
            onNewChat: () => {
              if (model) nodePathAction(() => newNodePathChat(model))
            },
            onHistory: () => {
              const target = selected()
              if (target)
                nodePathAction(() =>
                  openNodePathTab(
                    this.app.workspace,
                    { kind: 'history', target },
                    Platform.isMobile
                  )
                )
            },
            onOpenFile: (path: string, stage?: PathFileStage) => {
              const target = selected()
              if (target)
                nodePathAction(() =>
                  openNodePathTab(
                    this.app.workspace,
                    { kind: 'file', target, path, ...(stage ? { stage } : {}) },
                    Platform.isMobile
                  )
                )
            },
            onOpenChat: openChat,
            onPickPlace: () => {
              if (model) pickNodePathPlace(model, openChat)
            },
            onPlaceMenu: (event: MouseEvent) => {
              if (model) showNodePathPlaceMenu(model, event, openChat)
            },
            onOpenCommit: (hash: string) => {
              const target = selected()
              if (target)
                nodePathAction(() =>
                  openNodePathTab(
                    this.app.workspace,
                    { kind: 'history', target, commit: hash },
                    Platform.isMobile
                  )
                )
            },
            onCompare: () => {
              if (model) chooseNodePathBase(model)
            },
            onStep: (id: BranchStep['id']) => {
              if (model) nodePathAction(() => takeNodePathStep(model, id))
            },
            onDiscard: (path: string) => {
              if (model) nodePathAction(() => discardNodePathFile(model, path))
            },
            onOpenPull: (number: number) => new Notice(t('streamBMeta.7721daf433', { v0: number })),
            onConnectService: () => new Notice(t('streamBMeta.167ee6d92e')),
            onRefresh: () => {
              if (model && connection)
                nodePathAction(() => connection.connect().then(() => model.refreshCurrent()))
            },
            onRetry: () => {
              if (connection && model)
                nodePathAction(() => connection.connect().then(() => model.refreshCurrent()))
            },
            onNodeMenu: (event: MouseEvent) => {
              if (model) showNodePathNodeMenu(model, event)
            },
            onFileMenu: (event: MouseEvent, path: string) => {
              const target = selected()
              const directory = (
                entries: import('@/components/nodeWork/types').TreeEntry[]
              ): boolean =>
                entries.some((entry) =>
                  entry.path === path ? entry.kind === 'folder' : directory(entry.children ?? [])
                )
              if (target)
                showNodePathFileMenu(event, {
                  target,
                  path,
                  directory: directory(model?.entries.value ?? []),
                })
            },
            onCopy: (text: string) => nodePathAction(() => navigator.clipboard.writeText(text)),
          })
        },
      },
      null,
      { owner: this }
    )
    this.refreshLocalDiscovery()
  }
  private refreshLocalDiscovery(): void {
    if (!Platform.isMobile && this.localPhase.value !== 'connecting') {
      const configured: unknown = this.app.loadLocalStorage('abele-node-local-state-dir')
      this.local.value = this.discovery.discover(
        typeof configured === 'string' ? configured : undefined
      )
      this.localPhase.value = this.local.value ? 'found' : 'not-found'
    }
  }
  private connectLocal(): void {
    const found = this.local.value
    if (!found || this.localPhase.value === 'connecting') return
    this.discoveryController?.abort()
    const controller = (this.discoveryController = new AbortController())
    this.localPhase.value = 'connecting'
    this.localError.value = ''
    nodePathAction(async () => {
      try {
        const node = await this.discovery.connect(
          found,
          'Obsidian desktop',
          {
            add: (label, endpoint, token, expectedNodeId) =>
              NodeService.getInstance().add(
                label,
                localNodeRegistrationUrl(endpoint),
                token,
                expectedNodeId,
                () => !controller.signal.aborted
              ),
          },
          controller.signal
        )
        if (!controller.signal.aborted) this.registrationId.value = node.id
      } catch (error) {
        if (!controller.signal.aborted) {
          this.localPhase.value = 'found'
          this.localError.value =
            error instanceof Error ? presentUiError(error) : t('streamBMeta.4d2680119a')
        }
      }
    })
  }
  async onClose(): Promise<void> {
    this.discoveryController?.abort()
    this.stop?.()
    this.stop = undefined
    this.ui?.unmount()
    this.ui = undefined
    this.contentEl.empty()
  }
}
