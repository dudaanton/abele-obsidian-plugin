/** Highlight with Obsidian's registry and theme classes. */
import { loadPrism } from 'obsidian'
import { shallowRef } from 'vue'
import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
  type EditorView,
} from '@codemirror/view'
import type { PrismEngine, PrismToken } from '@/editor/EditorSyntax'
export const prism = shallowRef<PrismEngine>()
let loading: Promise<PrismEngine> | undefined
export function loadedPrism(): Promise<PrismEngine> {
  return (loading ??= loadPrism().then((value) => (prism.value = value)))
}
const languages: Record<string, string> = {
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  yml: 'yaml',
  yaml: 'yaml',
  json: 'json',
  css: 'css',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  vue: 'markup',
  sql: 'sql',
  toml: 'toml',
  diff: 'diff',
  patch: 'diff',
  dockerfile: 'docker',
}
export function prismLanguage(
  engine: PrismEngine,
  path: string | undefined,
  source: string
): string | null {
  const name = path?.split('/').pop()?.toLowerCase() ?? ''
  const extension = name.split('.').pop() ?? ''
  let language =
    languages[extension] ??
    (!['md', 'markdown', 'txt', 'text'].includes(extension) && engine.languages[extension]
      ? extension
      : '')
  if (!language && source.startsWith('#!')) {
    const first = source.split('\n', 1)[0]
    if (/\b(?:bash|sh|zsh)\b/.test(first)) language = 'bash'
    else if (/\bpython[\d.]*\b/.test(first)) language = 'python'
    else if (/\bnode\b/.test(first)) language = 'javascript'
    else if (/\bruby\b/.test(first)) language = 'ruby'
  }
  return language && engine.languages[language] ? language : null
}
export interface LineToken {
  from: number
  to: number
  cls: string
}
export function lineTokens(
  engine: PrismEngine,
  text: string,
  path?: string,
  header = text
): LineToken[][] | null {
  const language = prismLanguage(engine, path, header)
  if (!language) return null
  const out: LineToken[][] = [[]]
  let column = 0
  const walk = (
    value: string | PrismToken | (string | PrismToken)[],
    classes: string[] = [],
    depth = 0
  ): void => {
    if (depth > 32) throw new Error('Token nesting limit')
    if (typeof value === 'string')
      value.split('\n').forEach((line, i) => {
        if (i) {
          out.push([])
          column = 0
        }
        if (line.length && classes.length)
          out[out.length - 1].push({
            from: column,
            to: column + line.length,
            cls: ['token', ...new Set(classes)].join(' '),
          })
        column += line.length
      })
    else if (Array.isArray(value)) value.forEach((child) => walk(child, classes, depth + 1))
    else
      walk(
        value.content,
        [...classes, value.type, ...[value.alias ?? []].flat()].filter((name) =>
          /^[\w-]+$/.test(name)
        ),
        depth + 1
      )
  }
  try {
    walk(engine.tokenize(text, engine.languages[language]))
    return out
  } catch (error) {
    console.debug('[code-syntax] Grammar failed', language, error)
    return null
  }
}
export function codeSyntax(path: string) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none
      destroyed = false
      constructor(readonly view: EditorView) {
        this.draw()
        void loadedPrism()
          .then(() => {
            if (!this.destroyed) {
              this.draw()
              view.dispatch({})
            }
          })
          .catch(console.debug)
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.draw()
      }
      draw() {
        if (!prism.value) return
        const doc = this.view.state.doc
        // Small files retain complete multiline grammar context. Large files parse only the
        // viewport and nearby lines; a single huge line is bounded as well.
        const start =
          doc.length <= 32768 ? 1 : Math.max(1, doc.lineAt(this.view.viewport.from).number - 40)
        const end =
          doc.length <= 32768
            ? doc.lines
            : Math.min(doc.lines, doc.lineAt(this.view.viewport.to).number + 40)
        const tokens = lineTokens(
          prism.value,
          doc.sliceString(
            doc.line(start).from,
            Math.min(doc.line(end).to, doc.line(start).from + 65536)
          ),
          path,
          doc.line(1).text
        )
        this.decorations = Decoration.set(
          tokens?.flatMap((line, i) =>
            line.map((token) =>
              Decoration.mark({ class: token.cls }).range(
                doc.line(start + i).from + token.from,
                doc.line(start + i).from + token.to
              )
            )
          ) ?? [],
          true
        )
      }
      destroy() {
        this.destroyed = true
      }
    },
    { decorations: (plugin) => plugin.decorations }
  )
}
