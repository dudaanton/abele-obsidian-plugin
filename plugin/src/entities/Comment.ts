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
