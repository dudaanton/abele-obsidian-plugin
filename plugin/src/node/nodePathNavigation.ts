import { UiError, uiMessage } from '@/i18n/streamBErrors'
import type { Workspace, WorkspaceLeaf } from 'obsidian'
import { z } from 'zod'
import type { PathTarget } from './NodePathModel'
import { TargetLocationSchema } from './nodeTargetIdentity'
export const NODE_SIDEBAR_VIEW = 'abele-node-sidebar'
export const NODE_FILE_VIEW = 'abele-node-file'
export const NODE_HISTORY_VIEW = 'abele-node-history'
export const NODE_CHAT_VIEW = 'abele-node-chat'
export const NODE_EDITOR_VIEW = 'abele-node-editor'
const id = z.string().min(1).max(128)
const target = z
  .object({
    nodeId: id,
    registrationId: id,
    projectId: id,
    kind: z.enum(['worktree', 'workspace']),
    id,
    incarnation: id.optional(),
    location: TargetLocationSchema.optional(),
  })
  .strict()
export const NodePathDebugMappingSchema = z
  .object({
    conversationId: id,
    sourceId: id,
    debugSessionId: id,
    incarnation: id,
    line: z.number().int().positive().optional(),
  })
  .strict()
export const NodePathTabSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('file'),
      target,
      path: z.string().min(1).max(4096),
      stage: z
        .union([
          z.enum(['staged', 'unstaged']),
          z.object({ kind: z.literal('committed'), base: z.string().min(1).max(4096) }).strict(),
        ])
        .optional(),
      debug: NodePathDebugMappingSchema.optional(),
      line: z.number().int().positive().optional(),
      match: z
        .object({ column: z.number().int().nonnegative(), length: z.number().int().positive() })
        .strict()
        .optional(),
      /** Being edited in this tab. */
      endLine: z.number().int().positive().optional(),
      edit: z.boolean().optional(),
      markdownMode: z.enum(['preview', 'code']).optional(),
    })
    .strict(),
  // The editor tab of earlier versions: kept only so a saved layout reopens it as an edited file.
  z.object({ kind: z.literal('editor'), target, path: z.string().min(1).max(4096) }).strict(),
  z
    .object({
      kind: z.literal('history'),
      target,
      /** The commit to open, chosen in the panel's history. */
      commit: z.string().min(1).max(128).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('chat'), target, sessionId: id, title: z.string().max(256) }).strict(),
])
export type NodePathTabState = z.infer<typeof NodePathTabSchema>
export const nodePathViewType = (state: NodePathTabState) =>
  ({
    file: NODE_FILE_VIEW,
    history: NODE_HISTORY_VIEW,
    chat: NODE_CHAT_VIEW,
    editor: NODE_EDITOR_VIEW,
  })[state.kind]
export function nodePathTabKey(state: NodePathTabState): string {
  if (state.kind === 'file') return 'file'
  const t: PathTarget = state.target
  if (state.kind === 'chat')
    return JSON.stringify(['chat', t.registrationId, t.nodeId, state.sessionId])
  return JSON.stringify([
    state.kind,
    t.registrationId,
    t.nodeId,
    t.kind,
    t.id,
    state.kind === 'editor' ? state.path : '',
  ])
}
export async function revealNodeDrawer(
  workspace: Workspace,
  registrationId?: string
): Promise<void> {
  const leaf = workspace.getLeavesOfType(NODE_SIDEBAR_VIEW)[0] ?? workspace.getLeftLeaf(false)
  if (!leaf) throw new UiError(uiMessage('streamBError.b43838f570'))
  await leaf.setViewState({
    type: NODE_SIDEBAR_VIEW,
    active: true,
    state: registrationId ? { registrationId } : {},
  })
  await workspace.revealLeaf(leaf)
  workspace.leftSplit.expand()
}
/** A source destination must be visible beyond either phone drawer. */
export function closeNodePathDrawers(workspace: Workspace, mobile: boolean): void {
  if (!mobile) return
  workspace.leftSplit.collapse()
  workspace.rightSplit.collapse()
}
/** A file is edited in its own tab: the old editor tab becomes that file's tab, editing. */
export const editedFileTab = (state: NodePathTabState): NodePathTabState =>
  state.kind === 'editor'
    ? { kind: 'file', target: state.target, path: state.path, edit: true }
    : state
