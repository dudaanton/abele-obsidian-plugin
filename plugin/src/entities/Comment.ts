/**
 * One entry per marker — not per comment. A marker can carry several ids, and they share one
 * card, so the card is the thing that gets a teleport handle.
 *
 * `markerFrom` is where the marker stood when this entry was made. The entry deliberately
 * survives an edit earlier in the note, because recreating it would tear the card down and
 * take the half-typed question in it with it; the live position travels to the margin overlay
 * instead. Anything that needs to *edit* at the marker must re-parse the document for it.
 */
export class CommentEntry {
  public readonly id: string
  public readonly ids: string[]
  public readonly notePath: string
  public readonly markerFrom: number

  constructor(data: { id: string; ids: string[]; notePath: string; markerFrom: number }) {
    this.id = data.id
    this.ids = data.ids
    this.notePath = data.notePath
    this.markerFrom = data.markerFrom
  }

  cleanup() {}
}

/**
 * One pinned message, kept at the top of the note's margin until it is unpinned.
 *
 * `markerFrom` is mutable here and readonly on `CommentEntry`, and the difference is the
 * point of the feature: a card sits beside its marker, so a stale offset is only ever a
 * frame behind, while a pin is deliberately nowhere near the marker it leads back to. A
 * press on it scrolls to `markerFrom`, so the provider that owns the entity refreshes it on
 * the same pass that refreshes the entry's `anchorPos`.
 */
export class CommentPin {
  public readonly id: string
  public readonly commentId: string
  public readonly messageId: string
  public readonly notePath: string
  public markerFrom: number

  constructor(data: {
    id: string
    commentId: string
    messageId: string
    notePath: string
    markerFrom: number
  }) {
    this.id = data.id
    this.commentId = data.commentId
    this.messageId = data.messageId
    this.notePath = data.notePath
    this.markerFrom = data.markerFrom
  }

  cleanup() {}
}
