import { nanoid } from 'nanoid'
import { undecoratedMessage } from './chatBindingProof'
import type { HighlightColor } from '@/reader/highlights'
import { EMPTY_USAGE, type AssistantContentBlock, type Message } from './client'
import type { ChatMessage } from './types'

/** Rendered-text anchors, independent of a renderer or storage backend. */
export interface ReplyHighlight {
  id: string
  quote: string
  start: number
  color: HighlightColor
}

export interface ReplyRevision {
  proposal: string
  before: string
  after: string
  author: string
  at: number
  highlights: ReplyHighlight[]
  undoneAt?: number
  /** Version identity proof for undo, not equality of the before/after strings. */
  beforeRevisionId?: string
  afterRevisionId?: string
}

/** A proposal is not permission to change a reply. Only owner acceptance applies it. */
export interface ReplyProposal {
  id: string
  parent: string
  message: string
  before: string
  from: number
  old: string
  text: string
  request: string
  author: string
  at: number
  status: 'pending' | 'accepted' | 'rejected'
  /** Acceptance is durable before application; a failed application can only be resumed. */
  application?: 'pending' | 'done'
}

/** Never infer a source range from a rendered offset: markdown offsets are different. */
export function sourcePassage(source: string, quote: string): { from: number; old: string } {
  const from = source.indexOf(quote)
  if (!quote || from < 0)
    throw new Error(
      'The selection crosses markdown formatting. Select a passage within one text run instead.'
    )
  if (source.indexOf(quote, from + 1) !== -1)
    throw new Error(
      'The selected passage is ambiguous. Select more surrounding words and start a new comment.'
    )
  return { from, old: quote }
}

export function acceptRevision(
  message: ChatMessage,
  proposal: ReplyProposal,
  at: number
): ChatMessage {
  if (proposal.status !== 'pending') throw new Error('This proposal is no longer pending.')
  if (message.role !== 'assistant' || message.id !== proposal.message)
    throw new Error('The model reply is unavailable.')
  if (message.content !== proposal.before)
    throw new Error('The reply has changed. Ask for a new proposal; nothing was changed.')
  if (
    !Number.isInteger(proposal.from) ||
    proposal.from < 0 ||
    !proposal.old ||
    message.content.slice(proposal.from, proposal.from + proposal.old.length) !== proposal.old
  )
    throw new Error('The selected passage no longer matches.')
  const after =
    message.content.slice(0, proposal.from) +
    proposal.text +
    message.content.slice(proposal.from + proposal.old.length)
  const beforeRevisionId = message.selection?.revisionId
  const afterRevisionId = beforeRevisionId ? nanoid() : undefined
  return {
    ...message,
    content: after,
    selection: message.selection
      ? { ...message.selection, revisionId: afterRevisionId! }
      : undefined,
    // Rendered offsets may move. Keep annotations on the old version, never move them to
    // another occurrence by guessing. Undo restores them with that version.
    highlights: [],
    revisions: [
      ...(message.revisions ?? []),
      {
        proposal: proposal.id,
        before: message.content,
        after,
        author: proposal.author,
        at,
        highlights: message.highlights ?? [],
        beforeRevisionId,
        afterRevisionId,
      },
    ],
  }
}

export function undoRevision(message: ChatMessage, at: number): ChatMessage {
  const revisions = [...(message.revisions ?? [])]
  const index = revisions.findLastIndex((revision) => !revision.undoneAt)
  const revision = revisions[index]
  if (!revision) throw new Error('This revision can no longer be undone.')
  const afterSemantic = undecoratedMessage({ ...message, content: revision.after }, true).content
  if (
    revision.after !== message.content &&
    afterSemantic !== undecoratedMessage(message, true).content
  )
    throw new Error('This revision can no longer be undone.')
  // A separately removed decoration must not return with semantic Undo.
  const before = undecoratedMessage(
    {
      ...message,
      content: revision.before,
      decorationOperations: message.decorationOperations?.filter((op) => op.undoneAt),
    },
    true
  ).content
  revisions[index] = { ...revision, undoneAt: at }
  return {
    ...message,
    content: before,
    highlights: revision.highlights,
    revisions,
    selection: message.selection
      ? {
          ...message.selection,
          // An older writer may have dropped the proof. Equal bytes are not an undo identity.
          revisionId:
            before === revision.before ? (revision.beforeRevisionId ?? nanoid()) : nanoid(),
        }
      : undefined,
  }
}

/** Corrections have no provider model: they are projected annotations, not new model turns.
 * This also identifies corrections materialized in the log for older clients. */
export function isReplyCorrection(message: Message): boolean {
  return message.role === 'assistant' && message.model === ''
}

/** Pure projection: reply text keeps assistant priority, even after its original was compacted. */
export function projectReplyHistory(replies: ChatMessage[], internal: Message[]): Message[] {
  const edited = new Map(
    replies
      .filter((m) => m.revisions?.length)
      .map((m) => [
        m.id,
        {
          ...undecoratedMessage(m),
        },
      ])
  )
  const seen = new Set<string>()
  const projected: Message[] = internal.map((message) => {
    const reply = message.chatMessageId ? edited.get(message.chatMessageId) : undefined
    if (!reply || message.role !== 'assistant') return message
    seen.add(reply.id)
    let written = false
    const content = message.content.flatMap<AssistantContentBlock>((block) => {
      if (block.type !== 'text') return [block]
      if (written) return []
      written = true
      return [{ type: 'text' as const, text: reply.content }]
    })
    if (!written) content.unshift({ type: 'text', text: reply.content })
    return { ...message, content }
  })
  for (const reply of edited.values()) {
    if (seen.has(reply.id)) continue
    projected.push({
      role: 'assistant',
      content: [
        { type: 'text', text: '[Owner-reviewed correction to an earlier reply]\n' + reply.content },
      ],
      model: '',
      usage: { ...EMPTY_USAGE },
      stopReason: 'stop',
      chatMessageId: reply.id,
      timestamp: reply.revisions!.at(-1)!.undoneAt ?? reply.revisions!.at(-1)!.at,
    })
  }
  return projected
}

/** Materialize current text for v2 clients that have no reply projection implementation. */
export function compatibleReplyHistory(replies: ChatMessage[], internal: Message[]): Message[] {
  const projected = projectReplyHistory(replies, internal)
  const compact = projected.findLastIndex(
    (m) => m.role === 'system' && m.content.startsWith('[Conversation compacted]')
  )
  if (compact < 0) return projected
  const tail = projected.slice(compact + 1)
  // Append only missing assistant corrections after the summary. Future edits/undo update
  // these linked records too, rather than accumulating conflicting versions.
  return [...projected, ...projectReplyHistory(replies, tail).slice(tail.length)]
}
