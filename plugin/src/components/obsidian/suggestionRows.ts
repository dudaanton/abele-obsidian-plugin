import { h, render, type VNode } from 'vue'
import SuggestionRow from './SuggestionRow.vue'
import { unrenderKit } from './mount'

/** What stands at the end of a picker row: a hotkey, a word in a flair, a dot with a tooltip. */
export type SuggestionAux =
  | { kbd: string }
  | { flair: string; cls?: string }
  | { dot: string; cls?: string }

export interface SuggestionRowProps {
  icon?: string
  swatch?: string
  title: string
  note?: string
  keepNote?: boolean
  titleClass?: string
  noteClass?: string
  aux?: SuggestionAux[]
}

/**
 * The rows a picker has drawn, for one picker. `draw` renders the kit's `SuggestionRow` into the
 * element `renderSuggestion` was handed, synchronously, as Obsidian expects; `clear` takes them
 * all out, from the picker's `onClose`.
 *
 * Obsidian empties its list and asks for every row again on each keystroke. Rows it dropped are
 * taken out on the next draw, by being no longer in the list the new row stands in, so a picker
 * needs no hook of its own before the redraw — and a list waiting on a slow search keeps its
 * rows on screen meanwhile.
 */
export class SuggestionRows {
  private readonly drawn = new Set<HTMLElement>()

  draw(el: HTMLElement, props: SuggestionRowProps, aux?: () => VNode | VNode[]): void {
    const list = el.parentElement
    if (list)
      for (const old of this.drawn)
        if (old !== el && old.parentElement !== list) {
          unrenderKit(old)
          this.drawn.delete(old)
        }
    // A row drawn again starts afresh: the row sets its icon once, when it mounts.
    if (this.drawn.has(el)) unrenderKit(el)
    el.addClass('mod-complex')
    render(h(SuggestionRow, props, aux ? { aux } : undefined), el)
    this.drawn.add(el)
  }

  clear(): void {
    for (const el of this.drawn) unrenderKit(el)
    this.drawn.clear()
  }
}
