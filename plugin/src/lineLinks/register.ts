/**
 * Links to lines of a note, wired into Obsidian: the click on one in a note, its hover preview,
 * and the way a person makes one — "Copy link to lines" on the editor's menu and as a command.
 *
 * Clicks on links in the plugin's own rendered markdown (chat messages above all) are not taken
 * here: `Markdown.vue` handles them through `openLink`, which knows the lines too. Their hover
 * preview is.
 */
import {
  Keymap,
  MarkdownView,
  Notice,
  Platform,
  type App,
  type Editor,
  type HoverParent,
  type PaneType,
  type Plugin,
  type TFile,
} from 'obsidian'
import { EditorView } from '@codemirror/view'
import { openNoteAtLines, resolveLineLink } from './open'
import { internalLinkInLine, lineSubpath, type LineRange } from './parse'

/** Where a click is taken as a click on a note's link: notes, and the previews that hover over them. */
const NOTE_SURFACES = '.workspace-leaf-content, .hover-popover, .markdown-rendered'

/** Rendered by the plugin's own component, which opens its links itself. */
const OWN_MARKDOWN = '.abele-markdown'

/**
 * Obsidian opens a link on `click`, except on Android, where it answers the `mousedown` before
 * it — taking the click there would be too late. Mirrors Obsidian's own editor.
 */
const OPENING_EVENT: 'click' | 'mousedown' = Platform.isAndroidApp ? 'mousedown' : 'click'

export interface ClickedNoteLink {
  /** The link's target as written: `Folder/Note#L10-L12`. */
  href: string
  /** Inside an editor in source mode, where a plain click only moves the cursor. */
  sourceMode: boolean
  /** Inside an editor at all, Live Preview included, rather than rendered markdown. */
  inEditor: boolean
}

/**
 * What a click on a link asks for, the way Obsidian reads it: `false` for the leaf a plain click
 * reuses, a pane type for Mod-click (`Keymap.isModEvent`: tab, split, window), null to leave the
 * click alone. A middle click is a new tab. In source mode a plain click only places the cursor;
 * there Mod opens the link where a plain click would elsewhere, and Mod+Shift asks for the tab.
 */
export function paneForClick(evt: MouseEvent, sourceMode: boolean): PaneType | false | null {
  const mod = Keymap.isModEvent(evt)
  const pane: PaneType | false = mod === true ? 'tab' : mod
  if (sourceMode && evt.button !== 1) {
    if (!pane) return null
    if (pane === 'tab') return evt.shiftKey ? 'tab' : false
    return pane
  }
  return pane
}

function editorOf(el: Element): EditorView | null {
  const root = el.closest('.cm-editor')
  if (!root) return null
  try {
    return EditorView.findFromDOM(root as HTMLElement)
  } catch {
    return null
  }
}

/** The internal link a click or the pointer landed on, read view or editor; null for anything else. */
export function noteLinkAt(target: EventTarget | null): ClickedNoteLink | null {
  if (!(target instanceof Element)) return null

  const anchor = target.closest('a.internal-link')
  if (anchor) {
    const href = anchor.getAttribute('data-href') ?? anchor.getAttribute('href')
    return href ? { href, sourceMode: false, inEditor: false } : null
  }

  // Live Preview and source mode draw a link as styled text; its target is read out of the line.
  const styled = target.closest('.cm-hmd-internal-link, .cm-link')
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
  const href = internalLinkInLine(line.text, pos - line.from)
  if (!href) return null

  const livePreview = !!view.dom.closest('.is-live-preview')
  // Live Preview opens a link from its underlined text only, as Obsidian decides; the brackets
  // and target revealed around the cursor are for editing.
  if (livePreview && !target.closest('.cm-underline')) return null
  return { href, sourceMode: !livePreview, inEditor: true }
}

/** The note view the element is inside, if any. */
function viewOf(app: App, el: Element): MarkdownView | null {
  for (const leaf of app.workspace.getLeavesOfType('markdown')) {
    const view = leaf.view
    if (view instanceof MarkdownView && view.containerEl.contains(el)) return view
  }
  return null
}

/** The note the clicked element belongs to, so a link resolves the way it does in that note. */
function sourcePathOf(app: App, el: Element): string {
  return viewOf(app, el)?.file?.path ?? ''
}

