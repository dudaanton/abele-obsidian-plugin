import type { WordPackage, WordParagraph } from './package'
import { escapeXml, preserveXmlSpace, type Patch } from './xml'
import { assertPlain, isEmptyNode, nodeWithContent, textRun } from './structure'

/** Text-range primitives shared by the dispatcher, paragraph and image operations. */
export function validText(text: unknown): asserts text is string {
  if (
    typeof text !== 'string' ||
    text.length > 100_000 ||
    Array.from(text).some((char) => {
      const n = char.codePointAt(0)!
      return (
        (n < 32 && ![9, 10, 13].includes(n)) ||
        (n >= 0xd800 && n <= 0xdfff) ||
        n === 0xfffe ||
        n === 0xffff
      )
    })
  )
    throw new Error('Invalid or excessively long Word text')
  if (/[\r\n\t]/.test(text))
    throw new Error('Use paragraph operations for new lines; tabs are not plain run text')
}
export function textPatches(
  doc: WordPackage,
  p: WordParagraph,
  start: number,
  end: number,
  replacement: string
): Patch[] {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > p.text.length
  )
    throw new Error('Invalid text range')
  for (const at of [start, end])
    if (
      at > 0 &&
      at < p.text.length &&
      /[\ud800-\udbff]/.test(p.text[at - 1]) &&
      /[\udc00-\udfff]/.test(p.text[at])
    )
      throw new Error('Range splits a Unicode character')
  validText(replacement)
  // Equality is a range-level no-op: redistributing equal text would still change its formatting.
  if (p.text.slice(start, end) === replacement) return []
  const touched = p.runs
    .filter((r) =>
      end > start
        ? r.offset < end && r.offset + r.text.length > start
        : r.offset <= start && r.offset + r.text.length >= start
    )
    .slice(0, end === start ? 1 : undefined)
  if (!touched.length) {
    if (start === 0 && end === 0 && !p.text) {
      assertPlain(p)
      if (!replacement) return []
      const source = doc.xml.get(p.part)!
      if (isEmptyNode(source, p.node))
        return [
          {
            start: p.node.start,
            end: p.node.end,
            text: nodeWithContent(source, p.node, textRun(replacement)),
          },
        ]
      return [{ start: p.node.closeStart, end: p.node.closeStart, text: textRun(replacement) }]
    }
    throw new Error('No editable text at this position')
  }
  if (touched.some((r) => r.protected))
    throw new Error('Protected revisions and fields are read-only')
  if (
    end > start &&
    touched
      .map((r) =>
        r.text.slice(Math.max(0, start - r.offset), Math.min(r.text.length, end - r.offset))
      )
      .join('') !== p.text.slice(start, end)
  )
    throw new Error('Range crosses a non-text element')
  const source = doc.xml.get(p.part)!
  const patches: Patch[] = []
  touched.forEach((r, i) => {
    const from = Math.max(0, start - r.offset)
    const to = Math.max(from, Math.min(r.text.length, end - r.offset))
    const next = r.text.slice(0, from) + (i === 0 ? replacement : '') + r.text.slice(to)
    if (next === r.text) return
    if (isEmptyNode(source, r.node)) {
      let open = source.slice(r.node.start, r.node.openEnd).replace(/\/\s*>$/, '>')
      if (/^\s|\s$/.test(next) && r.node.attrs['xml:space'] !== 'preserve')
        open = preserveXmlSpace(open)
      patches.push({
        start: r.node.start,
        end: r.node.end,
        text: open + escapeXml(next) + `</${r.node.name}>`,
      })
      return
    }
    patches.push({ start: r.node.openEnd, end: r.node.closeStart, text: escapeXml(next) })
    if (/^\s|\s$/.test(next) && r.node.attrs['xml:space'] !== 'preserve') {
      const open = source.slice(r.node.start, r.node.openEnd)
      patches.push({
        start: r.node.start,
        end: r.node.openEnd,
        text: preserveXmlSpace(open),
      })
    }
  })
  return patches
}
