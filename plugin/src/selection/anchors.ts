import { mapPlacement, sameRevision, validPlacement, validRenderedRange } from './revisionMapping'
import type {
  AnchorPlacement,
  BookSelectionSnapshot,
  ChatAnchor,
  ChatAnchorResolution,
  ChatRevision,
  ChatSelectionSnapshot,
  ChatSelectionSource,
  PlacementMappingResult,
  RenderedRange,
  RevisionMapping,
  RevisionReference,
} from './types'

function freezeChatSnapshot(snapshot: ChatSelectionSnapshot): ChatSelectionSnapshot {
  return Object.freeze({
    ...snapshot,
    source: Object.freeze({
      ...snapshot.source,
      range: Object.freeze({ ...snapshot.source.range }),
      context: Object.freeze({ ...snapshot.source.context }),
    }),
  })
}

export function captureBookSelection(input: BookSelectionSnapshot): BookSelectionSnapshot {
  return Object.freeze({ ...input, source: Object.freeze({ ...input.source }) })
}

/** Capture once before any menu, form or asynchronous work; context is display-only. */
export function captureChatSelection(input: {
  readonly revision: ChatRevision
  readonly range: RenderedRange
  readonly sentence: string
  readonly title: string
  readonly pathHint: string
  readonly role: ChatSelectionSource['role']
  readonly author: string
}): ChatSelectionSnapshot {
  const { revision, range } = input
  const rendered = revision.projection.text
  if (!validRenderedRange(rendered, range) || range.start === range.end)
    throw new Error('Selection must be a non-empty exact rendered range')
  const text = rendered.slice(range.start, range.end)
  let contextStart = Math.max(0, range.start - 32)
  let contextEnd = Math.min(rendered.length, range.end + 32)
  if (!validRenderedRange(rendered, { space: 'rendered', start: contextStart, end: range.start }))
    contextStart++
  if (!validRenderedRange(rendered, { space: 'rendered', start: range.end, end: contextEnd }))
    contextEnd--
  return freezeChatSnapshot({
    text,
    sentence: input.sentence,
    title: input.title,
    pathHint: input.pathHint,
    source: {
      kind: 'chat',
      ...revision.reference,
      role: input.role,
      author: input.author,
      quote: text,
      range,
      projectionVersion: revision.projection.version,
      context: {
        before: rendered.slice(contextStart, range.start),
        after: rendered.slice(range.end, contextEnd),
      },
    },
  })
}

export function createChatAnchor(
  snapshot: ChatSelectionSnapshot,
  revision: ChatRevision,
  nextId: () => string
): ChatAnchor {
  const placement: AnchorPlacement = Object.freeze({
    revision: Object.freeze({ ...revision.reference }),
    projectionVersion: snapshot.source.projectionVersion,
    range: Object.freeze({ ...snapshot.source.range }),
  })
  if (
    !sameRevision(snapshot.source, revision.reference) ||
    snapshot.text !== snapshot.source.quote ||
    !validPlacement(placement, snapshot.text, revision)
  )
    throw new Error('The captured selection revision changed')
  const id = nextId()
  if (!id) throw new Error('Anchor identity must not be empty')
  return Object.freeze({
    id,
    original: placement.revision,
    snapshot: freezeChatSnapshot(snapshot),
    placements: Object.freeze([placement]),
  })
}

const samePlacement = (a: AnchorPlacement, b: AnchorPlacement) =>
  sameRevision(a.revision, b.revision) &&
  a.projectionVersion === b.projectionVersion &&
  a.range.space === b.range.space &&
  a.range.start === b.range.start &&
  a.range.end === b.range.end

function matchesCapture(anchor: ChatAnchor, placement: AnchorPlacement): boolean {
  return (
    !sameRevision(placement.revision, anchor.original) ||
    samePlacement(placement, {
      revision: anchor.snapshot.source,
      projectionVersion: anchor.snapshot.source.projectionVersion,
      range: anchor.snapshot.source.range,
    })
  )
}

/** Failed or intersecting mappings leave the original anchor object entirely untouched. */
export function advanceChatAnchor(
  anchor: ChatAnchor,
  from: ChatRevision,
  to: ChatRevision,
  mapping?: RevisionMapping
): PlacementMappingResult & { readonly anchor: ChatAnchor } {
  const placements = anchor.placements.filter((p) => sameRevision(p.revision, from.reference))
  if (placements.length > 1) return { status: 'ambiguous', anchor }
  if (!placements.length || !matchesCapture(anchor, placements[0]))
    return { status: 'invalid', reason: 'range', anchor }
  const result = mapPlacement(placements[0], anchor.snapshot.text, from, to, mapping)
  if (result.status !== 'mapped') return { ...result, anchor }
  const existing = anchor.placements.filter((p) => sameRevision(p.revision, to.reference))
  if (existing.length > 1 || (existing.length && !samePlacement(existing[0], result.placement)))
    return { status: 'ambiguous', anchor }
  return {
    ...result,
    anchor: existing.length
      ? anchor
      : Object.freeze({
          ...anchor,
          placements: Object.freeze([...anchor.placements, result.placement]),
        }),
  }
}

/**
 * The adapter first chooses a branch containing this message, then supplies its current version.
 * A shared ancestor keeps its message identity on every descendant. Replacement messages do
 * not inherit anchors, even when their content is equal. Undo supplies the restored version ID;
 * restoring equal bytes as a new version is not an undo identity proof.
 */
export function resolveChatAnchor(
  anchor: ChatAnchor | undefined,
  current: RevisionReference | undefined,
  revisions: readonly ChatRevision[]
): ChatAnchorResolution {
  if (!anchor) return { status: 'missing', reason: 'anchor' }
  if (!current) return { status: 'missing', reason: 'message' }
  if (current.chatId !== anchor.original.chatId) return { status: 'missing', reason: 'chat' }
  if (current.messageId !== anchor.original.messageId)
    return { status: 'missing', reason: 'message' }
  const unresolved = { status: 'unresolved', snapshot: anchor.snapshot } as const
  if (
    !sameRevision(anchor.original, anchor.snapshot.source) ||
    anchor.snapshot.text !== anchor.snapshot.source.quote
  )
    return unresolved

  const at = (
    reference: RevisionReference,
    status: 'current' | 'historical'
  ): ChatAnchorResolution | undefined => {
    const sources = revisions.filter((r) => sameRevision(r.reference, reference))
    if (sources.length > 1) return { status: 'ambiguous', reason: 'revision' }
    const placements = anchor.placements.filter((p) => sameRevision(p.revision, reference))
    if (placements.length > 1) return { status: 'ambiguous', reason: 'placement' }
    if (
      sources.length &&
      placements.length &&
      matchesCapture(anchor, placements[0]) &&
      validPlacement(placements[0], anchor.snapshot.text, sources[0])
    )
      return { status, revision: sources[0], placement: placements[0] }
  }
  return at(current, 'current') ?? at(anchor.original, 'historical') ?? unresolved
}
