/**
 * Confines a script's CSS to one view by prefixing every selector with the view's root.
 *
 * Written over text, not CSSOM: Obsidian on an older iOS WebView reads nested CSS only in its
 * strict form, and happy-dom parses no stylesheet, so the browser's parser is the one thing
 * this cannot rely on. Braces are walked; a block at-rule is recursed into unless it is one of the
 * few known to hold declarations rather than rules (`@keyframes`, `@font-face`, `@page`,
 * `@property`, `@counter-style`, `@font-feature-values`, and their vendor spellings), which is
 * copied through. The list is a deny-list on purpose: an at-rule nobody here has heard of yet —
 * `@starting-style`, `@scope` — holds rules far more often than declarations, and guessing
 * wrong the other way lets a script's selectors out of its tab.
 *
 * A selector list is split on commas and each part prefixed. A selector that is exactly
 * `:root`, `html` or `body` is *replaced* by the prefix rather than prefixed: emitted as written
 * it would reach the whole app — `body { display: none }` blanks Obsidian — and a custom
 * property declared on `:root` is what the script meant to put on its own root. Anything longer
 * is prefixed as written, so `body .post` becomes `<prefix> body .post` and matches nothing —
 * a leak closed rather than a feature lost, since everything the script drew is inside the view
 * and `.post` alone already reaches it.
 *
 * The walk is naive about strings: a brace or a comma inside a quoted value (`content: "a,b"`,
 * `content: "}"`) is read as structure and will confuse it. Scripts that need such a value can
 * write it escaped (`content: "\007D"`).
 */
const DECLARATION_HOLDERS =
  /^@(-[a-z]+-)?(keyframes|font-face|page|property|counter-style|font-feature-values)\b/i
const GLOBAL_SELECTOR = /^(:root|html|body)$/

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
      out += DECLARATION_HOLDERS.test(head)
        ? `${head} {${body}} `
        : `${head} { ${scopeBlock(body, prefix)}} `
      continue
    }

    const selectors = head
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (GLOBAL_SELECTOR.test(s) ? prefix : `${prefix} ${s}`))
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
