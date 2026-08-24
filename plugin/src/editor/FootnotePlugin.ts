import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet } from '@codemirror/view'
import { EditorState, RangeSetBuilder } from '@codemirror/state'
import { editorLivePreviewField, editorInfoField, Platform } from 'obsidian'
import { Footnote } from '@/entities/Footnote'
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { reliableScrollTo } from '@/helpers/scrollUtils'

const FOOTNOTE_REF_RE = /\[\^([^\]]+)\]/g
const FOOTNOTE_DEF_RE = /^\[\^([^\]]+)\]:\s*(.*)/

const SIDENOTE_GAP = 4
const HIGHLIGHT_CLASS = 'abele-footnote-ref-highlight'

interface ParsedFootnote {
  label: string
  content: string
  filePath: string
  definitionFrom: number
  refFrom: number
  refTo: number
  refLineEnd: number
}

interface ParsedDefinition {
  label: string
  /** Position of [^N] inside the definition line */
  labelFrom: number
  labelTo: number
}

function parseFootnotes(state: EditorState) {
  const empty = { footnotes: [] as ParsedFootnote[], definitions: [] as ParsedDefinition[] }

  if (!state.field(editorLivePreviewField)) return empty

  const file = state.field(editorInfoField)?.file
  if (!file) return empty

  // Parse definitions
  const defs = new Map<string, { content: string; from: number }>()
  const definitions: ParsedDefinition[] = []

  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i)
    const match = FOOTNOTE_DEF_RE.exec(line.text)
    if (!match) continue

    const label = match[1]
    const firstLineContent = match[2]
    const lines = [firstLineContent]
    let endLine = i

    for (let j = i + 1; j <= state.doc.lines; j++) {
      const nextLine = state.doc.line(j)
      if (nextLine.text.trim() === '') {
        // Blank line — peek ahead for indented continuation
        let k = j + 1
        while (k <= state.doc.lines && state.doc.line(k).text.trim() === '') k++
        if (k <= state.doc.lines && /^(?:\t| {2,})/.test(state.doc.line(k).text)) {
          // Continuation follows — include blank lines
          for (let b = j; b < k; b++) lines.push('')
          lines.push(state.doc.line(k).text.replace(/^(?:\t| {2,})/, ''))
          endLine = k
          j = k
          continue
        }
        // No continuation — end of definition
        break
      }
      if (/^(?:\t| {2,})/.test(nextLine.text)) {
        lines.push(nextLine.text.replace(/^(?:\t| {2,})/, ''))
        endLine = j
      } else {
        break
      }
    }

    defs.set(label, { content: lines.join('\n'), from: line.from })

    // The [^label] part in the definition line: starts at line.from, ends before ]:
    const bracketEnd = line.from + match[0].indexOf(':')
    definitions.push({
      label,
      labelFrom: line.from,
      labelTo: bracketEnd,
    })
  }

  if (defs.size === 0) return empty

  // Parse references
  const footnotes: ParsedFootnote[] = []
  const seen = new Set<string>()

  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i)
    if (FOOTNOTE_DEF_RE.test(line.text)) continue

    FOOTNOTE_REF_RE.lastIndex = 0
    let refMatch: RegExpExecArray | null
    while ((refMatch = FOOTNOTE_REF_RE.exec(line.text)) !== null) {
      const label = refMatch[1]
      const def = defs.get(label)
      if (!def) continue
      if (seen.has(label)) continue
      seen.add(label)

      footnotes.push({
        label,
        content: def.content,
        filePath: file.path,
        definitionFrom: def.from,
        refFrom: line.from + refMatch.index,
        refTo: line.from + refMatch.index + refMatch[0].length,
        refLineEnd: line.to,
      })
    }
  }

  return { footnotes, definitions }
}

