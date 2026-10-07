import type { ChatMessage } from './types'
import { backfillParentIds, reattachOrphans } from './chatTree'

export interface NavigationTree {
  byId: Map<string, ChatMessage>
  children: Map<string | undefined, ChatMessage[]>
}
export interface NavigationFork {
  id: string
  parentId?: string
  choices: { message: ChatMessage; selected: boolean }[]
}

/** Current message records only, not log records. Repairs never mutate the source. */
export function buildNavigationTree(messages: readonly ChatMessage[]): NavigationTree {
  const local = [...new Map(messages.filter((m) => !m.draft).map((m) => [m.id, { ...m }])).values()]
  backfillParentIds(local)
  reattachOrphans(local)
  const byId = new Map(local.map((m) => [m.id, m]))
  const children = new Map<string | undefined, ChatMessage[]>()
  for (const message of local) {
    const siblings = children.get(message.parentId) ?? []
    siblings.push(message)
    children.set(message.parentId, siblings)
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.timestamp - b.timestamp)
  return { byId, children }
}

/** A straight stretch; stop at its next fork rather than materializing its descendants. */
export function navigationSegment(tree: NavigationTree, start: string): ChatMessage[] {
  const segment: ChatMessage[] = []
  const seen = new Set<string>()
  let message = tree.byId.get(start)
  while (message && !seen.has(message.id)) {
    seen.add(message.id)
    segment.push(message)
    const children = tree.children.get(message.id) ?? []
    if (children.length !== 1) break
    message = children[0]
  }
  return segment
}

export function navigationFork(
  tree: NavigationTree,
  parentId: string | undefined,
  current: readonly string[]
): NavigationFork | null {
  const children = tree.children.get(parentId) ?? []
  if (children.length < 2) return null
  const ids = new Set(current)
  return {
    id: parentId ?? 'roots',
    parentId,
    choices: children.map((message) => ({ message, selected: ids.has(message.id) })),
  }
}

/** One label per distinct message; shared prefixes appear once in search results. */
export function navigationBranchLabels(tree: NavigationTree): Map<string, string> {
  const labels = new Map<string, string>()
  const roots = tree.children.get(undefined) ?? []
  const pending = roots.map((message, i) => ({
    message,
    trail: roots.length > 1 ? `Start ${i + 1} of ${roots.length}` : '',
  }))
  while (pending.length) {
    const { message, trail } = pending.pop()!
    if (labels.has(message.id)) continue
    labels.set(message.id, trail || 'Shared conversation')
    const children = tree.children.get(message.id) ?? []
    children.forEach((child, i) => {
      const fork = children.length > 1 ? `Continuation ${i + 1} of ${children.length}` : ''
      pending.push({ message: child, trail: [trail, fork].filter(Boolean).join(' › ') })
    })
  }
  for (const id of tree.byId.keys())
    if (!labels.has(id)) labels.set(id, 'Disconnected continuation')
  return labels
}

/** The nearest fork on a selected path, including a conversation's several starts. */
export function selectedNavigationFork(
  tree: NavigationTree,
  path: readonly ChatMessage[]
): { fork: NavigationFork; index: number } | null {
  let selected: { fork: NavigationFork; index: number } | null = null
  const ids = path.map((m) => m.id)
  for (const parent of [undefined, ...path.map((m) => m.id)]) {
    const fork = navigationFork(tree, parent, ids)
    const index = fork?.choices.findIndex((choice) => choice.selected) ?? -1
    if (fork && index >= 0) selected = { fork, index }
  }
  return selected
}
