import { t } from '@/i18n'
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
import { StateEffect, StateField, type Extension, type Text } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { Menu } from 'obsidian'
import { importedPaths } from './imports'
import { isIdentifier } from './definitions'
import { lspFor, lspNavigation } from '@/node/lspContext'
import { lspHoverMenuLabel } from '@/node/lspMenu'
import { beginCodeSurface } from './codeSurface'

export interface CodeNav {
  /** Follow a relative module string using the repository tree. */
  openImport?(specifier: string, fromPath: string): void | Promise<void>
  /** The path of the file a viewer inside the tab shows. */
  pathOf(viewerEl: HTMLElement): string
  goToDefinition(
    name: string,
    fromPath: string,
    position?: { line: number; character: number }
  ): void | Promise<void>
  findReferences(name: string, position?: { line: number; character: number }): void
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
  return lspNavigation(el, root ? (navs.get(root) ?? null) : null)
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

const isMod = (e: MouseEvent, view: EditorView) =>
  e.metaKey || e.ctrlKey || (e.altKey && !!lspFor(view.dom)?.document.supported)

const importCache = new WeakMap<Text, ReturnType<typeof importedPaths>>()
function pathsIn(view: EditorView) {
  const doc = view.state.doc
  let paths = importCache.get(doc)
  if (!paths) {
    paths = importedPaths(doc.toString())
    importCache.set(doc, paths)
  }
  return paths
}

function importAt(view: EditorView, pos: number) {
  return pathsIn(view).find((path) => pos >= path.from && pos < path.to) ?? null
}

function importUnder(view: EditorView, e: MouseEvent) {
  if (!(e.target instanceof Node) || !view.contentDOM.contains(e.target)) return null
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false)
  return pos === null ? null : importAt(view, pos)
}

function menuTarget(view: EditorView, pos: number) {
  const word = wordAt(view, pos)
  if (word) return word
  if (!navFor(view.dom)?.openImport) return null
  const line = view.state.doc.lineAt(pos)
  const paths = pathsIn(view).filter((path) => path.from >= line.from && path.to <= line.to)
  return paths.length === 1 ? paths[0] : null
}

function menuUnder(view: EditorView, e: MouseEvent) {
  if (!(e.target instanceof Node) || !view.contentDOM.contains(e.target)) return null
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false)
  return pos === null ? null : menuTarget(view, pos)
}

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
function positionAt(view: EditorView, offset: number) {
  const line = view.state.doc.lineAt(offset)
  return { line: line.number - 1, character: offset - line.from }
}
function definition(nav: CodeNav, view: EditorView, name: string, offset: number) {
  if (!lspFor(view.dom)?.document.supported) beginCodeSurface(view.dom.ownerDocument, () => {})
  return lspFor(view.dom)?.document.supported
    ? nav.goToDefinition(name, nav.pathOf(view.dom), positionAt(view, offset))
    : nav.goToDefinition(name, nav.pathOf(view.dom))
}
function references(nav: CodeNav, view: EditorView, name: string, offset: number) {
  if (lspFor(view.dom)?.document.supported) nav.findReferences(name, positionAt(view, offset))
  else {
    beginCodeSurface(view.dom.ownerDocument, () => {})
    nav.findReferences(name)
  }
}
function navMenu(nav: CodeNav, view: EditorView, name: string, offset: number): Menu {
  const menu = new Menu()
  const line = view.state.doc.lineAt(offset)
  const paths = nav.openImport
    ? pathsIn(view).filter((path) => path.from >= line.from && path.to <= line.to)
    : []
  if (nav.openImport && paths.length === 1) {
    menu.addItem((item) =>
      item
        .setTitle(t('repository.openImport'))
        .setIcon('file-code')
        .onClick(() => {
          void nav.openImport?.(paths[0].text, nav.pathOf(view.dom))
        })
    )
  }
  menu.addItem((item) =>
    item
      .setTitle(t('streamB.goToDefinitionOf.14ff5d', { v0: String(name) }))
      .setIcon('locate')
      .onClick((): void => void definition(nav, view, name, offset))
  )
  menu.addItem((item) =>
    item
      .setTitle(
        lspFor(view.dom)?.document.supported
          ? t('node.lsp.references', { name })
          : t('debug.referencesTextFallback', { name })
      )
      .setIcon('search')
      .onClick(() => references(nav, view, name, offset))
  )
  const selected = selectedIn(view)
  menu.addItem((item) =>
    item
      .setTitle(
        selected ? t('streamB.copy.e21f93') : t('streamB.copy.759008', { v0: String(name) })
      )
      .setIcon('copy')
      .onClick((): void => void navigator.clipboard.writeText(selected || name))
  )
  return menu
}

