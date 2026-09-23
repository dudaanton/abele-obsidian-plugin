/**
 * Syntax highlighting for a file shown from GitHub, chosen by its name.
 *
 * The languages the plugin already bundles for its code view come first. Anything else — Python,
 * Go, Rust, shell — is borrowed from the CodeMirror 5 modes Obsidian still ships on
 * `window.CodeMirror` for its own code blocks, wrapped as a CodeMirror 6 stream language. That
 * global is not part of Obsidian's API, so every step of it is optional: without it the file is
 * shown as plain text, never not at all.
 */
import type { Extension } from '@codemirror/state'
import { StreamLanguage, type StreamParser } from '@codemirror/language'
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

interface LegacyModeInfo {
  mode: string
  mime?: string
}

interface LegacyCodeMirror {
  findModeByFileName?: (name: string) => LegacyModeInfo | undefined
  getMode?: (config: object, spec: string) => StreamParser<unknown> & { name?: string }
}

const legacy = new Map<string, Extension | null>()

function fromLegacy(fileName: string): Extension | null {
  const cm = (window as unknown as { CodeMirror?: LegacyCodeMirror }).CodeMirror
  if (!cm?.findModeByFileName || !cm.getMode) return null

  const info = cm.findModeByFileName(fileName)
  if (!info?.mode || info.mode === 'null') return null
  const spec = info.mime ?? info.mode
  if (legacy.has(spec)) return legacy.get(spec) ?? null

  let extension: Extension | null = null
  try {
    const mode = cm.getMode({ indentUnit: 2, tabSize: 4 }, spec)
    // `getMode` answers an unknown language with the plain-text mode rather than failing.
    if (mode && mode.name !== 'null' && typeof mode.token === 'function') {
      extension = StreamLanguage.define(mode)
    }
  } catch (e) {
    console.debug('[Abele] GitHub: no highlighting for', fileName, e)
  }
  legacy.set(spec, extension)
  return extension
}

export function languageFor(path: string): Extension[] {
  const name = path.split('/').pop() ?? path
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  const bundled = BUNDLED[ext]
  if (bundled) return [bundled()]
  const borrowed = fromLegacy(name)
  return borrowed ? [borrowed] : []
}
