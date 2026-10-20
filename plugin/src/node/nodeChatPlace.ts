import { computed, type ComputedRef } from 'vue'
import { Platform } from 'obsidian'
import type { NodeChatPresenter } from './NodeChatPresenter'
import type { NodePathModel, PathTarget } from './NodePathModel'
import { bindPathTarget, nodeChatSwitches, type NodeChatSwitch } from './nodePathChat'
import { nodeResourceTarget } from './NodeFilesModel'
import type { CopySummary } from '@/components/nodeWork/types'

/** Where a node chat's agent works and the levers on it, as the chat view takes them. */
export interface NodeChatPlace {
  worktree?: CopySummary
  folder?: string
  canSwitchWorktree: boolean
  canSwitchNative: boolean
  currentTarget?: PathTarget
  switches: NodeChatSwitch[]
}

/**
 * The folder and worktree a node chat works in, read from the node's own binding of the session,
 * else from the place the node panel lists it at, else from where it was opened. The same for a
 * chat in the sidebar and one restored from an old tab.
 */
export function nodeChatPlace(
  presenter: NodeChatPresenter,
  model: NodePathModel,
  opened?: PathTarget
): ComputedRef<NodeChatPlace & { target?: PathTarget }> {
  return computed(() => {
    const sessionId = presenter.reference.sessionId
    const binding = presenter.binding.value
    const identity = {
      nodeId: presenter.reference.nodeId,
      registrationId: presenter.reference.registrationId,
    }
    const listed = model.sessions.value.find((s) => s.session.session_id === sessionId)?.target
    const target = binding
      ? {
          ...bindPathTarget(identity, binding.project_id, binding.target),
          incarnation: binding.incarnation,
        }
      : (listed ?? opened)
    const capabilities = model.capabilities.value
    const base = {
      canSwitchWorktree: capabilities.includes('node_path_execution'),
      canSwitchNative: capabilities.includes('node_path_native_switching'),
    }
    if (!target || binding === null) return { ...base, switches: [] as NodeChatSwitch[] }
    const folder = model.folders.value.find((f) => f.id === target.projectId)
    const copy = model.copy(target) ?? {
      id: target.id,
      kind: 'project' as const,
      branch: folder?.name ?? 'Folder',
      path: folder?.path ?? '',
      changed: 0,
    }
    return {
      ...base,
      target,
      worktree: copy,
      folder: folder?.name,
      currentTarget: target,
      switches: nodeChatSwitches(
        presenter.projection.value.unknown,
        target,
        sessionId,
        (id) =>
          model.folders.value.flatMap((f) => f.copies).find((c) => c.id === id)?.branch ??
          'Unavailable worktree',
        presenter.hasRestoredHistory
      ),
    }
  })
}

/** A file the agent named, opened from the chat in a node file tab of the same place. */
export async function openNodeChatResource(resource: string, target: PathTarget): Promise<void> {
  const { openNodePathTab } = await import('./nodePathNavigation')
  const { GlobalStore } = await import('@/stores/GlobalStore')
  await openNodePathTab(
    GlobalStore.getInstance().app.workspace,
    { kind: 'file', target, path: nodeResourceTarget(resource).path },
    Platform.isMobile
  )
}
