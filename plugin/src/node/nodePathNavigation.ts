import type { Workspace } from 'obsidian'
import { z } from 'zod'
import type { PathTarget } from './NodePathModel'
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
  })
  .strict()
export const NodePathTabSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('file'),
      target,
      path: z.string().min(1).max(4096),
      stage: z.enum(['staged', 'unstaged']).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('editor'), target, path: z.string().min(1).max(4096) }).strict(),
  z.object({ kind: z.literal('history'), target }).strict(),
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
  if (!leaf) throw new Error('A left sidebar leaf is not available.')
  await leaf.setViewState({
    type: NODE_SIDEBAR_VIEW,
    active: true,
    state: registrationId ? { registrationId } : {},
  })
  await workspace.revealLeaf(leaf)
  workspace.leftSplit.expand()
}
export async function openNodePathTab(
  workspace: Workspace,
  raw: NodePathTabState,
  mobile: boolean
): Promise<void> {
  const state = NodePathTabSchema.parse(raw),
    type = nodePathViewType(state)
  const key = nodePathTabKey(state)
  const existing = workspace.getLeavesOfType(type).find((leaf) => {
    const old = NodePathTabSchema.safeParse(leaf.getViewState().state)
    return old.success && nodePathTabKey(old.data) === key
  })
  const leaf = existing ?? workspace.getLeaf('tab')
  await leaf.setViewState({ type, active: true, state })
  await workspace.revealLeaf(leaf)
  if (mobile) workspace.leftSplit.collapse()
}
