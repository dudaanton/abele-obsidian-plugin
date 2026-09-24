/**
 * Find-in-tab's marks inside a CodeMirror viewer: every match, and the current one set apart.
 * Installed in every GitHub code viewer through `viewerAddons`, inert until a search sets it.
 */
import { StateEffect, StateField, type Range } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

export interface FindMarks {
  ranges: Array<[number, number]>
  /** Index into `ranges`; -1 when the current match is elsewhere in the tab. */
  current: number
}

export const setFindMarks = StateEffect.define<FindMarks>()

const match = Decoration.mark({ class: 'abele-github-find__match' })
const current = Decoration.mark({
  class: 'abele-github-find__match abele-github-find__match_current',
})

function build(marks: FindMarks, length: number): DecorationSet {
  const out: Range<Decoration>[] = []
  marks.ranges.forEach(([from, to], i) => {
    if (from >= to || to > length) return
    out.push((i === marks.current ? current : match).range(from, to))
  })
  return Decoration.set(out, true)
}

export const findMarksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    for (const e of tr.effects) if (e.is(setFindMarks)) return build(e.value, tr.state.doc.length)
    return marks.map(tr.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

/** Sets the marks in a viewer, installing the field first if the viewer was made without it. */
export function markFind(view: EditorView, marks: FindMarks): void {
  if (view.state.field(findMarksField, false) === undefined) {
    view.dispatch({ effects: StateEffect.appendConfig.of(findMarksField) })
  }
  view.dispatch({ effects: setFindMarks.of(marks) })
}
