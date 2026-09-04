/**
 * Confines a script's CSS to one view by prefixing every selector with the view's root.
 *
 * Written over text, not CSSOM: Obsidian on an older iOS WebView reads nested CSS only in its
 * strict form, and happy-dom parses no stylesheet, so the browser's parser is the one thing
 * this cannot rely on. Braces are walked; a block whose head is an at-rule that holds rules
 * (`@media`, `@supports`, `@container`, `@layer`) is recursed into; one that holds
 * declarations (`@keyframes`, `@font-face`, `@page`, `@property`) is copied through; a
 * selector list is split on commas and each part prefixed, except `:root`, `html` and `body`,
 * which no prefix could make true.
 */
const RULE_HOLDERS = /^@(media|supports|container|layer)\b/
const GLOBAL_SELECTOR = /^(:root|html|body)(\b|$)/

export function scopeCss(css: string, prefix: string): string {
  return scopeBlock(css.replace(/\/\*[\s\S]*?\*\//g, ''), prefix).trim()
}

function scopeBlock(text: string, prefix: string): string {
  let out = ''
  let rest = text
  for (;;) {
    const open = rest.indexOf('{')
    if (open < 0) {
      // Whatever is left is statements (`@import …;`) or noise; keep the statements.
      out += rest.trim() ? rest : ''
      return out
    }
    const close = matchingBrace(rest, open)
    if (close < 0) return out // unbalanced: keep what parsed, drop the tail
    let head = rest.slice(0, open)
    const body = rest.slice(open + 1, close)
    rest = rest.slice(close + 1)

    // Statements before the head (`@import x; .a`) pass through untouched.
    const lastStatement = head.lastIndexOf(';')
    if (lastStatement >= 0) {
      out += head.slice(0, lastStatement + 1) + ' '
      head = head.slice(lastStatement + 1)
    }
    head = head.trim()

    if (head.startsWith('@')) {
      // A recursed body comes back with its own leading selector already trimmed, so the space
      // after the brace is put back here; a copied one still carries the author's spacing.
      out += RULE_HOLDERS.test(head)
        ? `${head} { ${scopeBlock(body, prefix)}} `
        : `${head} {${body}} `
      continue
    }

    const selectors = head
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (GLOBAL_SELECTOR.test(s) ? s : `${prefix} ${s}`))
    out += `${selectors.join(', ')} {${body}} `
  }
}

function matchingBrace(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return i
  }
  return -1
}
