import { resolveChatAnchor } from '@/selection/anchors'
import { anchorBacklink } from '@/selection/anchorLinks'
import type { ChatAnchor, ChatAnchorResolution, ChatSelectionSnapshot } from '@/selection/types'
import { selectionReturnLeaf } from './chatTree'
import type { ChatMessage } from './types'

export type AnchorReturn =
  | {
      status: 'ready'
      messageId: string
      leafId: string
      anchor: ChatAnchor
      resolution: ChatAnchorResolution
    }
  | { status: 'missing' | 'ambiguous' }

/** Source-neutral return planning. The UI highlights only a proven, renderer-verified range. */
export function resolveAnchorReturn(
  chatId: string,
  anchorId: string,
  messages: ChatMessage[],
  activePath: readonly string[]
): AnchorReturn {
  const matches = messages.flatMap((message) =>
    (message.selection?.anchors ?? [])
      .filter((anchor) => anchor.id === anchorId && anchor.original.chatId === chatId)
      .map((anchor) => ({ message, anchor }))
  )
  if (matches.length > 1) return { status: 'ambiguous' }
  if (!matches.length) return { status: 'missing' }
  const { message, anchor } = matches[0]
  const leafId = selectionReturnLeaf(messages, message.id, activePath)
  if (!leafId || anchor.original.messageId !== message.id) return { status: 'missing' }
  const current = { chatId, messageId: message.id, revisionId: message.selection?.revisionId ?? '' }
  const versions = message.selection?.versions ?? []
  let resolution = resolveChatAnchor(anchor, current, versions)
  // External writers may leave stale optional metadata beside changed content.
  if (resolution.status === 'current' && resolution.revision.content !== message.content)
    resolution = resolveChatAnchor(anchor, { ...current, revisionId: '' }, versions)
  return { status: 'ready', messageId: message.id, leafId, anchor, resolution }
}

/** A backlink cannot escape this boundary until the captured anchor has been durably saved. */
export async function prepareSelectionBacklink(
  snapshot: ChatSelectionSnapshot,
  ports: { ensureAnchor(snapshot: ChatSelectionSnapshot): Promise<ChatAnchor>; path(): string }
): Promise<string> {
  const anchor = await ports.ensureAnchor(snapshot)
  return anchorBacklink(ports.path(), { chatId: anchor.original.chatId, anchorId: anchor.id })
}
