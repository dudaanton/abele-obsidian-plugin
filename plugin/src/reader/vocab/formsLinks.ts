/**
 * A highlight's forms, in its note, shown as a link: tapped, the book opens with its search on
 * those forms, every place they stand listed (`wordsSearch.ts`). Where the note has them written —
 * a callout's `forms::` line, or the template's `{{ forms }}` field — is found by `formsPlaces`
 * (`highlights.ts`); the text itself is never changed.
 *
 * The link is an ordinary one to the book with a `#words=` subpath (`[[Novel.epub#words=māja,mājas]]`),
 * which the book tab reads when it is opened or followed into. In reading view (and a callout
 * drawn in live preview) the forms become an internal link; in the editor's own text, a mark
 * that opens it on a click.
 */
import { Keymap, TFile, type App, type MarkdownPostProcessorContext, type Plugin } from 'obsidian'
import { RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { editorInfoField } from 'obsidian'
import { watch } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { formsPlaces, type EntryFrame, type FormsPlace } from '../highlights'
import { entryFrame, parseNoteTemplate } from '../noteTemplate'
import { currentReaderSettings } from '../currentSettings'

const WORDS = 'words='

/** The subpath of a link to a book that opens its search on these forms. */
export const wordsSubpath = (forms: string[]): string =>
  `#${WORDS}${forms.map((f) => encodeURIComponent(f.trim())).join(',')}`

/** The forms a book link's subpath asks to search for; null when it asks for none. */
export function wordsOfSubpath(subpath: string | null | undefined): string[] | null {
  const s = (subpath ?? '').replace(/^#/, '')
  if (!s.startsWith(WORDS)) return null
  const forms = s
    .slice(WORDS.length)
    .split(',')
    .map((f) => {
      try {
        return decodeURIComponent(f).trim()
      } catch {
        return f.trim()
      }
    })
    .filter(Boolean)
  return forms.length ? forms : null
}

/** The link text a place's forms open: the book, and the forms. */
export const formsHref = (place: Pick<FormsPlace, 'book' | 'forms'>): string =>
  `${place.book}${wordsSubpath(place.forms)}`

/** The templates the settings name, as frames: where a `{{ forms }}` field may stand. */
let frames: EntryFrame[] = []
let framePaths: string[] = []
/** The editors showing notes now, told when the templates are read again. */
const editors = new Set<EditorView>()
const framesRead = StateEffect.define<null>()

function templatePaths(): string[] {
  const s = currentReaderSettings()
  const all = [s.notesTemplate, ...Object.values(s.bookNotes).map((b) => b.notesTemplate ?? '')]
  return [...new Set(all.map((p) => p.trim()).filter(Boolean))].map((p) =>
    p.endsWith('.md') ? p : `${p}.md`
  )
}

async function loadFrames(app: App): Promise<void> {
  framePaths = templatePaths()
  const out: EntryFrame[] = []
  for (const path of framePaths) {
    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) continue
    const frame = entryFrame(parseNoteTemplate(await app.vault.cachedRead(file)))
    if (frame.forms) out.push(frame)
  }
  frames = out
  for (const view of editors) view.dispatch({ effects: framesRead.of(null) })
}

/** The places a note's forms are written, with or without a template's field. */
export function placesIn(markdown: string, known: EntryFrame[] = frames): FormsPlace[] {
  // With no template field to look for, only a callout's `forms::` line can hold them.
  if (!known.length && !/forms::/i.test(markdown)) return []
  const byLine = new Map<number, FormsPlace>()
  for (const frame of [undefined, ...known])
    for (const p of formsPlaces(markdown, frame)) if (!byLine.has(p.line)) byLine.set(p.line, p)
  return [...byLine.values()].sort((a, b) => a.line - b.line)
}

/** The class a forms link has, in reading view and in the editor. */
export const FORMS_LINK_CLASS = 'abele-forms-link'

function linkEl(
  doc: Document,
  place: Pick<FormsPlace, 'book' | 'forms'>,
  text: string
): HTMLElement {
  const a = doc.win.createEl('a')
  a.className = `internal-link ${FORMS_LINK_CLASS}`
  const href = formsHref(place)
  a.setAttribute('data-href', href)
  a.setAttribute('href', href)
  a.setAttribute('aria-label', `Find ${place.forms.join(', ')} in the book`)
  a.textContent = text
  return a
}

/**
 * Wraps the text of `el` reading `text` in a link; whether it found it. `line` is the drawn text of
 * the line the forms are on: the paragraph that reads it is the one taken, not a paragraph that
 * happens to hold the same words; with none, the last text holding them.
 */
function wrapText(
  el: HTMLElement,
  text: string,
  place: Pick<FormsPlace, 'book' | 'forms'>,
  line?: string
): boolean {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
  let hit: Text | null = null
  let exact: Text | null = null
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!(n as Text).data.includes(text) || n.parentElement?.closest('a')) continue
    hit = n as Text
    const block = n.parentElement?.closest('p, li, div, td, th, h1, h2, h3, h4, h5, h6')
    if (line !== undefined && block && flat(block.textContent ?? '') === flat(line)) exact = hit
  }
  if (line !== undefined && exact) hit = exact
  if (!hit) return false
  const at = hit.data.lastIndexOf(text)
  const rest = hit.splitText(at)
  rest.data = rest.data.slice(text.length)
  hit.after(linkEl(el.ownerDocument, place, text))
  return true
}

