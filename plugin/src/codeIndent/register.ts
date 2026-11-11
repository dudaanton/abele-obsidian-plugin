import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, RangeSet, StateEffect } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { MarkdownPreviewRenderer, type Plugin, type Events } from 'obsidian'
import { guideDepths, indentStep } from './indentGuides'
import { clearReadingGuides, copyReadingGuides, drawReadingGuides } from './readingGuides'
import { nativeCodeLines } from './nativeLines'

interface GuideSettings {
  enabled: boolean
  tabSize: number
}
type Settings = (() => GuideSettings) & { inspect?: (doc: Document) => unknown }
export const refreshCodeGuides = StateEffect.define<null>()
const measuredCodeGuides = StateEffect.define<DecorationSet>()
const registry = () =>
  (MarkdownPreviewRenderer as unknown as { codeBlockPostProcessors?: object })
    .codeBlockPostProcessors ?? {}
const special = (language: string, processors: object) =>
  ['mermaid', 'pele', 'chart', 'map', 'columns'].includes(language) ||
  Object.prototype.hasOwnProperty.call(processors, language)

export function blockGuides(lines: string[], settings: GuideSettings) {
  return {
    depths: settings.enabled ? guideDepths(lines, settings.tabSize) : [],
    step: indentStep(lines, settings.tabSize),
  }
}

export function readingGuideProcessor(settings: Settings, processors: () => object = registry) {
  return (root: HTMLElement) => {
    if (!settings().enabled) return
    const codes = [
      ...(root.matches('pre > code') ? [root] : []),
      ...Array.from(root.querySelectorAll<HTMLElement>('pre > code')),
    ]
    for (const code of codes) {
      const language =
        [...Array.from(code.classList), ...Array.from(code.parentElement.classList)]
          .find((c) => c.startsWith('language-'))
          ?.slice(9)
          .toLowerCase() ?? ''
      if (!special(language, processors())) drawReadingGuides(code, settings().tabSize)
    }
  }
}

/** HyperMD's parser, rather than fence-looking text in prose, determines code membership. */
function kind(state: EditorState, number: number): 'code' | 'fence' | null {
  const line = state.doc.line(number)
  let result: 'code' | 'fence' | null = null
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      if (node.name.includes('codeblock-begin') || node.name.includes('codeblock-end'))
        result = 'fence'
      else if (result !== 'fence' && /(?:HyperMD|hmd)-codeblock/.test(node.name)) result = 'code'
    },
  })
  return result
}

