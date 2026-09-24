/**
 * Go to definition in a GitHub code viewer, the way an editor does it: Mod-click on a name jumps
 * to where it is declared, and holding Mod while pointing underlines the name that would be
 * followed. The context menu offers the same, and "Find references" beside it.
 *
 * The viewer does not know which repository or commit it shows; the tab does. A tab registers
 * what it knows with `provideCodeNav`, and the viewer finds it from its own element. A viewer in
 * a note — a snippet card — finds none and stays plain.
 */
import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { Menu } from 'obsidian'
import { isIdentifier } from './definitions'

export interface CodeNav {
  /** The path of the file a viewer inside the tab shows. */
  pathOf(viewerEl: HTMLElement): string
  goToDefinition(name: string, fromPath: string): void | Promise<void>
  findReferences(name: string): void
}

const navs = new WeakMap<Element, CodeNav>()

/** Makes a tab's code viewers navigable. Returns what undoes it. */
export function provideCodeNav(root: HTMLElement, nav: CodeNav): () => void {
  navs.set(root, nav)
  root.classList.add(NAV_ROOT)
  return () => {
    if (navs.get(root) === nav) navs.delete(root)
    root.classList.remove(NAV_ROOT)
  }
}

const NAV_ROOT = 'abele-code-nav'

export function navFor(el: Element): CodeNav | null {
  const root = el.closest(`.${NAV_ROOT}`)
  return root ? (navs.get(root) ?? null) : null
}

/** The identifier around a position in a viewer, or null where there is none. */
export function wordAt(
  view: EditorView,
  pos: number
): { from: number; to: number; text: string } | null {
  const line = view.state.doc.lineAt(pos)
  const text = line.text
  let start = pos - line.from
  let end = start
  const part = /[\w$]/
  while (start > 0 && part.test(text[start - 1])) start--
  while (end < text.length && part.test(text[end])) end++
  const word = text.slice(start, end)
  if (!word || !isIdentifier(word)) return null
  return { from: line.from + start, to: line.from + end, text: word }
}

const setLink = StateEffect.define<{ from: number; to: number } | null>()
const linkMark = Decoration.mark({ class: 'abele-github-code__definition' })

const linkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setLink))
        return e.value
          ? Decoration.set([linkMark.range(e.value.from, e.value.to)])
          : Decoration.none
    }
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

const isMod = (e: MouseEvent) => e.metaKey || e.ctrlKey

function wordUnder(view: EditorView, e: MouseEvent) {
  if (!(e.target instanceof Node) || !view.contentDOM.contains(e.target)) return null
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false)
  return pos === null ? null : wordAt(view, pos)
}

const clearLink = (view: EditorView) => {
  if (view.state.field(linkField).size) view.dispatch({ effects: setLink.of(null) })
}

/** What every GitHub code viewer carries; inert outside a tab that provides navigation. */
export function codeNavAddon(): Extension {
  return [
    linkField,
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (!isMod(e) || e.button !== 0) return false
        const nav = navFor(view.dom)
        const word = nav && wordUnder(view, e)
        if (!nav || !word) return false
        e.preventDefault()
        clearLink(view)
        void nav.goToDefinition(word.text, nav.pathOf(view.dom))
        return true
      },
      mousemove(e, view) {
        const word = isMod(e) && navFor(view.dom) ? wordUnder(view, e) : null
        const now = view.state.field(linkField)
        let same = false
        now.between(0, view.state.doc.length, (from, to) => {
          same = !!word && from === word.from && to === word.to
        })
        if (word && !same) view.dispatch({ effects: setLink.of(word) })
        else if (!word) clearLink(view)
        return false
      },
      mouseleave(_e, view) {
        clearLink(view)
        return false
      },
      contextmenu(e, view) {
        const nav = navFor(view.dom)
        const word = nav && wordUnder(view, e)
        if (!nav || !word) return false
        e.preventDefault()
        const menu = new Menu()
        menu.addItem((item) =>
          item
            .setTitle(`Go to definition of ${word.text}`)
            .setIcon('locate')
            .onClick((): void => void nav.goToDefinition(word.text, nav.pathOf(view.dom)))
        )
        menu.addItem((item) =>
          item
            .setTitle(`Find references to ${word.text}`)
            .setIcon('search')
            .onClick(() => nav.findReferences(word.text))
        )
        menu.showAtMouseEvent(e)
        return true
      },
    }),
  ]
}
