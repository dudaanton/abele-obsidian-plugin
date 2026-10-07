import { createChatAnchor, resolveChatAnchor } from '@/selection/anchors'
import { sameRevision } from '@/selection/revisionMapping'
import type {
  ChatAnchor,
  ChatRevision,
  ChatSelectionSnapshot,
  RevisionPorts,
  RevisionReference,
  SourceRange,
} from '@/selection/types'
import type { ChatMessage } from './types'

/** Optional message annotation data. Each source/projection is retained once per version. */
export interface ChatSelectionData {
  revisionId: string
  versions: ChatRevision[]
  anchors: ChatAnchor[]
}

/** Storage contracts only: later binding publication writes this beside decorated content. */
export interface ChatDecorationOperation {
  id: string
  bindingId: string
  anchorId: string
  targetPath: string
  captured: RevisionReference
  patch: { range: SourceRange; before: string; after: string }
  resulting: RevisionReference
  undoneAt?: number
}

/** Separate from execution; retained verbatim until a later binding adapter settles it. */
export interface ChatBindingRecovery {
  operation: ChatDecorationOperation
  status: 'pending' | 'applied' | 'known-not-written' | 'uncertain' | 'undone'
  /** The actual created/existing card, not a proposed filename. */
  targetPath: string
  evidence?: string
}

export function prepareSelectionRevision(
  message: ChatMessage,
  chatId: string,
  ports: RevisionPorts
): { selection: ChatSelectionData; revision: ChatRevision } {
  const revisionId = message.selection?.revisionId ?? ports.nextId()
  const reference = { chatId, messageId: message.id, revisionId }
  const versions = message.selection?.versions ?? []
  const existing = versions.filter((version) => sameRevision(version.reference, reference))
  if (existing.length > 1 || (existing.length && existing[0].content !== message.content))
    throw new Error('The selection revision changed. Reopen the chat before selecting again.')
  const projection = ports.project(message.content)
  if (!chatId || !revisionId || !projection.version)
    throw new Error('Revision and projection identities must not be empty')
  if (existing.length && JSON.stringify(existing[0].projection) !== JSON.stringify(projection))
    throw new Error('The selection projection changed. Use a compatible renderer.')
  const revision: ChatRevision =
    existing[0] ??
    Object.freeze({
      reference: Object.freeze(reference),
      content: message.content,
      projection: Object.freeze({ ...projection }),
    })
  return {
    revision,
    selection: {
      revisionId,
      versions: existing.length ? versions : [...versions, revision],
      anchors: message.selection?.anchors ?? [],
    },
  }
}

/** Only a captured CURRENT version can launch; historical versions remain return targets. */
export function ensureCapturedAnchor(
  message: ChatMessage,
  chatId: string,
  snapshot: ChatSelectionSnapshot,
  nextId: () => string
): { selection: ChatSelectionData; anchor: ChatAnchor } {
  const selection = message.selection
  const source = snapshot.source
  const versions = selection?.versions.filter((v) => sameRevision(v.reference, source)) ?? []
  if (
    !selection ||
    source.chatId !== chatId ||
    source.messageId !== message.id ||
    source.revisionId !== selection.revisionId ||
    versions.length !== 1 ||
    versions[0].content !== message.content ||
    source.role !== message.role
  )
    throw new Error('The captured selection revision changed. Select the passage again.')
  // Validate even when reusing an existing anchor. Never search for the quote in source text.
  const candidate = createChatAnchor(snapshot, versions[0], () => 'validation')
  const existing = selection.anchors.find(
    (anchor) =>
      sameRevision(anchor.original, candidate.original) &&
      anchor.snapshot.text === snapshot.text &&
      anchor.snapshot.source.projectionVersion === source.projectionVersion &&
      anchor.snapshot.source.range.start === source.range.start &&
      anchor.snapshot.source.range.end === source.range.end &&
      resolveChatAnchor(anchor, source, versions).status === 'current'
  )
  const anchor = existing ?? createChatAnchor(snapshot, versions[0], nextId)
  if (!existing && selection.anchors.some((item) => item.id === anchor.id))
    throw new Error('Anchor identity must be unique')
  return {
    anchor,
    selection: existing ? selection : { ...selection, anchors: [...selection.anchors, anchor] },
  }
}