/** Cache only blocks intersecting the viewport; scrolling does not scan unrelated fences. */
export function codeGuideExtension(settings: Settings) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none
      blocks: { start: number; end: number; depths: number[]; step: number }[] = []
      tree: ReturnType<typeof syntaxTree> | undefined
      config = ''
      destroyed = false
      native: ReturnType<typeof nativeCodeLines> | undefined
      nativeDoc: EditorState['doc'] | undefined
      document: Document
      recomputations = 0
      lastRecomputed: {
        at: number
        sequence: number
        measured: boolean
        enabled: boolean
        gate: unknown
      } | null = null
      constructor(view: EditorView) {
        this.document = view.dom.ownerDocument
        this.draw(view)
        this.settle(view)
      }
      update(update: ViewUpdate) {
        const measured = update.transactions
          .flatMap((t) => t.effects)
          .find((e) => e.is(measuredCodeGuides))
        if (measured?.is(measuredCodeGuides)) {
          this.decorations = measured.value
          return
        }
        // HyperMD may advance the parse context used by both states. Compare with
        // the tree we actually drew, rather than reading the old state again.
        const changed =
          this.tree !== syntaxTree(update.state) || this.config !== JSON.stringify(settings())
        const refreshed = update.transactions.some((t) =>
          t.effects.some((e) => e.is(refreshCodeGuides))
        )
        if (update.docChanged || changed || refreshed) this.blocks = []
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.geometryChanged ||
          update.selectionSet ||
          update.focusChanged ||
          changed ||
          refreshed
        ) {
          this.draw(update.view)
          this.settle(update.view)
        }
      }
      settle(view: EditorView) {
        view.requestMeasure({
          key: this,
          read: () => {
            const before = this.decorations
            this.draw(view, true)
            const next = this.decorations
            this.decorations = before
            return { decorations: next, state: view.state }
          },
          write: ({ decorations, state }) => {
            // Dispatch after CodeMirror leaves its measure/write transaction.
            queueMicrotask(() => {
              if (
                !this.destroyed &&
                view.state === state &&
                !RangeSet.eq([this.decorations], [decorations])
              )
                view.dispatch({ effects: measuredCodeGuides.of(decorations) })
            })
          },
        })
      }
      destroy() {
        this.destroyed = true
      }
      guideDiagnostics() {
        return {
          currentGate: settings.inspect?.(this.document) ?? settings(),
          internalEnabled: this.config ? (JSON.parse(this.config) as GuideSettings).enabled : null,
          lastRecomputed: this.lastRecomputed,
          decorationCount: this.decorations.size,
          destroyed: this.destroyed,
        }
      }
      draw(view: EditorView, measured = false) {
        const config = settings()
        this.lastRecomputed = {
          at: Date.now(),
          sequence: ++this.recomputations,
          measured,
          enabled: config.enabled,
          gate: settings.inspect?.(this.document) ?? config,
        }
        if (this.nativeDoc !== view.state.doc) this.native = undefined
        if (measured) {
          const next = nativeCodeLines(view, config.tabSize, (n) => kind(view.state, n))
          if (
            JSON.stringify(Array.from(next.kinds)) !==
              JSON.stringify(Array.from(this.native?.kinds ?? [])) ||
            JSON.stringify(next.blocks) !== JSON.stringify(this.native?.blocks)
          )
            this.blocks = []
          this.native = next
          this.nativeDoc = view.state.doc
        }
        this.tree = syntaxTree(view.state)
        this.config = JSON.stringify(config)
        if (!config.enabled) {
          this.decorations = Decoration.none
          return
        }
        const marks: Range<Decoration>[] = []
        const seen = new Set<number>()
        const kinds = new Map<number, ReturnType<typeof kind>>()
        const at = (n: number) => {
          if (!kinds.has(n)) {
            let value =
              this.native?.kinds.get(n) ??
              (this.native?.blocks.some((b) => n >= b.start && n <= b.end)
                ? 'code'
                : kind(view.state, n))
            if (!view.state.doc.line(n).text.trim()) {
              let before = n - 1
              let after = n + 1
              while (before > 0 && !view.state.doc.line(before).text.trim()) before--
              while (after <= view.state.doc.lines && !view.state.doc.line(after).text.trim())
                after++
              if (
                before > 0 &&
                after <= view.state.doc.lines &&
                kind(view.state, before) === 'code' &&
                kind(view.state, after)
              )
                value = 'code'
              for (let i = before + 1; i < after; i++) kinds.set(i, value)
            }
            kinds.set(n, value)
          }
          return kinds.get(n)
        }
        // When a selection opens a Live Preview block, visibleRanges can still
        // describe its replacement widget. Include the selected code block now;
        // do not wait for a subsequent viewport or parser update to expose it.
        const selected = view.state.selection.ranges
          .flatMap((r) => [r.anchor, r.head])
          .filter(
            (p) =>
              p >= view.viewport.from &&
              p <= view.viewport.to &&
              at(view.state.doc.lineAt(p).number) === 'code'
          )
        const ranges = [
          ...view.visibleRanges,
          ...selected.map((p) => ({ from: p, to: p, selected: true })),
        ]
        for (const range of ranges) {
          const first = view.state.doc.lineAt(range.from).number
          const last = view.state.doc.lineAt(range.to).number
          for (let n = first; n <= last; n++) {
            if (seen.has(n) || at(n) !== 'code') continue
            let block = this.blocks.find((b) => b.start <= n && b.end >= n)
            if (!block) {
              let start = n
              let end = n
              while (start > 1 && at(start - 1) === 'code') start--
              while (end < view.state.doc.lines && at(end + 1) === 'code') end++
              const opening = start > 1 ? view.state.doc.line(start - 1).text : ''
              const language = /(?:`{3,}|~{3,})\s*([^\s`]*)/.exec(opening)?.[1]?.toLowerCase() ?? ''
              if (special(language, registry())) {
                n = Math.min(end, last)
                continue
              }
              const lines: string[] = []
              for (let i = start; i <= end; i++) lines.push(view.state.doc.line(i).text)
              block = { start, end, ...blockGuides(lines, config) }
              this.blocks.push(block)
              if (this.blocks.length > 16) this.blocks.shift()
            }
            const { start, end, depths, step } = block
            const blockMetric = Array.from(this.native?.metrics ?? []).find(
              ([n]) => n >= start && n <= end
            )?.[1]
            const markFrom =
              'selected' in range
                ? Math.max(start, view.state.doc.lineAt(view.viewport.from).number)
                : n
            const markTo =
              'selected' in range
                ? Math.min(end, view.state.doc.lineAt(view.viewport.to).number)
                : Math.min(end, last)
            for (let i = markFrom; i <= markTo; i++) {
              if (seen.has(i)) continue
              seen.add(i)
              const depth = depths[i - start]
              const metric = this.native?.metrics.get(i) ?? blockMetric
              if (depth)
                marks.push(
                  Decoration.line({
                    attributes: {
                      class: 'abele-code-guides',
                      style: `--abele-guide-depth: ${depth}; --abele-guide-step: ${metric ? `${metric.cell * step}px` : `${step}ch`}${metric ? `; --abele-guide-inset: ${metric.inset}px` : ''}`,
                    },
                  }).range(view.state.doc.line(i).from)
                )
            }
            n = Math.min(end, last)
          }
        }
        this.decorations = Decoration.set(marks, true)
      }
    },
    { decorations: (value) => value.decorations }
  )
}