/** A confirmed file operation also moves the tabs that refer to that exact folder. */
export async function updateNodeFileTabs(
  workspace: Workspace,
  target: PathTarget,
  path: string,
  destination?: string
): Promise<void> {
  for (const type of [NODE_FILE_VIEW, NODE_EDITOR_VIEW]) {
    for (const leaf of workspace.getLeavesOfType(type)) {
      const view = leaf.getViewState()
      if (view.type !== type) continue
      const parsed = NodePathTabSchema.safeParse(view.state)
      if (!parsed.success || !['file', 'editor'].includes(parsed.data.kind)) continue
      const state = parsed.data
      if (!('path' in state)) continue
      if (state.kind === 'file' && typeof state.stage === 'object') continue
      const old = state.target
      if (
        old.registrationId !== target.registrationId ||
        old.nodeId !== target.nodeId ||
        old.projectId !== target.projectId ||
        old.kind !== target.kind ||
        old.id !== target.id ||
        (state.path !== path && !state.path.startsWith(`${path}/`))
      )
        continue
      // A retained draft belongs to its original path. Never rebind or close its editor
      // as a side effect of a separate tree action.
      const editor = leaf.view as typeof leaf.view & { hasUnsentNodeFileEdit?: () => boolean }
      if (editor?.hasUnsentNodeFileEdit?.()) continue
      if (destination === undefined) leaf.detach()
      else
        await leaf.setViewState({
          ...view,
          state: {
            ...state,
            path: destination + state.path.slice(path.length),
            ...(state.kind === 'file' ? { debug: undefined } : {}),
          },
        })
    }
  }
}
export async function openNodePathTab(
  workspace: Workspace,
  raw: NodePathTabState,
  mobile: boolean,
  initialText?: string
): Promise<void> {
  const state = editedFileTab(NodePathTabSchema.parse(raw))
  // A chat is a chat: a tab of the chat in the sidebar, like every other one, never a pane.
  if (state.kind === 'chat') {
    if (mobile) workspace.leftSplit.collapse()
    return openNodeChat(state, initialText)
  }
  const type = nodePathViewType(state)
  const key = nodePathTabKey(state)
  const leaves = workspace.getLeavesOfType(type)
  const matching =
    state.kind === 'file' &&
    leaves.find((leaf) => {
      const old = NodePathTabSchema.safeParse(leaf.getViewState().state)
      return (
        old.success &&
        old.data.kind === 'file' &&
        old.data.path === state.path &&
        old.data.target.registrationId === state.target.registrationId &&
        old.data.target.nodeId === state.target.nodeId &&
        old.data.target.projectId === state.target.projectId &&
        old.data.target.kind === state.target.kind &&
        old.data.target.id === state.target.id &&
        ((typeof old.data.stage !== 'object' && typeof state.stage !== 'object') ||
          JSON.stringify(old.data.stage) === JSON.stringify(state.stage))
      )
    })
  const existing =
    matching ||
    leaves.find((leaf) => {
      const old = NodePathTabSchema.safeParse(leaf.getViewState().state)
      return old.success && nodePathTabKey(old.data) === key
    })
  const leaf = existing ?? workspace.getLeaf('tab')
  const retained = matching && NodePathTabSchema.safeParse(matching.getViewState().state)
  const next =
    retained && retained.success && retained.data.kind === 'file' && retained.data.edit
      ? { ...state, edit: true, stage: retained.data.stage, debug: retained.data.debug }
      : state
  const chosen =
    retained && retained.success && retained.data.kind === 'file'
      ? retained.data.markdownMode
      : undefined
  await leaf.setViewState({
    type,
    active: true,
    state:
      next.kind === 'file' && chosen
        ? { ...next, markdownMode: next.markdownMode ?? chosen }
        : next,
  })
  await workspace.revealLeaf(leaf)
  if (mobile) workspace.leftSplit.collapse()
}

/** Source navigation retains an existing document instead of replacing an unrelated file tab. */
export async function openNodeFileDestination(
  workspace: Workspace,
  destination: Extract<NodePathTabState, { kind: 'file' }>,
  mobile: boolean,
  sourceLeaf?: WorkspaceLeaf
): Promise<void> {
  const state = NodePathTabSchema.parse(destination) as typeof destination
  const sameTarget = (a: PathTarget, b: PathTarget) =>
    a.registrationId === b.registrationId &&
    a.nodeId === b.nodeId &&
    a.projectId === b.projectId &&
    a.kind === b.kind &&
    a.id === b.id
  let retained: typeof state | undefined
  const leaves = sourceLeaf ? [sourceLeaf] : workspace.getLeavesOfType(NODE_FILE_VIEW)
  const active = workspace.getMostRecentLeaf()
  const existing = [...leaves]
    .sort((a, b) => Number(b === active) - Number(a === active))
    .find((leaf) => {
      const old = NodePathTabSchema.safeParse(leaf.getViewState().state)
      if (
        !old.success ||
        old.data.kind !== 'file' ||
        (typeof old.data.stage === 'object' && !old.data.edit) ||
        old.data.path !== state.path ||
        !sameTarget(old.data.target, state.target)
      )
        return false
      retained = old.data
      return true
    })
  const leaf = existing ?? sourceLeaf ?? workspace.getLeaf('tab')
  await leaf.setViewState({
    type: NODE_FILE_VIEW,
    active: true,
    state: {
      ...state,
      ...(retained ? { target: retained.target } : {}),
      ...(retained?.edit ? { edit: true } : {}),
      ...(retained?.markdownMode
        ? { markdownMode: state.markdownMode ?? retained.markdownMode }
        : {}),
      ...(retained?.stage ? { stage: retained.stage } : {}),
      ...(retained?.debug
        ? { debug: { ...retained.debug, ...(state.line ? { line: state.line } : {}) } }
        : {}),
    },
  })
  await workspace.revealLeaf(leaf)
  closeNodePathDrawers(workspace, mobile)
}

/**
 * Opens a node session as a tab of the sidebar chat, where every chat lives, and shows it there.
 * `text`, when given, is added to its draft once the chat has loaded, never sent.
 */
export async function openNodeChat(
  state: Extract<NodePathTabState, { kind: 'chat' }>,
  text?: string
): Promise<void> {
  const { ChatService } = await import('@/ai/ChatService')
  const chats = ChatService.getInstance()
  const opening = chats.openNodeSession({
    kind: 'node-session',
    nodeId: state.target.nodeId,
    registrationId: state.target.registrationId,
    sessionId: state.sessionId,
    title: state.title,
  })
  if (text) {
    const presenter = chats.getNodeSession(`node:${state.target.registrationId}:${state.sessionId}`)
    if (presenter) {
      // Restore the local draft before editing it; connecting to the node may take
      // much longer, so do not wait for the remote part of opening the session.
      await (presenter.refresh?.() ?? opening)
      const draft = presenter.draft.value
      draft.text = draft.text ? `${draft.text}\n\n${text}` : text
    }
  }
  await Promise.all([opening, chats.revealSidebar({ focus: true })])
}
