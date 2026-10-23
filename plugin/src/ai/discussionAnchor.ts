/**
 * What the top of a side discussion shows: the words it is about, where they live, and what the
 * agent is given besides them. Plain data, so the view stays small and tests can check each case.
 *
 * The real resolver reads the same sources `buildCommentContext` and
 * `buildMessageCommentContext` send to the model, so the list never claims more or less than
 * the model gets. A screen or a test hands its own through `setDiscussionAnchorResolver`.
 */
import type { ChatSession } from './ChatSession'

export interface AnchorSource {
  /** Lucide name: file-text for a note, message-square for a chat answer, book-open for a book. */
  icon: string
  /** Where the words are, in a few words: «Balcony garden», «Weather station · answer at 12:40». */
  text: string
  /** Set when the way back no longer finds the words as they were. */
  missing?: 'changed' | 'deleted'
  /** Goes back to the passage, marking it. Absent when there is nothing to go back to. */
  open?: () => void
}

export interface ContextItem {
  key: string
  icon: string
  title: string
  /** Quiet facts after the title: a size, a count, «words only». */
  detail?: string
  /** Opens what the item is: the note, the chat at that message, the agent's settings. */
  open?: () => void
}

export interface DiscussionAnchorView {
  quote: string
  /** The words were selected in a code block: they keep the code's font and lines. */
  code?: boolean
  source: AnchorSource
  context: ContextItem[]
}

type Resolver = (session: ChatSession) => Promise<DiscussionAnchorView | null>

let resolver: Resolver = async (session) => {
  const anchor = session.anchor.value
  if (!anchor?.quote) return null
  // The production resolver is built from the comment context builders; see the brief.
  return {
    quote: anchor.quote,
    source: { icon: anchor.message ? 'message-square' : 'file-text', text: anchor.note },
    context: [],
  }
}

export function setDiscussionAnchorResolver(next: Resolver): void {
  resolver = next
}

export function discussionAnchor(session: ChatSession): Promise<DiscussionAnchorView | null> {
  return resolver(session)
}
