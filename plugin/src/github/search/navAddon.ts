/**
 * Go to definition in a GitHub code viewer, the way an editor does it: Mod-click on a name jumps
 * to where it is declared, and holding Mod while pointing underlines the name that would be
 * followed. The context menu offers the same, and "Find references" beside it.
 *
 * On a phone the long press shares its finger with the phone's own text selection. On a name it
 * opens this menu, and the selection the press started is dropped — the menu offers to copy the
 * name instead. Anywhere else in the code, and everywhere outside it, the press selects text as
 * the phone always does.
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

/** How long a finger rests on a name before its menu opens: a phone has no right click. */
const LONG_PRESS_MS = 500

/** The press being timed, and when a long press last opened the menu. */
let pressing: { start: { x: number; y: number }; cancel: () => void } | null = null
let longPressAt = 0

const cancelPress = () => {
  pressing?.cancel()
  pressing = null
}

/** Whether the long press opened the menu a moment ago: what follows it is the same press. */
const justPressed = () => Date.now() - longPressAt < 1000

/** The text selected inside the viewer; empty when there is none, or it lies elsewhere. */
function selectedIn(view: EditorView): string {
  const selection = view.dom.ownerDocument.getSelection()
  if (!selection || selection.isCollapsed || !view.dom.contains(selection.anchorNode)) return ''
  return selection.toString()
}

/** "Go to definition", "Find references" and a copy — of the selection, or else of the name. */
function navMenu(nav: CodeNav, view: EditorView, name: string): Menu {
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle(`Go to definition of ${name}`)
      .setIcon('locate')
      .onClick((): void => void nav.goToDefinition(name, nav.pathOf(view.dom)))
  )
  menu.addItem((item) =>
    item
      .setTitle(`Find references to ${name}`)
      .setIcon('search')
      .onClick(() => nav.findReferences(name))
  )
  const selected = selectedIn(view)
  menu.addItem((item) =>
    item
      .setTitle(selected ? 'Copy' : `Copy ${name}`)
      .setIcon('copy')
      .onClick((): void => void navigator.clipboard.writeText(selected || name))
  )
  return menu
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
        // The long press already opened the menu; the phone's own menu event after it is the same ask.
        if (justPressed()) {
          e.preventDefault()
          return true
        }
        const nav = navFor(view.dom)
        const word = nav && wordUnder(view, e)
        if (!nav || !word) return false
        e.preventDefault()
        navMenu(nav, view, word.text).showAtMouseEvent(e)
        return true
      },
      touchstart(e, view) {
        cancelPress()
        const touch = e.touches[0]
        if (e.touches.length !== 1 || !touch || !navFor(view.dom)) return false
        const start = { x: touch.clientX, y: touch.clientY }
        const win = view.dom.ownerDocument.defaultView ?? window
        const timer = win.setTimeout(() => {
          pressing = null
          const nav = navFor(view.dom)
          const pos = view.posAtCoords(start, false)
          const word = nav && pos !== null ? wordAt(view, pos) : null
          if (!nav || !word) return
          longPressAt = Date.now()
          // The phone may have begun selecting the word under the finger: the menu is the answer.
          if (selectedIn(view)) view.dom.ownerDocument.getSelection()?.removeAllRanges()
          navMenu(nav, view, word.text).showAtPosition(start, view.dom.ownerDocument)
        }, LONG_PRESS_MS)
        pressing = { start, cancel: () => win.clearTimeout(timer) }
        return false
      },
      selectstart(e) {
        if (!justPressed()) return false
        e.preventDefault()
        return true
      },
      touchmove(e) {
        const touch = e.touches[0]
        if (!pressing || !touch) return false
        const moved = Math.hypot(touch.clientX - pressing.start.x, touch.clientY - pressing.start.y)
        if (moved > 10) cancelPress()
        return false
      },
      touchend() {
        cancelPress()
        return false
      },
      touchcancel() {
        cancelPress()
        return false
      },
    }),
  ]
}
