import type { ChatMessage } from './types'
import { findDeepestLeaf, getPathToLeaf } from './chatTree'
import { navigationTitle } from './chatNavigation'

/** One way the chat went from a place, as the switch on its first message lists it. */
export interface BranchChoice {
  id: string
  title: string
  timestamp: number
  /** Questions in it, its first included, down to where the branch ends now. */
  questions: number
  /** Something there wants you: a call waiting for approval, or one refused or failed. */
  tone?: 'waiting' | 'failed'
}

/** The messages that differ at one place, on the one of them the path goes through. */
export interface BranchSwitch {
  choices: BranchChoice[]
  index: number
}

function toneOf(path: readonly ChatMessage[]): BranchChoice['tone'] {
  const calls = path.filter((m) => m.role === 'tool-call')
  if (calls.some((m) => m.toolStatus === 'rejected' || m.subAgentRun?.status === 'error'))
    return 'failed'
  if (calls.some((m) => m.toolStatus === 'pending')) return 'waiting'
  return undefined
}

/** A branch from its first message down to where it ends now, by its oldest continuations. */
export function branchPath(all: ChatMessage[], id: string): ChatMessage[] {
  const path = getPathToLeaf(all, findDeepestLeaf(all, id).id)
  return path.slice(path.findIndex((m) => m.id === id))
}

/** One way on from a place: how it starts and what it holds, following its oldest continuation. */
export function branchChoice(all: ChatMessage[], message: ChatMessage): BranchChoice {
  const tail = branchPath(all, message.id)
  // What wants you counts anywhere under it, in its own branches too, not only on its oldest way.
  const under: ChatMessage[] = [message]
  for (let i = 0; i < under.length; i++)
    under.push(...all.filter((m) => m.parentId === under[i].id))
  return {
    id: message.id,
    title: navigationTitle(message),
    timestamp: message.timestamp,
    questions: tail.filter((m) => m.role === 'user' && !m.draft).length,
    tone: toneOf(under),
  }
}

/**
 * Where the visible path passes a place the chat went more than one way: the switch goes on the
 * message that differs, keyed by its id. A conversation's several beginnings count the same way,
 * on its first message.
 */
export function branchSwitches(
  all: ChatMessage[],
  visible: readonly ChatMessage[]
): Map<string, BranchSwitch> {
  const out = new Map<string, BranchSwitch>()
  const settled = all.filter((m) => !m.draft)
  // An old flat chat links no message to another: one line, no beginnings to choose between.
  if (!settled.some((m) => m.parentId)) return out
  const byParent = new Map<string | undefined, ChatMessage[]>()
  for (const message of settled) {
    const siblings = byParent.get(message.parentId) ?? []
    siblings.push(message)
    byParent.set(message.parentId, siblings)
  }
  for (const message of visible) {
    const siblings = byParent.get(message.parentId)
    if (!siblings || siblings.length < 2) continue
    const ordered = [...siblings].sort((a, b) => a.timestamp - b.timestamp)
    const index = ordered.findIndex((m) => m.id === message.id)
    if (index < 0) continue
    out.set(message.id, { choices: ordered.map((m) => branchChoice(settled, m)), index })
  }
  return out
}

/**
 * The path stops at a message that already goes on: a new branch is being written after it.
 * Returns the message it will follow, or null when the path ends where the chat ends.
 */
export function newBranchAfter(
  all: ChatMessage[],
  visible: readonly ChatMessage[],
  leafId: string | null
): ChatMessage | null {
  const last = visible.at(-1)
  if (!last || leafId !== last.id) return null
  return all.some((m) => m.parentId === last.id && !m.draft) ? last : null
}
