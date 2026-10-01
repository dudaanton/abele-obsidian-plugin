import { MarkdownPreviewRenderer } from 'obsidian'
import { neutraliseFences, PLAIN_LANGUAGES, ABELE_LANGUAGES } from '@/github/markdownPreview'

/** Not whitespace to trim(), so plugin query-prefix checks do not recognise code as commands. */
export const ZWSP = '​'
const FENCE_LINE =
  /^(?:[ \t]|>|[-+*](?=[ \t])|\d{1,9}[.)](?=[ \t]))*(`{3,}|~{3,})[ \t]*([^\s`]*)(.*)$/
/** Pair runs by length in one pass, rather than rescan the remaining README for every run. */
function guardParagraph(text: string): string {
  const runs: { at: number; length: number }[] = []
  for (let i = 0; i < text.length; ) {
    if (text[i] !== '`') {
      i++
      continue
    }
    const at = i
    while (text[i] === '`') i++
    runs.push({ at, length: i - at })
  }
  const next = new Array<number>(runs.length).fill(-1)
  const seen = new Map<number, number>()
  for (let i = runs.length - 1; i >= 0; i--) {
    next[i] = seen.get(runs[i].length) ?? -1
    seen.set(runs[i].length, i)
  }
  const out: string[] = []
  let copied = 0
  for (let i = 0; i < runs.length; i++) {
    const end = next[i]
    if (end < 0) continue
    const start = runs[i].at + runs[i].length
    const padded = runs[end].at - start > 1 && text[start] === ' '
    out.push(text.slice(copied, start), padded ? ` ${ZWSP}` : ZWSP)
    copied = padded ? start + 1 : start
    i = end
  }
  return out.join('') + text.slice(copied)
}

function guardSpans(text: string): string {
  return text
    .split(/(\n[ \t]*\n)/)
    .map(guardParagraph)
    .join('')
}

export function guardInlineCode(text: string): string {
  const out: string[] = []
  let run: string[] = []
  let open: { char: string; length: number } | null = null
  const flush = () => {
    if (run.length) out.push(guardSpans(run.join('\n')))
    run = []
  }
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const m = FENCE_LINE.exec(line)
    if (open) {
      out.push(line)
      if (m && m[1][0] === open.char && m[1].length >= open.length && !m[2] && !m[3].trim())
        open = null
    } else if (m && !(m[1][0] === '`' && m[3].includes('`'))) {
      flush()
      out.push(line)
      open = { char: m[1][0], length: m[1].length }
    } else run.push(line)
  }
  flush()
  return out.join('\n')
}

export function prepareMarkdown(text: string, ownBlocks = false): string {
  return guardInlineCode(neutraliseFences(text, ownBlocks))
}

function keepsLanguage(lang: string, ownBlocks: boolean): boolean {
  if (ownBlocks && ABELE_LANGUAGES.has(lang)) return true
  if (!PLAIN_LANGUAGES.has(lang)) return false
  if (lang === 'mermaid' || lang === 'math') return true
  const registry = (MarkdownPreviewRenderer as unknown as { codeBlockPostProcessors?: object })
    .codeBlockPostProcessors
  return !registry || !Object.prototype.hasOwnProperty.call(registry, lang)
}

/** Covers raw HTML code and fences a text scanner did not recognise. */
export function guardCode(root: HTMLElement, ownBlocks = false): void {
  const codes = [
    ...(root.matches('code') ? [root] : []),
    ...Array.from(root.querySelectorAll('code')),
  ]
  for (const code of codes) {
    const pre = code.parentElement?.localName === 'pre' ? code.parentElement : null
    for (const el of pre ? [pre, code] : [code]) {
      for (const cls of Array.from(el.classList)) {
        if (!cls.startsWith('language-')) continue
        if (!keepsLanguage(cls.slice(9).toLowerCase(), ownBlocks)) {
          el.classList.remove(cls)
          // No language at all: even a plugin claiming "text" must not execute the block.
        }
      }
    }
    // Dataview also inspects query-like code inside a pre. Its prefixes are configurable.
    const settings = (
      GlobalStore.getInstance().app as unknown as {
        plugins?: { plugins?: { dataview?: { settings?: Record<string, unknown> } } }
      }
    ).plugins?.plugins?.dataview?.settings
    const prefixes = ['=', '$=', settings?.inlineQueryPrefix, settings?.inlineJsQueryPrefix].filter(
      (p): p is string => typeof p === 'string' && !!p.trim()
    )
    const text = code.textContent ?? ''
    if (!pre || prefixes.some((p) => text.trim().startsWith(p))) {
      if (!text.startsWith(ZWSP)) code.prepend(code.ownerDocument.createTextNode(ZWSP))
      if (pre) code.setAttribute('data-abele-guarded-code', '')
    }
  }
}

import { GlobalStore } from '@/stores/GlobalStore'

export function finishCode(root: HTMLElement): void {
  for (const code of Array.from(root.querySelectorAll('code'))) {
    const walker = root.ownerDocument.createTreeWalker(code, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (node.nodeValue?.includes(ZWSP)) node.nodeValue = node.nodeValue.split(ZWSP).join('')
    if (!code.hasAttribute('data-abele-guarded-code')) continue
    // Obsidian's original copy handler captured the temporary invisible mark.
    const button = code.parentElement?.querySelector('.copy-code-button')
    if (!button) continue
    const fresh = button.cloneNode(true)
    fresh.addEventListener('click', (event) => {
      event.preventDefault()
      void navigator.clipboard.writeText((code.textContent ?? '').replace(/\n$/, ''))
    })
    button.replaceWith(fresh)
  }
}