function buildDecorations(
  footnotes: ParsedFootnote[],
  definitions: ParsedDefinition[],
  state: EditorState
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()

  // Collect all marks and sort by from position (required by RangeSetBuilder)
  const marks: { from: number; to: number; cls: string; label: string; style?: string }[] = []

  // References in body text: [, ^, label, ]
  for (const fn of footnotes) {
    // [
    marks.push({
      from: fn.refFrom,
      to: fn.refFrom + 1,
      cls: 'abele-footnote-ref-bracket',
      label: fn.label,
    })
    // ^
    marks.push({
      from: fn.refFrom + 1,
      to: fn.refFrom + 2,
      cls: 'abele-footnote-ref-caret',
      label: fn.label,
    })
    // label
    marks.push({
      from: fn.refFrom + 2,
      to: fn.refTo - 1,
      cls: 'abele-footnote-ref-link',
      label: fn.label,
    })
    // ]
    marks.push({
      from: fn.refTo - 1,
      to: fn.refTo,
      cls: 'abele-footnote-ref-bracket',
      label: fn.label,
    })
  }

  // Build a map from label to refFrom for definitions
  const refPositions = new Map<string, number>()
  for (const fn of footnotes) {
    refPositions.set(fn.label, fn.refFrom)
  }

  // [^N] in definition lines — only mark the label for click handling
  for (const def of definitions) {
    if (!refPositions.has(def.label)) continue
    marks.push({
      from: def.labelFrom,
      to: def.labelTo,
      cls: 'abele-footnote-def-link',
      label: def.label,
    })
  }

  // Sort by from position
  marks.sort((a, b) => a.from - b.from || a.to - b.to)

  for (const mark of marks) {
    const attrs: Record<string, string> = { 'data-footnote-label': mark.label }
    if (mark.style) attrs.style = mark.style
    builder.add(mark.from, mark.to, Decoration.mark({ class: mark.cls, attributes: attrs }))
  }

  return builder.finish()
}

class FootnoteOverlay {
  private view: EditorView
  private overlay: HTMLElement
  private entries = new Map<string, { id: string; el: HTMLElement; footnote: ParsedFootnote }>()
  private destroyed = false
  private highlightedLine: HTMLElement | null = null
  decorations: DecorationSet

  private parsedFootnotes: ParsedFootnote[] = []
  private parsedDefinitions: ParsedDefinition[] = []

  constructor(view: EditorView) {
    this.view = view
    this.overlay = document.createElement('div')
    this.overlay.classList.add('abele-footnotes-overlay')
    view.scrollDOM.appendChild(this.overlay)

    const parsed = parseFootnotes(view.state)
    this.parsedFootnotes = parsed.footnotes
    this.parsedDefinitions = parsed.definitions
    this.decorations = buildDecorations(this.parsedFootnotes, this.parsedDefinitions, view.state)

    this.rebuildOverlay()
    window.requestAnimationFrame(() => this.position())

    // Click handler for footnote links
    this.view.dom.addEventListener('click', this.handleClick)
  }

  private handleClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement

    // Click on any part of [^N] in body text → scroll to definition
    const refPart = target.closest(
      '.abele-footnote-ref-link, .abele-footnote-ref-bracket, .abele-footnote-ref-caret'
    )
    if (refPart) {
      const label = refPart.getAttribute('data-footnote-label')
      const fn = this.parsedFootnotes.find((f) => f.label === label)
      if (fn) {
        e.preventDefault()
        reliableScrollTo(fn.definitionFrom)
      }
      return
    }

