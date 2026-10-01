/** Structural CSS tokens outside strings, comments and escapes. No CSSOM or host API. */
export function* cssTokens(text: string): Generator<{ index: number; char: string }> {
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '\\') {
      i++
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end < 0) return
      i = end + 1
      continue
    }
    yield { index: i, char }
  }
}

export function stripCssComments(text: string): string {
  let out = '',
    from = 0,
    quote = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '\\') {
      i++
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '/' && text[i + 1] === '*') {
      out += text.slice(from, i)
      const end = text.indexOf('*/', i + 2)
      if (end < 0) return out
      i = end + 1
      from = i + 1
    }
  }
  return out + text.slice(from)
}

/** Split only outside functional selectors/URLs and attribute selectors. */
export function splitCss(text: string, separator: string): string[] {
  const parts: string[] = []
  let from = 0,
    parentheses = 0,
    brackets = 0
  for (const { index, char } of cssTokens(text)) {
    if (char === '(') parentheses++
    else if (char === ')') parentheses--
    else if (char === '[') brackets++
    else if (char === ']') brackets--
    else if (char === separator && parentheses === 0 && brackets === 0) {
      parts.push(text.slice(from, index))
      from = index + 1
    }
  }
  parts.push(text.slice(from))
  return parts
}

export function cssBlockEnd(text: string, open: number): number {
  let depth = 0
  for (const { index, char } of cssTokens(text.slice(open))) {
    if (char === '{') depth++
    else if (char === '}' && --depth === 0) return open + index
  }
  return -1
}

export function decodeCssEscapes(text: string): string {
  return text.replace(/\\([0-9a-f]{1,6}[ \t\r\n\f]?|[^\r\n\f])/gi, (_match, escaped: string) => {
    if (/^[0-9a-f]/i.test(escaped)) {
      const code = parseInt(escaped.trim(), 16)
      return String.fromCodePoint(code === 0 || code > 0x10ffff ? 0xfffd : code)
    }
    return escaped
  })
}