/**
 * The pointer over a link to lines: Obsidian's page preview is asked for the note scrolled to
 * those lines, where on its own it would look for a heading called `L12-L18` and show "Unable
 * to find". Obsidian's own `mouseover` on the link is stopped so only this one is shown. Chat
 * messages count here too: their links get the same preview.
 */
export function lineLinkHover(app: App) {
  // Where the popover is kept for links outside a note view — in a chat, say.
  const detached: HoverParent = { hoverPopover: null }
  return (evt: MouseEvent) => {
    const target = evt.target as Element | null
    if (!target?.closest?.(NOTE_SURFACES)) return
    const link = noteLinkAt(target)
    if (!link) return
    const view = viewOf(app, target)
    const sourcePath = view?.file?.path ?? ''
    const resolved = resolveLineLink(app, link.href, sourcePath)
    if (!resolved) return

    evt.stopImmediatePropagation()
    app.workspace.trigger('hover-link', {
      event: evt,
      source: link.inEditor ? 'editor' : 'preview',
      hoverParent: view ?? detached,
      targetEl: target.closest('a.internal-link, .cm-hmd-internal-link, .cm-link') ?? target,
      linktext: resolved.file.path,
      sourcePath,
      state: { scroll: resolved.lines.from - 1 },
    })
  }
}

/** The click handler: takes a link to lines in a note and opens it there; lets anything else by. */
export function lineLinkInterceptor(app: App) {
  return (evt: MouseEvent) => {
    if ((evt.button !== 0 && evt.button !== 1) || evt.defaultPrevented) return
    const target = evt.target as Element | null
    if (!target?.closest?.(NOTE_SURFACES) || target.closest(OWN_MARKDOWN)) return

    const link = noteLinkAt(target)
    if (!link) return
    const pane = paneForClick(evt, link.sourceMode)
    if (pane === null) return
    const resolved = resolveLineLink(app, link.href, sourcePathOf(app, target))
    if (!resolved) return

    evt.preventDefault()
    evt.stopImmediatePropagation()
    void openNoteAtLines(app, resolved.file, resolved.lines, pane)
  }
}

/** The lines an editor's selection covers, 1-based; a selection ending at a line's start stops before it. */
export function selectedLines(editor: Editor): LineRange {
  const from = editor.getCursor('from')
  const to = editor.getCursor('to')
  const last = to.line > from.line && to.ch === 0 ? to.line - 1 : to.line
  return { from: from.line + 1, to: last + 1 }
}

/** A link to those lines of `file`, in the person's own link format (wikilink or markdown). */
export function linkToLines(app: App, file: TFile, lines: LineRange): string {
  return app.fileManager.generateMarkdownLink(file, '', lineSubpath(lines))
}

async function copyLinkToLines(app: App, editor: Editor, file: TFile): Promise<void> {
  await navigator.clipboard.writeText(linkToLines(app, file, selectedLines(editor)))
  new Notice('Link copied')
}

export function registerLineLinks(plugin: Plugin): void {
  const { app } = plugin

  // Capture phase, so these run before Obsidian's own handlers on the link and can stop them. A
  // middle click comes as `auxclick`, and Obsidian opens a new tab on it.
  const onClick = lineLinkInterceptor(app)
  const onHover = lineLinkHover(app)
  const listen = (doc: Document) => {
    plugin.registerDomEvent(doc, OPENING_EVENT, onClick, { capture: true })
    plugin.registerDomEvent(doc, 'auxclick', onClick, { capture: true })
    plugin.registerDomEvent(doc, 'mouseover', onHover, { capture: true })
  }
  listen(document)
  plugin.registerEvent(app.workspace.on('window-open', (_win, win) => listen(win.document)))

  plugin.registerEvent(
    app.workspace.on('editor-menu', (menu, editor, view) => {
      const file = view.file
      if (!file || file.extension !== 'md') return
      const lines = selectedLines(editor)
      menu.addItem((item) =>
        item
          .setTitle(lines.from === lines.to ? 'Copy link to line' : 'Copy link to lines')
          .setIcon('link')
          .setSection('selection')
          .onClick(() => void copyLinkToLines(app, editor, file))
      )
    })
  )

  plugin.addCommand({
    id: 'copy-link-to-lines',
    name: 'Copy link to selected lines',
    icon: 'link',
    editorCheckCallback: (checking, editor, ctx) => {
      const file = ctx.file
      if (!file || file.extension !== 'md') return false
      if (!checking) void copyLinkToLines(app, editor, file)
      return true
    },
  })
}
