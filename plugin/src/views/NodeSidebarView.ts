import { ItemView, Platform, type ViewStateResult, type WorkspaceLeaf } from 'obsidian'
import { createApp, h, shallowRef, watch, type App as VueApp, type WatchStopHandle } from 'vue'
import { z } from 'zod'
import { NodeService } from '@/node/NodeService'
import { NodePathService } from '@/node/NodePathService'
import { NodePathModel } from '@/node/NodePathModel'
import { formatTimestamp } from '@/helpers/displayFormat'
import { NODE_SIDEBAR_VIEW, openNodePathTab } from '@/node/nodePathNavigation'
import {
  nodePathAction,
  openFolderForNode,
  openNodePathPairing,
  newNodePathChat,
  showNodePathNodeMenu,
  showNodePathRowMenu,
  showNodePathFileMenu,
} from '@/node/NodePathController'
import NodePathSidebar from '@/components/nodeWork/NodePathSidebar.vue'

const State = z.object({ registrationId: z.string().min(1).max(128).optional() }).strict()
export class NodeSidebarView extends ItemView {
  private ui?: VueApp
  private stop?: WatchStopHandle
  private readonly registrationId = shallowRef('')
  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
  }
  getViewType(): string {
    return NODE_SIDEBAR_VIEW
  }
  getDisplayText(): string {
    return 'Node'
  }
  getIcon(): string {
    return 'server'
  }
  getState(): Record<string, unknown> {
    return this.registrationId.value ? { registrationId: this.registrationId.value } : {}
  }
  async setState(raw: unknown, result: ViewStateResult): Promise<void> {
    const state = State.parse(raw ?? {})
    this.registrationId.value = state.registrationId ?? ''
    await super.setState(raw, result)
  }
  async onOpen(): Promise<void> {
    this.contentEl.addClass('abele-node-sidebar')
    const service = NodeService.getInstance()
    this.stop = watch(
      service.nodes,
      (nodes) => {
        if (!nodes.some((n) => n.id === this.registrationId.value))
          this.registrationId.value = nodes[0]?.id ?? ''
      },
      { immediate: true }
    )
    this.ui = createApp({
      render: () => {
        const node = service.nodes.value.find((n) => n.id === this.registrationId.value)
        const model: NodePathModel | undefined = node
          ? NodePathService.getInstance().model(node.id)
          : undefined
        const connection = node ? service.connection(node.id) : undefined
        const selected = () => model?.current.value
        return h(NodePathSidebar, {
          model,
          phase: node ? 'ready' : Platform.isMobile ? 'remote' : 'not-found',
          node:
            node && connection && model
              ? {
                  name: node.label,
                  address: node.url,
                  status: connection.state.value,
                  seen: formatTimestamp(model.receivedAt.value).label,
                }
              : undefined,
          onPair: openNodePathPairing,
          onSelect: (id: string) => {
            if (model) nodePathAction(() => model.select(id))
          },
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
                openNodePathTab(this.app.workspace, { kind: 'history', target }, Platform.isMobile)
              )
          },
          onOpenFile: (path: string, stage?: 'staged' | 'unstaged') => {
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
          onOpenChat: (id: string) => {
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
          },
          onRefresh: () => {
            if (model && connection)
              nodePathAction(() => connection.connect().then(() => model.refresh()))
          },
          onRetry: () => {
            if (connection && model)
              nodePathAction(() => connection.connect().then(() => model.refresh()))
          },
          onNodeMenu: (event: MouseEvent) => {
            if (model) showNodePathNodeMenu(model, event)
          },
          onRowMenu: (event: MouseEvent, id: string) => {
            if (model) showNodePathRowMenu(model, event, id)
          },
          onFileMenu: (event: MouseEvent, path: string) => {
            const target = selected()
            if (target) showNodePathFileMenu(event, { target, path })
          },
          onCopy: (text: string) => nodePathAction(() => navigator.clipboard.writeText(text)),
        })
      },
    })
    this.ui.mount(this.contentEl)
  }
  async onClose(): Promise<void> {
    this.stop?.()
    this.stop = undefined
    this.ui?.unmount()
    this.ui = undefined
    this.contentEl.empty()
  }
}
