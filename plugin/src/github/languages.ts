/**
 * Syntax highlighting for a file shown from GitHub, chosen by its name: the languages the plugin
 * already bundles for its own code view. Anything else is shown as plain text.
 *
 * Borrowing the CodeMirror 5 modes Obsidian still ships on `window.CodeMirror` was tried: wrapped
 * as a CodeMirror 6 stream language they parse, but Obsidian's highlighter draws none of their
 * tokens, so every line came out plain anyway — at the cost of a parse.
 */
import type { Extension } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import { javascript } from '@codemirror/lang-javascript'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'

const BUNDLED: Record<string, () => Extension> = {
  json: json,
  js: javascript,
  mjs: javascript,
  cjs: javascript,
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  mts: () => javascript({ typescript: true }),
  cts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  css: css,
  html: html,
  htm: html,
  vue: html,
  xml: xml,
  svg: xml,
  yaml: yaml,
  yml: yaml,
}

export function languageFor(path: string): Extension[] {
  const name = path.split('/').pop() ?? path
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
  const bundled = BUNDLED[ext]
  return bundled ? [bundled()] : []
}
