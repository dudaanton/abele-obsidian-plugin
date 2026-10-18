// Reading a value the program holds: what it looks like (JSON, XML, plain text) and the same text
// laid out to read, one element or key per line. Nothing here runs the value.
import { t } from '@/i18n'

export type ValueFormat = 'json' | 'xml' | 'text'

/** Only retained text; opening this value never evaluates an expression. */
export function wholeValue(value: string, full?: string): string | undefined {
  return full ?? (value.length > 80 && detectFormat(value) !== 'text' ? value : undefined)
}

export function detectFormat(text: string): ValueFormat {
  const t = text.trim()
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      JSON.parse(t)
      return 'json'
    } catch {
      return 'text'
    }
  }
  if (t.startsWith('<') && t.endsWith('>')) return 'xml'
  return 'text'
}

/** The text laid out to read, or the text as it is when it cannot be read as its format. */
export function formatValue(text: string, format: ValueFormat): string {
  if (format === 'json') {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return text
    }
  }
  if (format === 'xml') return formatXml(text)
  return text
}

function formatXml(text: string): string {
  // Keep significant text-node spacing exact; indentation would change its meaning.
  const nodes: string[] = text.match(/>[^<]+</g) ?? []
  if (
    nodes.some(
      (node) => /\S/.test(node.slice(1, -1)) && node.slice(1, -1).trim() !== node.slice(1, -1)
    )
  )
    return text
  const parts = text.replace(/>\s*</g, '><').match(/<[^>]*>|[^<]+/g) ?? []
  const out: string[] = []
  let depth = 0
  for (const raw of parts) {
    const part = raw.trim()
    if (!part) continue
    if (/^<\//.test(part)) depth = Math.max(0, depth - 1)
    // A text node goes on the line of the element that holds it.
    if (!part.startsWith('<') && out.length) {
      out[out.length - 1] += part
      continue
    }
    if (
      /^<\//.test(part) &&
      out.length &&
      !out[out.length - 1].trim().startsWith('</') &&
      !/\/>$/.test(out[out.length - 1]) &&
      /^\s*<([^/!?\s>]+)[^>]*>[^<]*$/.exec(out[out.length - 1])?.[1] ===
        /^<\/([^\s>]+)>$/.exec(part)?.[1]
    ) {
      out[out.length - 1] += part
      continue
    }
    out.push(`${'  '.repeat(depth)}${part}`)
    if (/^<[^/!?][^>]*[^/]>$/.test(part) || /^<[^/!?]>$/.test(part)) depth++
  }
  return out.join('\n')
}

/** How big a value is, said as it should read. */
export function sizeOf(text: string): string {
  const bytes = new TextEncoder().encode(text).length
  const lines = text.split('\n').length
  const size = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
  return lines > 1 ? t('streamC.valueLines', { size, count: lines }) : size
}
