import { createApp } from 'vue'
import NodeWorkspaceDialog from '@/components/NodeWorkspaceDialog.vue'
import { NodeWorkspaceModel, type NodeSession } from './NodeWorkspaceModel'
import { FuzzySuggestModal, Menu, Notice, type App } from 'obsidian'
import { ChatService } from '@/ai/ChatService'
import { GlobalStore } from '@/stores/GlobalStore'
import { NodeService } from './NodeService'
import type { RegisteredNode } from './NodeRegistry'

interface SessionChoice {
  title: string
  session_id?: string
  moreAfter?: string
  workspaces?: boolean
}

class SessionPicker extends FuzzySuggestModal<SessionChoice> {
  constructor(
    app: App,
    private readonly choices: SessionChoice[],
    private readonly choose: (item: SessionChoice) => Promise<void>
  ) {
    super(app)
    this.setPlaceholder('Pick a session or manage projects and workspaces')
  }
  getItems(): SessionChoice[] {
    return this.choices
  }
  getItemText(item: SessionChoice): string {
    return item.title
  }
  onChooseItem(item: SessionChoice): void {
    void this.choose(item).catch(
      (error: unknown) =>
        new Notice(error instanceof Error ? error.message : 'Could not open node session')
    )
  }
}

export async function pickNodeSession(node: RegisteredNode, after?: string): Promise<void> {
  const chats = ChatService.getInstance()
  const connection = NodeService.getInstance().connection(node.id)
  await connection.connect()
  const sessions = await connection.client.listSessions(after)
  const choices: SessionChoice[] = [
    { title: 'Projects and workspaces…', workspaces: true },
    ...(chats.canCreateTab ? [{ title: 'Create new fake session (non-executing)' }] : []),
    ...sessions,
  ]
  if (sessions.length)
    choices.push({ title: 'More sessions…', moreAfter: sessions[sessions.length - 1].session_id })
  const app = GlobalStore.getInstance().app
  ;(app as unknown as { setting?: { close(): void } }).setting?.close()
  new SessionPicker(app, choices, async (choice) => {
    if (choice.workspaces) {
      openNodeWorkspaces(node)
      return
    }
    if (choice.moreAfter) {
      await pickNodeSession(node, choice.moreAfter)
      return
    }
    const tabId = choice.session_id ? `node:${node.id}:${choice.session_id}` : ''
    if (!chats.canCreateTab && !chats.getNodeSession(tabId)) {
      new Notice(ChatService.TABS_FULL)
      return
    }
    const session = choice.session_id
      ? choice
      : await connection.client.createSession('Fake session')
    await chats.openNodeSession({
      kind: 'node-session',
      nodeId: node.expectedNodeId,
      registrationId: node.id,
      sessionId: session.session_id!,
      title: session.title,
    })
    await chats.revealSidebar({ focus: false })
  }).open()
}

export async function revealNodeSession(
  node: RegisteredNode,
  session: Pick<NodeSession, 'session_id' | 'title'>
): Promise<void> {
  const chats = ChatService.getInstance()
  await chats.openNodeSession({
    kind: 'node-session',
    nodeId: node.expectedNodeId,
    registrationId: node.id,
    sessionId: session.session_id,
    title: session.title,
  })
  await chats.revealSidebar({ focus: false })
}

/** The modal uses the same connector/client as the chat and has no filesystem access. */
export function openNodeWorkspaces(node: RegisteredNode, workspaceId?: string): void {
  const connection = NodeService.getInstance().connection(node.id)
  const model = new NodeWorkspaceModel(connection.client, () => {
    if (!ChatService.getInstance().canCreateTab) throw new Error(ChatService.TABS_FULL)
  })
  if (workspaceId) model.workspaceId.value = workspaceId
  const host = document.body.createDiv()
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    ui.unmount()
    host.remove()
  }
  const ui = createApp(NodeWorkspaceDialog, {
    model,
    connection,
    label: node.label,
    onClose: close,
    onSession: (session: NodeSession) => {
      void revealNodeSession(node, session)
        .then(close)
        .catch(
          (e: unknown) => new Notice(e instanceof Error ? e.message : 'Could not open session')
        )
    },
  })
  ui.mount(host)
}

/** Existing local action stays first; with no nodes this is exactly the original button. */
export function newChatMenu(local: () => void, position: { x: number; y: number }): void {
  let service: NodeService
  try {
    service = NodeService.getInstance()
  } catch {
    new Notice('Node connections could not be loaded. Local chat is still available.')
    local()
    return
  }
  if (!service.nodes.value.length) {
    local()
    return
  }
  const menu = new Menu()
  menu.addItem((item) => item.setTitle('Local chat').setIcon('message-circle').onClick(local))
  for (const node of service.nodes.value)
    menu.addItem((item) =>
      item
        .setTitle(`Session on ${node.label}`)
        .setIcon('server')
        .onClick(() => {
          void pickNodeSession(node).catch(
            (error: unknown) =>
              new Notice(error instanceof Error ? error.message : 'Node unavailable')
          )
        })
    )
  menu.showAtPosition(position)
}