    // Click on any part of [^N] in definition → scroll to reference
    const defPart = target.closest(
      '.abele-footnote-def-link, .abele-footnote-def-bracket, .abele-footnote-def-caret'
    )
    if (defPart) {
      const label = defPart.getAttribute('data-footnote-label')
      const fn = this.parsedFootnotes.find((f) => f.label === label)
      if (fn) {
        e.preventDefault()
        reliableScrollTo(fn.refFrom)
      }
      return
    }
  }

  update(update: ViewUpdate) {
    if (this.destroyed) return

    let needsRebuild = false
    if (
      update.docChanged ||
      update.state.field(editorLivePreviewField) !== update.startState.field(editorLivePreviewField)
    ) {
      const parsed = parseFootnotes(update.state)
      this.parsedFootnotes = parsed.footnotes
      this.parsedDefinitions = parsed.definitions
      this.decorations = buildDecorations(
        this.parsedFootnotes,
        this.parsedDefinitions,
        update.state
      )
      needsRebuild = true
    }

    if (needsRebuild) {
      this.rebuildOverlay()
    }

    if (update.geometryChanged || update.viewportChanged || update.docChanged) {
      window.requestAnimationFrame(() => this.position())
    }
  }

  private rebuildOverlay() {
    const store = GlobalStore.getInstance()
    const newLabels = new Set(this.parsedFootnotes.map((f) => f.label))

    // Remove stale
    for (const [label, entry] of this.entries) {
      if (!newLabels.has(label)) {
        this.removeEntry(label, entry, store)
      }
    }

    // Add or update
    for (const fn of this.parsedFootnotes) {
      const existing = this.entries.get(fn.label)
      if (existing) {
        const storeEntry = store.footnotesContainers.value.find((f) => f.id === existing.id)
        if (
          storeEntry &&
          (storeEntry.content !== fn.content || storeEntry.definitionFrom !== fn.definitionFrom)
        ) {
          this.removeEntry(fn.label, existing, store)
          this.createEntry(fn, store)
        }
        existing.footnote = fn
      } else {
        this.createEntry(fn, store)
      }
    }
  }

  private createEntry(fn: ParsedFootnote, store: GlobalStore) {
    const id = genid()
    const el = document.createElement('div')
    el.classList.add('abele-footnote-widget-container')
    el.id = id
    el.createDiv({ attr: { 'data-footnote-id': id }, cls: 'abele-vue-mount' })
    this.overlay.appendChild(el)

    el.addEventListener('mouseenter', () => this.highlightRef(fn))
    el.addEventListener('mouseleave', () => this.clearHighlight())

    store.footnotesContainers.value.push(
      new Footnote({
        id,
        label: fn.label,
        content: fn.content,
        filePath: fn.filePath,
        definitionFrom: fn.definitionFrom,
        refFrom: fn.refFrom,
      })
    )

    this.entries.set(fn.label, { id, el, footnote: fn })
  }

  private highlightRef(fn: ParsedFootnote) {
    this.clearHighlight()
    try {
      const domPos = this.view.domAtPos(fn.refFrom)
      const lineEl =
        domPos.node instanceof HTMLElement
          ? domPos.node.closest('.cm-line')
          : (domPos.node.parentElement?.closest('.cm-line') ?? null)
      if (lineEl) {
        lineEl.classList.add(HIGHLIGHT_CLASS)
        this.highlightedLine = lineEl as HTMLElement
      }
    } catch {
      // pos may be outside viewport
    }
  }

  private clearHighlight() {
    if (this.highlightedLine) {
      this.highlightedLine.classList.remove(HIGHLIGHT_CLASS)
      this.highlightedLine = null
    }
  }

  private removeEntry(label: string, entry: { id: string; el: HTMLElement }, store: GlobalStore) {
    const idx = store.footnotesContainers.value.findIndex((f) => f.id === entry.id)
    if (idx !== -1) {
      store.footnotesContainers.value[idx].cleanup()
      store.footnotesContainers.value.splice(idx, 1)
    }
    entry.el.remove()
    this.entries.delete(label)
  }

  private position() {
    if (this.destroyed || this.entries.size === 0) return

    const contentDOM = this.view.contentDOM
    const scroller = this.view.scrollDOM

    const contentRect = contentDOM.getBoundingClientRect()
    const scrollerRect = scroller.getBoundingClientRect()

    const rightSpace = scrollerRect.right - contentRect.right
    const sidenoteWidth = Math.min(300, Math.max(180, rightSpace - 16))

    if (rightSpace < 200) {
      for (const entry of this.entries.values()) {
        entry.el.style.display = 'none'
      }
      return
    }

    const sorted = [...this.entries.values()].sort(
      (a, b) => a.footnote.refFrom - b.footnote.refFrom
    )

    let lastBottom = -Infinity

    for (const entry of sorted) {
      const coords = this.view.coordsAtPos(entry.footnote.refFrom)
      if (!coords) {
        entry.el.style.display = 'none'
        continue
      }

      entry.el.style.display = ''
      entry.el.style.position = 'absolute'
      entry.el.style.width = `${sidenoteWidth}px`
      entry.el.style.left = `${contentRect.right - scrollerRect.left + 8}px`

      const targetTop = coords.top - scrollerRect.top + scroller.scrollTop
      const actualTop = Math.max(targetTop, lastBottom + SIDENOTE_GAP)

      entry.el.style.top = `${actualTop}px`
      lastBottom = actualTop + entry.el.offsetHeight
    }
  }

  destroy() {
    this.destroyed = true
    this.clearHighlight()
    this.view.dom.removeEventListener('click', this.handleClick)
    const store = GlobalStore.getInstance()
    for (const entry of this.entries.values()) {
      const idx = store.footnotesContainers.value.findIndex((f) => f.id === entry.id)
      if (idx !== -1) {
        store.footnotesContainers.value[idx].cleanup()
        store.footnotesContainers.value.splice(idx, 1)
      }
      entry.el.remove()
    }
    this.entries.clear()
    this.overlay.remove()
  }
}

export const footnoteExtensions = ViewPlugin.fromClass(FootnoteOverlay, {
  decorations: (v) => v.decorations,
})
