import type { ChatMessage, MessageComment } from './types'
import {
  buildChatNavigation,
  navigationExcerpt,
  navigationTitle,
  searchChatNavigation,
  type NavigationHit,
} from './chatNavigation'
import { buildNavigationTree, navigationBranchLabels } from './chatNavigationBranches'

export interface NavigationDiscussionData {
  messages: readonly ChatMessage[]
  allMessages?: readonly ChatMessage[]
  comments: readonly MessageComment[]
}
export interface DiscussionNavigationHit extends NavigationHit {
  discussionId: string
  label: string
  continuation: string
}
export interface UnavailableDiscussion {
  discussionId: string
  label: string
}
export interface DiscussionSearchProgress {
  done: number
  total: number
}
export interface DiscussionSearchResult {
  hits: DiscussionNavigationHit[]
  unavailable: UnavailableDiscussion[]
  canceled: boolean
}

/** Explicit, read-only traversal. A canceled file read may finish, but cannot publish or expand. */
export async function searchNavigationDiscussions(options: {
  query: string
  seeds: readonly MessageComment[]
  allBranches?: boolean
  read: (id: string) => Promise<NavigationDiscussionData | null>
  signal?: AbortSignal
  onProgress?: (progress: DiscussionSearchProgress) => void
  onHit?: (hit: DiscussionNavigationHit) => void
  onUnavailable?: (entry: UnavailableDiscussion) => void
  yield?: () => Promise<void>
}): Promise<DiscussionSearchResult> {
  const result: DiscussionSearchResult = { hits: [], unavailable: [], canceled: false }
  if (!options.query.trim()) return result
  const queue: { comment: MessageComment; trail: string[] }[] = []
  const seen = new Set<string>()
  const enqueue = (comment: MessageComment, trail: string[]) => {
    if (seen.has(comment.id)) return
    seen.add(comment.id)
    queue.push({ comment, trail })
  }
  for (const comment of options.seeds) enqueue(comment, [])
  let done = 0
  const progress = () => options.onProgress?.({ done, total: seen.size })
  progress()
  for (let i = 0; i < queue.length; i++) {
    if (options.signal?.aborted) break
    const { comment, trail } = queue[i]
    let data: NavigationDiscussionData | null = null
    try {
      data = await options.read(comment.id)
    } catch {
      /* Unavailable is a result, not a vanished row. */
    }
    if (options.signal?.aborted) break
    done++
    if (!data) {
      const entry = {
        discussionId: comment.id,
        label: [...trail, navigationExcerpt(comment.quote ?? '') || 'Discussion'].join(' › '),
      }
      result.unavailable.push(entry)
      options.onUnavailable?.(entry)
    } else {
      const messages = options.allBranches
        ? [...buildNavigationTree(data.allMessages ?? data.messages).byId.values()]
        : data.messages
      const title = data.messages.find((m) => m.role === 'user' && !m.draft)
      const label = [...trail, title ? navigationTitle(title) : 'Discussion'].join(' › ')
      const labels = navigationBranchLabels(buildNavigationTree(data.allMessages ?? data.messages))
      for (const hit of searchChatNavigation(messages, options.query)) {
        const found = {
          ...hit,
          discussionId: comment.id,
          label,
          continuation: labels.get(hit.messageId) ?? 'Shared conversation',
        }
        result.hits.push(found)
        options.onHit?.(found)
      }
      for (const turn of buildChatNavigation(messages, data.comments)) {
        for (const child of turn.discussions)
          enqueue(child, [...trail, title ? navigationTitle(title) : 'Discussion'])
      }
    }
    progress()
    if (options.yield) await options.yield()
  }
  result.canceled = !!options.signal?.aborted
  return result
}