export function registerCodeIndentGuides(plugin: Plugin): void {
  const vault = plugin.app.vault as typeof plugin.app.vault & { getConfig(key: string): unknown }
  const documents = new Set<Document>()
  const observers = new Map<Document, MutationObserver>()
  const documentIds = new WeakMap<Document, number>()
  let nextDocumentId = 0
  const documentFacts = (doc: Document) => {
    if (!documentIds.has(doc)) documentIds.set(doc, ++nextDocumentId)
    return {
      id: documentIds.get(doc),
      mainDocument: doc === document,
      mainWindow: doc.defaultView === window,
      bodyGuideClass: doc.body.classList.contains('show-indentation-guide'),
      mobile: doc.body.classList.contains('is-mobile'),
      observed: observers.has(doc),
      readingPaneGuideClasses: Array.from(doc.querySelectorAll('.markdown-rendered')).map((el) =>
        el.classList.contains('show-indentation-guide')
      ),
    }
  }
  const settings: Settings = () => {
    const size = Number(vault.getConfig('tabSize'))
    return {
      enabled:
        Array.from(documents).some((doc) =>
          doc.body.classList.contains('show-indentation-guide')
        ) || vault.getConfig('showIndentGuide') !== false,
      tabSize: Number.isInteger(size) && size > 0 ? size : 4,
    }
  }
  const events: { at: number; reason: string; key?: string }[] = []
  const record = (reason: string, key?: string) => {
    events.push({ at: Date.now(), reason, key })
    if (events.length > 20) events.shift()
  }
  settings.inspect = (doc) => {
    const raw = vault.getConfig('showIndentGuide')
    const observedDocuments = Array.from(documents, documentFacts)
    return {
      at: Date.now(),
      rawConfig: raw === undefined ? '[undefined]' : raw,
      rawConfigType: typeof raw,
      editorDocument: documentFacts(doc),
      observerDocuments: observedDocuments,
      gateReturn: settings().enabled,
      inputUsed: observedDocuments.some((d) => d.bodyGuideClass)
        ? 'observed-body-class'
        : 'vault-config-default-on',
      events: [...events],
    }
  }
  const diagnosticHost = plugin as Plugin & {
    codeIndentGuideDiagnostics?: (doc: Document) => unknown
  }
  diagnosticHost.codeIndentGuideDiagnostics = settings.inspect
  const blocks = new Set<WeakRef<HTMLElement>>()
  const remembered = new WeakSet<HTMLElement>()
  const process = readingGuideProcessor(settings)
  plugin.registerMarkdownPostProcessor((root) => {
    process(root)
    for (const code of [
      ...(root.matches('pre > code') ? [root] : []),
      ...Array.from(root.querySelectorAll<HTMLElement>('pre > code')),
    ]) {
      if (remembered.has(code)) continue
      remembered.add(code)
      blocks.add(new WeakRef(code))
    }
  }, 1000)
  plugin.registerEditorExtension(codeGuideExtension(settings))
  let previous = JSON.stringify(settings())
  let previousTabSize = settings().tabSize
  let unloaded = false
  const refresh = (force = false) => {
    if (unloaded) return
    const next = JSON.stringify(settings())
    for (const doc of documents)
      if (doc.body.classList.contains('abele-show-code-guides') !== settings().enabled)
        doc.body.classList.toggle('abele-show-code-guides', settings().enabled)
    if (!force && next === previous) return
    const tabSizeChanged = previousTabSize !== settings().tabSize
    previousTabSize = settings().tabSize
    previous = next
    plugin.app.workspace.iterateAllLeaves((leaf) => {
      const cm = (leaf.view as { editor?: { cm?: EditorView } }).editor?.cm
      cm?.dispatch({ effects: refreshCodeGuides.of(null) })
    })
    for (const ref of blocks) {
      const code = ref.deref()
      if (!code?.isConnected) {
        blocks.delete(ref)
        continue
      }
      if (tabSizeChanged) clearReadingGuides(code)
      process(code)
    }
  }
  const listen = (doc: Document) => {
    if (documents.has(doc)) return
    documents.add(doc)
    plugin.registerDomEvent(doc, 'copy', copyReadingGuides)
    const observer = new doc.defaultView.MutationObserver(() => {
      record('body-class')
      refresh()
    })
    observer.observe(doc.body, { attributes: true, attributeFilter: ['class'] })
    observers.set(doc, observer)
    record('observe-window')
    refresh(true)
  }
  listen(document)
  plugin.registerEvent(plugin.app.workspace.on('window-open', (_win, win) => listen(win.document)))
  plugin.registerEvent(
    plugin.app.workspace.on('window-close', (_win, win) => {
      observers.get(win.document)?.disconnect()
      observers.delete(win.document)
      documents.delete(win.document)
      refresh(true)
    })
  )
  plugin.register(() => {
    unloaded = true
    delete diagnosticHost.codeIndentGuideDiagnostics
    for (const observer of observers.values()) observer.disconnect()
    observers.clear()
    for (const doc of documents) doc.body.classList.remove('abele-show-code-guides')
    documents.clear()
    for (const ref of blocks) {
      const code = ref.deref()
      if (code) clearReadingGuides(code)
    }
  })
  plugin.app.workspace.onLayoutReady(() => {
    record('layout-ready')
    refresh(true)
  })
  plugin.registerEvent(
    plugin.app.workspace.on('css-change', () => {
      record('css-change')
      refresh(true)
    })
  )
  plugin.registerEvent(
    (vault as Events).on('config-changed', (key: string) => {
      record('config-changed', key)
      if (key === 'showIndentGuide' || key === 'tabSize') refresh(true)
    })
  )
  // Retain a cheap fallback for hosts that do not emit the internal config event.
  plugin.registerInterval(window.setInterval(() => refresh(), 500))
}