function showNavMenu(
  nav: CodeNav,
  view: EditorView,
  name: string,
  offset: number,
  show: (menu: Menu) => void
) {
  let shown: Menu | undefined
  const current = beginCodeSurface(view.dom.ownerDocument, () => shown?.hide())
  const display = (menu: Menu) => {
    if (!current()) return
    shown = menu
    show(menu)
  }
  const context = lspFor(view.dom)
  if (!context?.document.supported) {
    display(navMenu(nav, view, name, offset))
    return
  }
  const text = view.state.doc
  const raw = positionAt(view, offset)
  const position = context.mapPosition ? context.mapPosition(raw) : raw
  if (!position) {
    display(navMenu(nav, view, name, offset))
    return
  }
  void context.document
    .hover(position, context.text?.() ?? view.state.doc.toString())
    .then((message) => {
      if (
        !current() ||
        !view.dom.isConnected ||
        lspFor(view.dom) !== context ||
        view.state.doc !== text
      )
        return
      const menu = navMenu(nav, view, name, offset)
      if (message) {
        menu.setUseNativeMenu(false)
        menu.addSeparator()
        menu.addItem((item) =>
          item.setTitle(lspHoverMenuLabel(view.dom.ownerDocument, message)).setDisabled(true)
        )
      }
      display(menu)
    })
}

/** What every GitHub code viewer carries; inert outside a tab that provides navigation. */
export function codeNavAddon(): Extension {
  const navigated = new WeakSet<EditorView>()
  return [
    linkField,
    EditorView.domEventHandlers({
      keydown(e, view) {
        if (e.key !== 'F12' || !e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false
        const nav = navFor(view.dom)
        const word = nav && wordAt(view, view.state.selection.main.head)
        if (!nav || !word) return false
        e.preventDefault()
        e.stopPropagation()
        references(nav, view, word.text, word.from)
        return true
      },
      mousedown(e, view) {
        navigated.delete(view)
        if (e.button !== 0) return false
        const nav = navFor(view.dom)
        const imported =
          nav?.openImport && (e.ctrlKey || e.metaKey || e.altKey) ? importUnder(view, e) : null
        if (nav?.openImport && imported) {
          e.preventDefault()
          navigated.add(view)
          clearLink(view)
          void nav.openImport(imported.text, nav.pathOf(view.dom))
          return true
        }
        if (!isMod(e, view)) return false
        const word = nav && wordUnder(view, e)
        if (!nav || !word) return false
        e.preventDefault()
        navigated.add(view)
        clearLink(view)
        void definition(nav, view, word.text, word.from)
        return true
      },
      mousemove(e, view) {
        const nav = navFor(view.dom)
        const imported =
          nav?.openImport && (e.ctrlKey || e.metaKey || e.altKey) ? importUnder(view, e) : null
        const word = imported ?? (isMod(e, view) && nav ? wordUnder(view, e) : null)
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
        // A modifier-left-click can also emit a native contextmenu on macOS.
        if (navigated.has(view) && (e.ctrlKey || e.metaKey || e.altKey)) {
          navigated.delete(view)
          e.preventDefault()
          return true
        }
        // The long press already opened the menu; the phone's own menu event after it is the same ask.
        if (justPressed()) {
          e.preventDefault()
          return true
        }
        const nav = navFor(view.dom)
        const word = nav && menuUnder(view, e)
        if (!nav || !word) return false
        e.preventDefault()
        showNavMenu(nav, view, word.text, word.from, (menu) => menu.showAtMouseEvent(e))
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
          const word = nav && pos !== null ? menuTarget(view, pos) : null
          if (!nav || !word) return
          longPressAt = Date.now()
          // The phone may have begun selecting the word under the finger: the menu is the answer.
          if (selectedIn(view)) view.dom.ownerDocument.getSelection()?.removeAllRanges()
          showNavMenu(nav, view, word.text, word.from, (menu) =>
            menu.showAtPosition(start, view.dom.ownerDocument)
          )
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
