import type {
  AnchorPlacement,
  ChatRevision,
  PlacementMappingResult,
  RenderedRange,
  RevisionMapping,
  RevisionPorts,
  RevisionReference,
} from './types'

export function sameRevision(a: RevisionReference, b: RevisionReference): boolean {
  return a.chatId === b.chatId && a.messageId === b.messageId && a.revisionId === b.revisionId
}

/** Runtime validation is also used for metadata loaded by later storage adapters. */
export function validRenderedRange(text: string, range: RenderedRange): boolean {
  const boundary = (at: number) => {
    const before = text.charCodeAt(at - 1)
    const after = text.charCodeAt(at)
    return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff)
  }
  return (
    range.space === 'rendered' &&
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    range.start >= 0 &&
    range.start <= range.end &&
    range.end <= text.length &&
    boundary(range.start) &&
    boundary(range.end)
  )
}

export function validPlacement(
  placement: AnchorPlacement,
  quote: string,
  revision: ChatRevision
): boolean {
  return (
    sameRevision(placement.revision, revision.reference) &&
    placement.projectionVersion === revision.projection.version &&
    quote.length > 0 &&
    validRenderedRange(revision.projection.text, placement.range) &&
    revision.projection.text.slice(placement.range.start, placement.range.end) === quote
  )
}

/** Allocate, copy and freeze; identity never comes from a content hash. */
export function createChatRevision(
  input: { readonly chatId: string; readonly messageId: string; readonly content: string },
  ports: RevisionPorts
): ChatRevision {
  const revisionId = ports.nextId()
  const projection = ports.project(input.content)
  if (!input.chatId || !input.messageId || !revisionId || !projection.version)
    throw new Error('Revision and projection identities must not be empty')
  return Object.freeze({
    reference: Object.freeze({ chatId: input.chatId, messageId: input.messageId, revisionId }),
    content: input.content,
    projection: Object.freeze({ version: projection.version, text: projection.text }),
  })
}

/**
 * Translate only with exact edit provenance. Equal text, nearby occurrences and context are
 * not proofs. Renderer changes require explicit recapture, not old offsets in new semantics.
 * Insertions at start belong before the selection; insertions at end belong after it.
 */
export function mapPlacement(
  placement: AnchorPlacement,
  quote: string,
  from: ChatRevision,
  to: ChatRevision,
  mapping?: RevisionMapping
): PlacementMappingResult {
  const invalid = (reason: Extract<PlacementMappingResult, { status: 'invalid' }>['reason']) =>
    ({ status: 'invalid', reason }) as const
  if (
    from.reference.chatId !== to.reference.chatId ||
    from.reference.messageId !== to.reference.messageId ||
    sameRevision(from.reference, to.reference) ||
    !sameRevision(placement.revision, from.reference) ||
    (mapping &&
      (!sameRevision(mapping.from, from.reference) || !sameRevision(mapping.to, to.reference)))
  )
    return invalid('identity')
  if (
    placement.projectionVersion !== from.projection.version ||
    from.projection.version !== to.projection.version
  )
    return invalid('projection-version')
  if (!validPlacement(placement, quote, from)) return invalid('range')
  if (!mapping || mapping.kind === 'ambiguous') return { status: 'ambiguous' }
  if (mapping.projectionVersion !== from.projection.version) return invalid('projection-version')

  let cursor = 0
  let rendered = ''
  let shift = 0
  let intersects = false
  let previous: RenderedRange | undefined
  for (const edit of mapping.edits) {
    const { start, end } = edit.range
    if (!validRenderedRange(from.projection.text, edit.range)) return invalid('range')
    // Multiple operations at the same point have ambiguous order/ownership, even if replayable.
    if (previous && (start < previous.end || start === previous.start))
      return { status: 'ambiguous' }
    rendered += from.projection.text.slice(cursor, start) + edit.text
    cursor = end
    previous = edit.range
    const insertion = start === end
    if (
      insertion
        ? start > placement.range.start && start < placement.range.end
        : start < placement.range.end && end > placement.range.start
    )
      intersects = true
    if (end <= placement.range.start) shift += edit.text.length - (end - start)
  }
  rendered += from.projection.text.slice(cursor)
  if (rendered !== to.projection.text) return invalid('replay')
  if (intersects) return { status: 'intersecting' }
  const translated: AnchorPlacement = Object.freeze({
    revision: Object.freeze({ ...to.reference }),
    projectionVersion: to.projection.version,
    range: Object.freeze({
      space: 'rendered',
      start: placement.range.start + shift,
      end: placement.range.end + shift,
    }),
  })
  if (!validPlacement(translated, quote, to)) return invalid('range')
  return { status: 'mapped', placement: translated }
}
