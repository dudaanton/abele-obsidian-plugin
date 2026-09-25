/**
 * The amount field's calculator: `+ − × ÷` and brackets over decimal numbers, parsed here and
 * nowhere near `eval`. A comma is a decimal point, as a phone's number pad writes it in much of
 * the world, and spaces are ignored, so `1 234,50` is what it looks like.
 */

/** Precision an answer is kept at: enough for any currency, and no floating-point crumbs. */
const PRECISION = 1e8

const OPERATORS: Record<string, string> = { '−': '-', '×': '*', '÷': '/', x: '*' }

function normalise(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[−×÷]/g, (op) => OPERATORS[op])
    .replace(/,/g, '.')
}

/** Whether the text is a sum to work out rather than a number as it stands. */
export function isArithmetic(text: string): boolean {
  const t = normalise(text)
  return /[+\-*/()]/.test(t.replace(/^-/, ''))
}

/** The value of the text, or `null` when it is not arithmetic this field understands. */
export function evaluateAmount(text: string): number | null {
  const src = normalise(text)
  if (!src) return null
  let pos = 0

  const peek = () => src[pos]

  // expr := term (('+' | '-') term)*
  const expr = (): number | null => {
    let left = term()
    while (left !== null && (peek() === '+' || peek() === '-')) {
      const op = src[pos++]
      const right = term()
      if (right === null) return null
      left = op === '+' ? left + right : left - right
    }
    return left
  }

  // term := factor (('*' | '/') factor)*
  const term = (): number | null => {
    let left = factor()
    while (left !== null && (peek() === '*' || peek() === '/')) {
      const op = src[pos++]
      // `**` is not a power here, only a typo.
      if (peek() === '*' || peek() === '/') return null
      const right = factor()
      if (right === null) return null
      if (op === '/' && right === 0) return null
      left = op === '*' ? left * right : left / right
    }
    return left
  }

  // factor := '-' factor | '(' expr ')' | number
  const factor = (): number | null => {
    if (peek() === '-') {
      pos++
      const value = factor()
      return value === null ? null : -value
    }
    if (peek() === '+') {
      pos++
      return factor()
    }
    if (peek() === '(') {
      pos++
      const value = expr()
      if (value === null || peek() !== ')') return null
      pos++
      return value
    }
    const match = /^\d+(\.\d+)?|^\.\d+/.exec(src.slice(pos))
    if (!match) return null
    pos += match[0].length
    return Number(match[0])
  }

  const value = expr()
  if (value === null || pos !== src.length || !Number.isFinite(value)) return null
  return Math.round(value * PRECISION) / PRECISION
}