/** The book a highlight callout's title links to, from its drawn link. */
function calloutBook(callout: Element): string | null {
  const link = callout.querySelector('.callout-title a.internal-link[data-href*="#cfi="]')
  const href = link?.getAttribute('data-href') ?? ''
  const hash = href.indexOf('#')
  return hash > 0 ? href.slice(0, hash) : null
}

const FORMS_TEXT = /^forms::[ \t]*(.+?)\s*$/i

/**
 * Reading view, and callouts live preview draws: a callout's `forms::` line found in what was
 * drawn, a `{{ forms }}` field by the lines of the section.
 */
export function formsLinkPostProcessor(
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
  known: EntryFrame[] = frames
): void {
  for (const callout of Array.from(el.querySelectorAll('.callout'))) {
    const book = calloutBook(callout)
    if (!book) continue
    for (const p of Array.from(callout.querySelectorAll('.callout-content p'))) {
      const text = FORMS_TEXT.exec(p.textContent ?? '')?.[1]
      if (!text || p.querySelector(`.${FORMS_LINK_CLASS}`)) continue
      const forms = text
        .split(/[,;]/)
        .map((f) => f.trim())
        .filter(Boolean)
      wrapText(p as HTMLElement, text, { book, forms })
    }
  }
  if (!known.length) return
  const info = ctx.getSectionInfo(el)
  if (!info) return
  const lines = info.text.split('\n')
  for (const place of placesIn(info.text, known)) {
    if (place.line < info.lineStart || place.line > info.lineEnd) continue
    if (/^>/.test(lines[place.line])) continue
    const raw = lines[place.line]
    // The line as drawn: without its emphasis and list marks, which are not text on the page.
    const drawn = raw.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').replace(/[*_`~=]/g, '')
    wrapText(el, raw.slice(place.from, place.to), place, drawn)
  }
}

/** Opens what a forms link names, from the note it is in. */
function follow(app: App, href: string, source: string, evt: MouseEvent): void {
  void app.workspace.openLinkText(href, source, Keymap.isModEvent(evt))
}

/** The editor's forms marks: the forms of each highlight in the note, drawn as a link. */
function editorLinks(app: App): Extension {
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>()
    const doc = view.state.doc
    if (doc.length > 2_000_000) return builder.finish()
    for (const place of placesIn(doc.toString())) {
      if (place.line + 1 > doc.lines) continue
      const line = doc.line(place.line + 1)
      builder.add(
        line.from + place.from,
        line.from + place.to,
        Decoration.mark({
          class: FORMS_LINK_CLASS,
          attributes: { 'data-href': formsHref(place) },
        })
      )
    }
    return builder.finish()
  }
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(private readonly view: EditorView) {
        editors.add(view)
        this.decorations = build(view)
      }
      update(u: ViewUpdate) {
        const reread = u.transactions.some((t) => t.effects.some((e) => e.is(framesRead)))
        if (u.docChanged || u.viewportChanged || reread) this.decorations = build(u.view)
      }
      destroy() {
        editors.delete(this.view)
      }
    },
    { decorations: (v) => v.decorations }
  )
  const clicks = EditorView.domEventHandlers({
    mousedown: (evt, view) => {
      if (evt.button !== 0) return false
      const el = (evt.target as Element | null)?.closest?.(`.${FORMS_LINK_CLASS}`)
      const href = el?.getAttribute('data-href')
      if (!href) return false
      evt.preventDefault()
      follow(app, href, view.state.field(editorInfoField, false)?.file?.path ?? '', evt)
      return true
    },
  })
  return [plugin, clicks]
}

/** Registers the links: reading view, the editor, and the templates they read the field by. */
export function registerFormsLinks(plugin: Plugin): void {
  const { app } = plugin
  plugin.registerMarkdownPostProcessor(formsLinkPostProcessor)
  plugin.registerEditorExtension(editorLinks(app))
  const reload = (): void => void loadFrames(app)
  app.workspace.onLayoutReady(reload)
  plugin.register(watch(AbeleConfig.getInstance().version, reload))
  plugin.registerEvent(
    app.vault.on('modify', (file) => {
      if (framePaths.includes(file.path)) reload()
    })
  )
}
