import { cssBlockEnd, cssTokens, decodeCssEscapes, splitCss, stripCssComments } from './cssSyntax'

/** Confines selectors to one root. Declaration at-rules remain unchanged; callers embedding
 * imported sheets must resolve their imports before scoping, rather than emitting raw @import.
 * Strings, escapes and functional/attribute selectors are walked without interpreting their
 * punctuation as rules. This stays independent of CSSOM and Obsidian's extended DOM.
 */
const DECLARATION_HOLDERS =
  /^@(-[a-z]+-)?(keyframes|font-face|page|property|counter-style|font-feature-values)\b/i
const GLOBAL_SELECTOR = /^(:root|html|body)$/

export interface ScopeCssOptions {
  /** Also let ordinary selectors address classes on the root itself, not only descendants. */
  includeRoot?: boolean
}

export function scopeCss(css: string, prefix: string, options: ScopeCssOptions = {}): string {
  return scopeBlock(stripCssComments(css), prefix, options).trim()
}

function scopeBlock(text: string, prefix: string, options: ScopeCssOptions): string {
  let out = '',
    rest = text
  for (;;) {
    let delimiter = -1,
      parentheses = 0,
      brackets = 0
    for (const { index, char } of cssTokens(rest)) {
      if (char === '(') parentheses++
      else if (char === ')') parentheses--
      else if (char === '[') brackets++
      else if (char === ']') brackets--
      else if ((char === '{' || char === ';') && parentheses === 0 && brackets === 0) {
        delimiter = index
        break
      }
    }
    if (delimiter < 0) return out + rest
    if (rest[delimiter] === ';') {
      out += rest.slice(0, delimiter + 1) + ' '
      rest = rest.slice(delimiter + 1)
      continue
    }
    const close = cssBlockEnd(rest, delimiter)
    if (close < 0) return out
    const head = rest.slice(0, delimiter).trim(),
      body = rest.slice(delimiter + 1, close)
    rest = rest.slice(close + 1)
    if (head.startsWith('@')) {
      out += DECLARATION_HOLDERS.test(decodeCssEscapes(head))
        ? `${head} {${body}} `
        : `${head} { ${scopeBlock(body, prefix, options)}} `
      continue
    }
    const selectors = splitCss(head, ',')
      .map((s) => s.trim())
      .filter(Boolean)
      .flatMap((selector) => {
        if (GLOBAL_SELECTOR.test(selector)) return [prefix]
        const descendant = `${prefix} ${selector}`
        // Keep the usual ancestor prefix, and add a target-bounded alternative. Appending the
        // boundary to the *target* (not its first compound) prevents sibling combinators escaping.
        return options.includeRoot
          ? [descendant, rootAlias(selector, prefix), boundTarget(selector, prefix)].filter(Boolean)
          : [descendant]
      })
    out += `${selectors.join(', ')} {${body}} `
  }
}

/** A conventional root-class selector also gets a simple prefixed form. This keeps the usual
 * prefix specificity for common deck classes and works in selector engines without complex
 * :where support. A sibling directly off the root is deliberately not emitted. */
function rootAlias(selector: string, prefix: string): string {
  if (!/^[.#[:]/.test(selector)) return ''
  let parentheses = 0,
    brackets = 0,
    end = selector.length
  for (const { index, char } of cssTokens(selector)) {
    if (char === '(') parentheses++
    else if (char === ')') parentheses--
    else if (char === '[') brackets++
    else if (char === ']') brackets--
    else if (parentheses === 0 && brackets === 0 && /[\s>+~|]/.test(char)) {
      end = index
      break
    }
  }
  const rest = selector.slice(end)
  if (/^[+~|]/.test(rest.trimStart())) return ''
  return prefix + selector.slice(0, end) + rest
}

function boundTarget(selector: string, prefix: string): string {
  let parentheses = 0,
    brackets = 0,
    pseudoElement = selector.length
  for (const { index, char } of cssTokens(selector)) {
    if (char === '(') parentheses++
    else if (char === ')') parentheses--
    else if (char === '[') brackets++
    else if (char === ']') brackets--
    else if (
      char === ':' &&
      parentheses === 0 &&
      brackets === 0 &&
      (selector[index + 1] === ':' ||
        /^:(before|after|first-line|first-letter)\b/.test(selector.slice(index)))
    ) {
      pseudoElement = index
      break
    }
  }
  return `${selector.slice(0, pseudoElement)}:where(${prefix}, ${prefix} *)${selector.slice(pseudoElement)}`
}
