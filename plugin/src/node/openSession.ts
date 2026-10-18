import { nodeErrorNotice } from './errorNotice'
import { t } from '@/i18n'
import type { NodeSession } from './nodePages'
import { revealNodeDrawer } from './nodePathNavigation'
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
    this.setPlaceholder(t('streamB.pickASessionOrManageProjectsAnd.aa10cd'))
  }
  getItems(): SessionChoice[] {
    return this.choices
  }
  getItemText(item: SessionChoice): string {
    return item.title
  }
  onChooseItem(item: SessionChoice): void {
    void this.choose(item).catch((error: unknown) =>
      nodeErrorNotice(error, t('streamB.couldNotOpenNodeSession.18a82e'))
    )
  }
}

export async function pickNodeSession(node: RegisteredNode, after?: string): Promise<void> {
  const chats = ChatService.getInstance()
  const connection = NodeService.getInstance().connection(node.id)
  await connection.connect()
  const sessions = await connection.client.listSessions(after)
  const choices: SessionChoice[] = [
    { title: t('streamB.foldersAndWorktreesInTheNodePanel.5a6dba'), workspaces: true },
    ...(chats.canCreateTab
      ? [{ title: t('streamB.createNewFakeSessionNonExecuting.77ff93') }]
      : []),
    ...sessions,
  ]
  if (sessions.length)
    choices.push({
      title: t('streamB.moreSessions.5cbb6f'),
      moreAfter: sessions[sessions.length - 1].session_id,
    })
  const app = GlobalStore.getInstance().app
  ;(app as unknown as { setting?: { close(): void } }).setting?.close()
  new SessionPicker(app, choices, async (choice) => {
    if (choice.workspaces) {
      openNodePanel(node)
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

/** A node's folders, worktrees and chats live in its side panel, opened here for that node. */
export function openNodePanel(node: RegisteredNode): void {
  void revealNodeDrawer(GlobalStore.getInstance().app.workspace, node.id).catch((e: unknown) =>
    nodeErrorNotice(e, t('streamB.couldNotOpenTheNodePanel.38471a'))
  )
}

/** Existing local action stays first; with no nodes this is exactly the original button. */
export function newChatMenu(local: () => void, position: { x: number; y: number }): void {
  let service: NodeService
  try {
    service = NodeService.getInstance()
  } catch {
    new Notice(t('streamB.nodeConnectionsCouldNotBeLoadedLocal.db2b66'))
    local()
    return
  }
  if (!service.nodes.value.length) {
    local()
    return
  }
  const menu = new Menu()
  menu.addItem((item) =>
    item.setTitle(t('streamB.localChat.1d9795')).setIcon('message-circle').onClick(local)
  )
  for (const node of service.nodes.value)
    menu.addItem((item) =>
      item
        .setTitle(t('streamB.sessionOn.431145', { v0: String(node.label) }))
        .setIcon('server')
        .onClick(() => {
          void pickNodeSession(node).catch((error: unknown) =>
            nodeErrorNotice(error, t('streamB.nodeUnavailable.14c28f'))
          )
        })
    )
  menu.showAtPosition(position)
}
