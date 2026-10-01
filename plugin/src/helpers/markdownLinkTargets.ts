/** Target tokens in inline Markdown links and reference definitions, without their labels. */
export function markdownLinkTargets(
  text: string
): { start: number; end: number; labelStart: number }[] {
  const targets: { start: number; end: number; labelStart: number }[] = []
  const labels: number[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      i++
      continue
    }
    if (text[i] === '[') {
      labels.push(i)
      continue
    }
    if (text[i] !== ']' || !labels.length) continue
    const labelStart = labels.pop()!
    const next = text[i + 1]
    if (next !== '(' && next !== ':') continue
    let start = i + 2
    while (start < text.length && /\s/.test(text[start])) start++
    const angle = text[start] === '<'
    if (angle) start++
    let end = start
    let depth = 0
    for (; end < text.length; end++) {
      const c = text[end]
      if (c === '\\') {
        end++
        continue
      }
      if (angle) {
        if (c === '>' || c === '\n') break
      } else {
        if (c === '(') depth++
        else if (c === ')') {
          if (depth === 0) break
          depth--
        } else if (/\s/.test(c)) break
      }
    }
    if (end > start && depth === 0 && (!angle || text[end] === '>')) {
      targets.push({ start, end, labelStart })
      i = end - 1
    }
  }
  return targets
}
