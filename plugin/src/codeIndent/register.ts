import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateEffect } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { MarkdownPreviewRenderer, type Plugin } from 'obsidian'
import { guideDepths, indentStep } from './indentGuides'
import { drawReadingGuides } from './readingGuides'

interface GuideSettings {
  enabled: boolean
  tabSize: number
}
type Settings = () => GuideSettings
export const refreshCodeGuides = StateEffect.define<null>()
const registry = () =>
  (MarkdownPreviewRenderer as unknown as { codeBlockPostProcessors?: object })
    .codeBlockPostProcessors ?? {}
const special = (language: string, processors: object) =>
  ['mermaid', 'chart', 'map', 'columns'].includes(language) ||
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
      constructor(view: EditorView) {
        this.draw(view)
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state) ||
          update.transactions.some((t) => t.effects.some((e) => e.is(refreshCodeGuides)))
        )
          this.blocks = []
        if (
          update.docChanged ||
          update.viewportChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state) ||
          update.transactions.some((t) => t.effects.some((e) => e.is(refreshCodeGuides)))
        )
          this.draw(update.view)
      }
      draw(view: EditorView) {
        const config = settings()
        if (!config.enabled) {
          this.decorations = Decoration.none
          return
        }
        const marks: Range<Decoration>[] = []
        const seen = new Set<number>()
        const kinds = new Map<number, ReturnType<typeof kind>>()
        const at = (n: number) => {
          if (!kinds.has(n)) {
            let value = kind(view.state, n)
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
        for (const range of view.visibleRanges) {
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
            for (let i = n; i <= Math.min(end, last); i++) {
              seen.add(i)
              const depth = depths[i - start]
              if (depth)
                marks.push(
                  Decoration.line({
                    attributes: {
                      class: 'abele-code-guides',
                      style: `--abele-guide-depth: ${depth}; --abele-guide-step: ${step}ch`,
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
  const settings: Settings = () => {
    const size = Number(vault.getConfig('tabSize'))
    return {
      enabled: vault.getConfig('showIndentGuide') !== false,
      tabSize: Number.isInteger(size) && size > 0 ? size : 4,
    }
  }
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
  // Vault editor settings have no public change event. Poll only the two scalar values;
  // documents and DOM are touched only when either changes.
  plugin.registerInterval(
    window.setInterval(() => {
      const next = JSON.stringify(settings())
      if (next === previous) return
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
        // Unwrap only our line containers. Prism nodes and all original text survive.
        for (const row of Array.from(code.querySelectorAll(':scope > .abele-code-line')))
          row.replaceWith(...Array.from(row.childNodes))
        code.style.removeProperty('--abele-guide-step')
        process(code)
      }
    }, 500)
  )
}
