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
import type { Range, Text } from '@codemirror/state'
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
  header = text,
  maxCharacters = Infinity
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
    // A single oversized line also needs bounded inputs; walk retains its column offset.
    for (let from = 0; from < text.length || from === 0; from += maxCharacters) {
      walk(engine.tokenize(text.slice(from, from + maxCharacters), engine.languages[language]))
    }
    return out
  } catch (error) {
    console.debug('[code-syntax] Grammar failed', language, error)
    return null
  }
}
// Whole-file tokenization keeps Prism's multiline context. Larger files use lexical chunks.
export const WHOLE_FILE_CHARACTERS = 1024 * 1024
const CHUNK_CHARACTERS = 65536
const MAX_CHUNK_CHARACTERS = 4 * CHUNK_CHARACTERS

/** Line starts outside comments, strings and templates, including nested interpolations. */
function syntaxChunks(doc: Text, lexical: boolean): number[] {
  const starts = [1]
  const stack: string[] = []
  let regexClass = false
  let expression = true
  let safe = 1
  let chunk = 1
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const limit = lexical ? MAX_CHUNK_CHARACTERS : CHUNK_CHARACTERS
    if (n > chunk && line.to - doc.line(chunk).from > limit) {
      // A colouring seam is preferable to an unbounded grammar pass.
      starts.push(n)
      chunk = safe = n
    }
    if (!lexical) continue
    if (!stack.length) {
      if (line.from - doc.line(chunk).from >= CHUNK_CHARACTERS) {
        // Prefer lexical boundaries while they fit within the hard limit.
        const next = safe > chunk ? safe : n
        starts.push(next)
        chunk = next
      }
      safe = n
    }
    const text = line.text + '\n'
    for (let i = 0; i < text.length; i++) {
      const c = text[i],
        next = text[i + 1],
        mode = stack[stack.length - 1]
      if (mode === '/*') {
        if (c === '*' && next === '/') {
          stack.pop()
          i++
        }
      } else if (mode === "'" || mode === '"' || mode === '`' || mode === '/') {
        if (c === '\\') {
          i++
          continue
        }
        if (mode === '/' && c === '[') regexClass = true
        else if (mode === '/' && c === ']') regexClass = false
        else if (c === mode && !regexClass) {
          stack.pop()
          expression = false
        } else if (mode === '`' && c === '$' && next === '{') {
          stack.push('}')
          expression = true
          i++
        }
      } else if (c === '/' && next === '/') {
        break
      } else if (c === '/' && next === '*') {
        stack.push('/*')
        i++
      } else if (c === "'" || c === '"' || c === '`') {
        stack.push(c)
      } else if (c === '/' && expression) {
        stack.push('/')
        regexClass = false
      } else if (mode === '}' && c === '{') {
        stack.push('}')
        expression = true
      } else if (mode === '}' && c === '}') {
        stack.pop()
        expression = false
      } else if (/[\w$]/.test(c)) {
        const word = /^[\w$]+/.exec(text.slice(i))[0]
        expression = /^(?:return|throw|case|delete|typeof|void|new|yield|await)$/.test(word)
        i += word.length - 1
      } else if (!/\s/.test(c)) {
        expression = /[=(:,;!&|?{}[+*%~<>-]/.test(c)
      }
    }
  }
  starts.push(doc.lines + 1)
  return starts
}

export function codeSyntax(path: string) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none
      destroyed = false
      private document?: Text
      private engine?: PrismEngine
      private chunks: number[] = []
      private tokens = new Map<number, LineToken[][] | null>()
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
        const engine = prism.value
        if (!engine) return
        const doc = this.view.state.doc
        if (doc !== this.document || engine !== this.engine) {
          this.document = doc
          this.engine = engine
          this.tokens.clear()
          const language = prismLanguage(engine, path, doc.line(1).text)
          this.chunks =
            doc.length <= WHOLE_FILE_CHARACTERS
              ? [1, doc.lines + 1]
              : syntaxChunks(
                  doc,
                  ['javascript', 'typescript', 'jsx', 'tsx'].includes(language ?? '')
                )
        }
        const first = doc.lineAt(this.view.viewport.from).number
        const last = doc.lineAt(this.view.viewport.to).number
        const marks: Range<Decoration>[] = []
        for (let i = 0; i < this.chunks.length - 1; i++) {
          const start = this.chunks[i],
            end = this.chunks[i + 1] - 1
          if (end < first) continue
          if (start > last) break
          if (!this.tokens.has(start)) {
            this.tokens.set(
              start,
              lineTokens(
                engine,
                doc.sliceString(doc.line(start).from, doc.line(end).to),
                path,
                doc.line(1).text,
                doc.length <= WHOLE_FILE_CHARACTERS
                  ? Infinity
                  : start === end
                    ? CHUNK_CHARACTERS
                    : MAX_CHUNK_CHARACTERS
              )
            )
            // Retain nearby chunks without keeping tokens for an arbitrarily large file.
            if (this.tokens.size > 4) this.tokens.delete(this.tokens.keys().next().value)
          }
          const tokens = this.tokens.get(start)
          for (let n = Math.max(start, first); n <= Math.min(end, last); n++) {
            for (const token of tokens?.[n - start] ?? []) {
              marks.push(
                Decoration.mark({ class: token.cls }).range(
                  doc.line(n).from + token.from,
                  doc.line(n).from + token.to
                )
              )
            }
          }
        }
        this.decorations = Decoration.set(marks, true)
      }
      destroy() {
        this.destroyed = true
        this.tokens.clear()
      }
    },
    { decorations: (plugin) => plugin.decorations }
  )
}
