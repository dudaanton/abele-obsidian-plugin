/**
 * Finding which URL a click in a note landed on.
 *
 * Reading view and rendered markdown elsewhere (chats, the GitHub views themselves) put a real
 * `<a href>` on screen, so the address is on the element. Live Preview does not: a markdown link
 * is drawn as styled text with its URL hidden, and a bare URL is a styled span. There the
 * position under the pointer is mapped back into the editor's text, and the URL is read out of
 * that line.
 */
import { EditorView } from '@codemirror/view'
import { Keymap, type PaneType } from 'obsidian'

/** `[text](url)`, `[text](<url> "title")`, `<url>`, and a bare `http(s)://…`. */
const LINK_PATTERNS: RegExp[] = [
  /\[(?:[^\]\\]|\\.)*\]\(\s*<([^>]+)>[^)]*\)/g,
  /\[(?:[^\]\\]|\\.)*\]\(\s*(https?:\/\/[^\s)]+)[^)]*\)/g,
  /<(https?:\/\/[^>\s]+)>/g,
  /(https?:\/\/[^\s<>()[\]]+[^\s<>()[\].,;:!?'"])/g,
]

/** The URL of the link that covers `offset` in `text`, or null. */
export function urlInLine(text: string, offset: number): string | null {
  for (const pattern of LINK_PATTERNS) {
    pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text))) {
      const from = m.index
      const to = from + m[0].length
      if (offset >= from && offset <= to) return m[1]
    }
  }
  return null
}

const isWebUrl = (href: string | null): href is string => !!href && /^https?:\/\//i.test(href)

/** The EditorView a DOM node belongs to, if it is inside one. */
function editorOf(el: Element): EditorView | null {
  const root = el.closest('.cm-editor')
  if (!root) return null
  try {
    return EditorView.findFromDOM(root as HTMLElement)
  } catch {
    return null
  }
}

export interface ClickedLink {
  url: string
  /** Inside an editor in source mode, where a plain click only moves the cursor. */
  sourceMode: boolean
}

/** What was clicked, when it was a web link; null for anything else. */
export function linkAtClick(target: EventTarget | null): ClickedLink | null {
  if (!(target instanceof Element)) return null

  const anchor = target.closest('a[href]')
  if (anchor) {
    const href = anchor.getAttribute('href')
    return isWebUrl(href) ? { url: href, sourceMode: false } : null
  }

  // Only the link's own styling counts: a click elsewhere on a line that happens to hold a URL
  // is someone placing the cursor.
  const styled = target.closest('.cm-url, .cm-link, .cm-hmd-barelink')
  if (!styled) return null
  const view = editorOf(styled)
  if (!view) return null

  let pos: number
  try {
    pos = view.posAtDOM(target)
  } catch {
    return null
  }
  const line = view.state.doc.lineAt(pos)
  const url = urlInLine(line.text, pos - line.from)
  if (!isWebUrl(url)) return null

  const livePreview = !!view.dom.closest('.is-live-preview')
  // Live Preview opens a link only from its underlined text, as Obsidian itself decides; the
  // brackets and the revealed URL around it are for editing.
  if (livePreview && !target.closest('.cm-underline')) return null
  return { url, sourceMode: !livePreview }
}

/** The GitHub-looking link under the cursor of an editor, for the command. */
export function urlAtCursor(view: EditorView): string | null {
  const pos = view.state.selection.main.head
  const line = view.state.doc.lineAt(pos)
  const url = urlInLine(line.text, pos - line.from)
  return isWebUrl(url) ? url : null
}

/**
 * What a click on a link asks for: `false` to open it the plain way (reusing a GitHub tab), a pane
 * type to open it in a new tab, split or window, or `null` to leave it alone.
 *
 * Mod-click follows Obsidian: `Keymap.isModEvent` says tab, split (Mod+Alt) or window
 * (Mod+Alt+Shift). Alt without Mod is the way through to the browser. In source mode a plain click
 * only places the cursor and Mod-click is how any link opens, so there Mod alone is the plain open
 * and Mod+Shift asks for the new tab.
 */
export function paneForClick(evt: MouseEvent, sourceMode: boolean): PaneType | false | null {
  const mod = Keymap.isModEvent(evt)
  const pane: PaneType | false = mod === true ? 'tab' : mod
  if (sourceMode) {
    if (!pane) return null
    if (pane === 'tab') return evt.shiftKey ? 'tab' : false
    return pane
  }
  if (evt.altKey && !pane) return null
  return pane
}
