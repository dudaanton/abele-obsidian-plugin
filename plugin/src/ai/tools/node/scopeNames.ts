import type { NodeChatTarget, NodeScopeEntry } from '@/ai/nodeScope'
import { nodeTargetId } from '@/ai/nodeScope'
import { nodeAgentHost } from './owner'

/**
 * What a place on a node is called, for a person: the node's name, the folder's and the
 * worktree's branch. Access is stored by ids, which mean nothing on screen; these are looked up
 * from the node and kept for the page's life. Whatever cannot be found stays as its id.
 */
export interface NodeScopeNames {
  node: string
  folder?: string
  branch?: string
}

type Place = { node_id: string; project_id?: string; target?: NodeChatTarget }

const folders = new Map<string, Promise<Map<string, { name: string; git: boolean }>>>()
const branches = new Map<string, Promise<Map<string, string>>>()

const lastPart = (path: string) =>
  path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() || path

function folderNames(nodeId: string) {
  let found = folders.get(nodeId)
  if (!found) {
    found = (async () => {
      const names = new Map<string, { name: string; git: boolean }>()
      const client = (await nodeAgentHost()).connection(nodeId).client
      if (!client.connected) return names
      let after: string | undefined
      for (let page = 0; page < 64; page++) {
        const batch = await client.listProjects(after)
        for (const p of batch)
          names.set(p.project_id, { name: lastPart(p.root_path), git: !!p.repository_path })
        if (batch.length < 100) break
        after = batch.at(-1)?.project_id
      }
      return names
    })().catch(() => new Map())
    folders.set(nodeId, found)
  }
  return found
}

function branchNames(nodeId: string, projectId: string, git: boolean) {
  const key = `${nodeId}\u0000${projectId}`
  let found = branches.get(key)
  if (!found) {
    found = (async () => {
      const names = new Map<string, string>()
      const client = (await nodeAgentHost()).connection(nodeId).client
      if (!client.connected) return names
      if (git) {
        const { entries } = await client.repository.worktrees({ project_id: projectId })
        for (const w of entries) names.set(w.worktree_id, w.branch || w.path_label)
      } else {
        for (const w of await client.listWorkspaces(projectId))
          names.set(w.workspace_id, lastPart(w.path))
      }
      return names
    })().catch(() => new Map())
    branches.set(key, found)
  }
  return found
}

/** The names of a place: its node always, its folder and branch when it is that narrow. */
export async function nodeScopeNames(place: Place | NodeScopeEntry): Promise<NodeScopeNames> {
  let node = place.node_id
  try {
    const nodes: { id: string; node_id?: string; label: string }[] = (await nodeAgentHost()).nodes()
    node = nodes.find((n) => n.id === place.node_id || n.node_id === place.node_id)?.label ?? node
  } catch {
    /* No node host here: the id is all there is. */
  }
  const projectId = 'project_id' in place ? place.project_id : undefined
  if (!projectId) return { node }
  const folder = (await folderNames(place.node_id)).get(projectId)
  const target = 'target' in place ? place.target : undefined
  if (!target) return { node, folder: folder?.name ?? projectId }
  const branch = (await branchNames(place.node_id, projectId, folder?.git ?? true)).get(
    nodeTargetId(target)
  )
  return { node, folder: folder?.name ?? projectId, branch: branch ?? nodeTargetId(target) }
}

/** The place as a short title: «sample-app / sample-branch», the node's name when it is all. */
export const nodeScopeTitle = (n: NodeScopeNames) =>
  n.folder ? (n.branch ? `${n.folder} / ${n.branch}` : n.folder) : n.node

/** The place and what may be done there, said in full: what a tooltip tells. */
export function nodeScopeSentence(n: NodeScopeNames, access: 'read' | 'edit'): string {
  const where = [
    `${n.node} node`,
    n.folder ?? 'every folder',
    ...(n.branch ? [`worktree ${n.branch}`] : []),
  ]
  return `${where.join(' · ')} · can ${access === 'edit' ? 'read and edit' : 'read'} files`
}

/** Forgets the names looked up, for a node whose folders changed. */
export function forgetNodeScopeNames(nodeId?: string): void {
  for (const key of [...folders.keys()]) if (!nodeId || key === nodeId) folders.delete(key)
  for (const key of [...branches.keys()])
    if (!nodeId || key.startsWith(`${nodeId}\u0000`)) branches.delete(key)
}
