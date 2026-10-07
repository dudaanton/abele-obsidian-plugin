/** All offsets are half-open UTF-16 code-unit positions, without Unicode normalization. */
export interface RenderedRange {
  readonly space: 'rendered'
  readonly start: number
  readonly end: number
}

/** Deliberately not assignable to RenderedRange. A future source patch needs its own proof. */
export interface SourceRange {
  readonly space: 'source'
  readonly start: number
  readonly end: number
}

export interface TextProjection {
  /** Identifies renderer/text-extraction semantics, not the content or revision. */
  readonly version: string
  readonly text: string
}

export interface RevisionReference {
  readonly chatId: string
  readonly messageId: string
  readonly revisionId: string
}

/** Retain referenced revisions once in storage, rather than embedding them in every anchor. */
export interface ChatRevision {
  readonly reference: RevisionReference
  /** Opaque source for the injected projector; the core does not assume Markdown. */
  readonly content: string
  readonly projection: TextProjection
}

export interface RevisionPorts {
  /** Must allocate a fresh identity per accepted version, even when the bytes are equal. */
  nextId(): string
  /** Must be deterministic for a given content and projection version. */
  project(content: string): TextProjection
}

export interface BookSelectionSource {
  readonly kind: 'book'
  readonly place: string
  readonly chapter: string
  readonly language: string
}

export interface ChatSelectionSource extends RevisionReference {
  readonly kind: 'chat'
  readonly role: 'user' | 'assistant'
  readonly author: string
  readonly quote: string
  readonly range: RenderedRange
  readonly projectionVersion: string
  readonly context: { readonly before: string; readonly after: string }
}

interface SelectionDetails {
  readonly text: string
  readonly sentence: string
  readonly title: string
  /** Navigation/display hint only; never an identity. */
  readonly pathHint: string
}

export interface BookSelectionSnapshot extends SelectionDetails {
  readonly source: BookSelectionSource
}

export interface ChatSelectionSnapshot extends SelectionDetails {
  readonly source: ChatSelectionSource
}

export type SelectionSnapshot = BookSelectionSnapshot | ChatSelectionSnapshot

export interface AnchorPlacement {
  readonly revision: RevisionReference
  readonly projectionVersion: string
  readonly range: RenderedRange
}

export interface ChatAnchor {
  readonly id: string
  readonly original: RevisionReference
  readonly snapshot: ChatSelectionSnapshot
  /** Only captured or proven placements; never results of quote searching. */
  readonly placements: readonly AnchorPlacement[]
}

/** Exact edit provenance in OLD rendered coordinates, not a heuristic string diff. */
export interface RenderedTextEdit {
  readonly range: RenderedRange
  readonly text: string
}

export type RevisionMapping =
  | {
      readonly kind: 'proven'
      readonly from: RevisionReference
      readonly to: RevisionReference
      readonly projectionVersion: string
      /** Ordered, non-overlapping edits which must replay to the new projection exactly. */
      readonly edits: readonly RenderedTextEdit[]
    }
  | {
      readonly kind: 'ambiguous'
      readonly from: RevisionReference
      readonly to: RevisionReference
    }

export type PlacementMappingResult =
  | { readonly status: 'mapped'; readonly placement: AnchorPlacement }
  | { readonly status: 'intersecting' | 'ambiguous' }
  | {
      readonly status: 'invalid'
      readonly reason: 'identity' | 'projection-version' | 'range' | 'replay'
    }

export type ChatAnchorResolution =
  | {
      readonly status: 'current'
      readonly revision: ChatRevision
      readonly placement: AnchorPlacement
    }
  | {
      readonly status: 'historical'
      readonly revision: ChatRevision
      readonly placement: AnchorPlacement
    }
  | { readonly status: 'unresolved'; readonly snapshot: ChatSelectionSnapshot }
  | { readonly status: 'missing'; readonly reason: 'chat' | 'message' | 'anchor' }
  | { readonly status: 'ambiguous'; readonly reason: 'revision' | 'placement' }

/** Later adapters own durability, serialization and identity lookup; the core performs no IO. */
export interface AnchorStoragePort {
  getAnchor(chatId: string, anchorId: string): Promise<ChatAnchor | undefined>
  getRevision(reference: RevisionReference): Promise<ChatRevision | undefined>
}

/** Historical placement is a read-only target; unresolved/missing results must not highlight. */
export interface AnchorNavigationPort {
  open(anchor: ChatAnchor, resolution: ChatAnchorResolution): Promise<void>
}
