import type { WordEdit } from './edit'
import { textPatches, validText } from './edit'
import type { WordParagraph } from './package'
import { WordMutation } from './mutation'
import {
  assertPlain,
  isEmptyNode,
  nodeWithContent,
  inlineSlice,
  paragraphWith,
  newParagraphWith,
  propertyPatches,
  renderTextRun,
  textRun,
  wTag,
} from './structure'
import {
  ancestor,
  attr,
  child,
  descendants,
  escapeXml,
  isW,
  parseXml,
  patchXml,
  rawNode,
  R,
  W,
  type Patch,
} from './xml'

export async function paragraphOperation(
  m: WordMutation,
  p: WordParagraph,
  e: WordEdit
): Promise<Patch[]> {
  const doc = m.doc
  const source = doc.xml.get(p.part)!
  assertPlain(p)
  if (e.operation === 'format') {
    const names: Record<string, string> = {
      bold: 'b',
      italic: 'i',
      underline: 'u',
      strike: 'strike',
    }
    const name = names[e.format ?? '']
    if (!name || typeof e.enabled !== 'boolean')
      throw new Error('Choose a format and enabled true/false')
    const from = e.from ?? 0
    const to = e.to ?? p.text.length
    if (to <= from) throw new Error('Select a nonempty text range')
    textPatches(doc, p, from, to, p.text.slice(from, to))
    return p.runs
      .filter((r) => r.offset < to && r.offset + r.text.length > from)
      .map((r) => {
        const a = Math.max(0, from - r.offset)
        const b = Math.min(r.text.length, to - r.offset)
        const before = a ? renderTextRun(doc, r, r.text.slice(0, a)) : ''
        const selected = renderTextRun(doc, r, r.text.slice(a, b), { name, enabled: e.enabled! })
        const after = b < r.text.length ? renderTextRun(doc, r, r.text.slice(b)) : ''
        return { start: r.run!.start, end: r.run!.end, text: before + selected + after }
      })
  }
  if (e.operation === 'style') {
    if (!doc.styles.some((s) => s.id === e.style_id))
      throw new Error('Choose an existing paragraph style')
    return propertyPatches(
      source,
      p.node,
      'pPr',
      'pStyle',
      wTag('pStyle', '', `w:val="${escapeXml(e.style_id!)}"`)
    )
  }
  if (e.operation === 'list') {
    if (e.list === 'none') return propertyPatches(source, p.node, 'pPr', 'numPr', null)
    if (!['bullet', 'decimal'].includes(e.list ?? ''))
      throw new Error('Choose bullet, decimal or none')
    const name = 'word/numbering.xml'
    const original = doc.archive.loadText(name)
    const numbering = original ?? `<w:numbering xmlns:w="${W}"></w:numbering>`
    const root = await parseXml(numbering)
    const abstract = descendants(root, W, 'abstractNum').find((n) =>
      n.children.some(
        (lvl) =>
          isW(lvl, 'lvl') &&
          attr(lvl, 'ilvl') === '0' &&
          attr(child(lvl, 'numFmt'), 'val') === e.list
      )
    )
    let num = abstract
      ? descendants(root, W, 'num').find(
          (n) => attr(child(n, 'abstractNumId'), 'val') === attr(abstract, 'abstractNumId')
        )
      : undefined
    let id = num ? attr(num, 'numId')! : ''
    if (!num) {
      const ids = descendants(root, W, 'num').map((n) => Number(attr(n, 'numId') || 0))
      const abstractIds = descendants(root, W, 'abstractNum').map((n) =>
        Number(attr(n, 'abstractNumId') || 0)
      )
      id = String(Math.max(0, ...ids) + 1)
      const aid = String(Math.max(-1, ...abstractIds) + 1)
      const definition = wTag(
        'abstractNum',
        `<w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${e.list}"/><w:lvlText w:val="${e.list === 'bullet' ? '•' : '%1.'}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>`,
        `w:abstractNumId="${aid}"`
      )
      // abstractNum precedes num in the numbering schema; preserve existing definitions.
      const firstNum = root.children.find((n) => isW(n, 'num'))
      m.set(
        name,
        isEmptyNode(numbering, root)
          ? nodeWithContent(numbering, root, definition)
          : patchXml(numbering, [
              {
                start: firstNum?.start ?? root.closeStart,
                end: firstNum?.start ?? root.closeStart,
                text: definition,
              },
            ])
      )
      await m.append(name, wTag('num', `<w:abstractNumId w:val="${aid}"/>`, `w:numId="${id}"`))
      if (!original) {
        await m.relation('numbering.xml', `${R}/numbering`)
        await m.ensureType(
          name,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'
        )
      }
    }
    return propertyPatches(
      source,
      p.node,
      'pPr',
      'numPr',
      wTag('numPr', `<w:ilvl w:val="0"/><w:numId w:val="${id}"/>`)
    )
  }
  if (e.operation === 'paragraph_add') {
    validText(e.text ?? '')
    return [
      {
        start: p.node.end,
        end: p.node.end,
        text: newParagraphWith(doc, p, textRun(e.text ?? '')),
      },
    ]
  }
  if (e.operation === 'paragraph_split') {
    const at = e.offset ?? 0
    if (!Number.isInteger(at) || at < 0 || at > p.text.length)
      throw new Error('Invalid split offset')
    if (at > 0 && at < p.text.length) textPatches(doc, p, at, at, '')
    const originalInline = p.node.children
      .filter((n) => !isW(n, 'pPr'))
      .map((n) => rawNode(source, n))
      .join('')
    const left = paragraphWith(
      doc,
      p,
      at === p.text.length ? originalInline : inlineSlice(doc, p, 0, at)
    )
    const right = newParagraphWith(
      doc,
      p,
      at === p.text.length ? '' : at === 0 ? originalInline : inlineSlice(doc, p, at, p.text.length)
    )
    return [{ start: p.node.start, end: p.node.end, text: left + right }]
  }
  if (e.operation === 'paragraph_merge') {
    const siblings = p.node.parent!.children
    const next = siblings[siblings.indexOf(p.node) + 1]
    if (!next || !isW(next, 'p'))
      throw new Error('Only adjacent paragraphs in the same container can merge')
    const q = doc.paragraphs.find((n) => n.node === next)!
    assertPlain(q)
    let left = inlineSlice(doc, p, 0, p.text.length)
    let right = inlineSlice(doc, q, 0, q.text.length)
    const last = p.runs.at(-1)
    const first = q.runs[0]
    // Coalesce only equivalent direct boundary runs; differing formats and links stay separate.
    if (
      last?.run?.parent === p.node &&
      first?.run?.parent === q.node &&
      p.node.children.at(-1) === last.run &&
      q.node.children.find((n) => !isW(n, 'pPr')) === first.run
    ) {
      const signature = (r: typeof first) =>
        rawNode(source, r.run!).replace(rawNode(source, r.node), '#text')
      if (
        signature(last) === signature(first) &&
        Object.entries(last.node.attrs)
          .filter(([k]) => k !== 'xml:space')
          .toString() ===
          Object.entries(first.node.attrs)
            .filter(([k]) => k !== 'xml:space')
            .toString()
      ) {
        const value = last.text + first.text
        let combined = renderTextRun(doc, last, value)
        if (!/^\s|\s$/.test(value))
          combined = combined.replace(
            /(<[^>]*:t\b[^>]*?)\s+xml:space\s*=\s*(?:"[^"]*"|'[^']*')/,
            '$1'
          )
        left = left.slice(0, left.length - rawNode(source, last.run).length) + combined
        right = right.slice(rawNode(source, first.run).length)
      }
    }
    return [
      {
        start: p.node.start,
        end: next.end,
        text: paragraphWith(doc, p, left + right) + source.slice(p.node.end, next.start),
      },
    ]
  }
  if (e.operation === 'paragraph_delete') {
    if (p.node.parent!.children.filter((n) => isW(n, 'p')).length <= 1)
      throw new Error('Keep at least one paragraph in this container')
    return [{ start: p.node.start, end: p.node.end, text: '' }]
  }
  if (e.operation === 'link') {
    const from = e.from ?? 0
    const to = e.to ?? p.text.length
    if (to <= from) throw new Error('Select link text')
    textPatches(doc, p, from, to, p.text.slice(from, to))
    const selectedRuns = p.runs.filter((r) => r.offset < to && r.offset + r.text.length > from)
    const links = new Set(selectedRuns.map((r) => ancestor(r.node, 'hyperlink')))
    const existing = links.size === 1 ? [...links][0] : undefined
    if (existing) {
      const linked = p.runs.filter((r) => ancestor(r.node, 'hyperlink') === existing)
      if (linked[0].offset !== from || linked.at(-1)!.offset + linked.at(-1)!.text.length !== to)
        throw new Error('Select the whole existing link to edit or remove it')
      if (!e.url)
        return [
          {
            start: existing.start,
            end: existing.end,
            text: source.slice(existing.openEnd, existing.closeStart),
          },
        ]
    } else if ([...links].some(Boolean))
      throw new Error('Select one whole link, or text outside links')
    if (!e.url) throw new Error('No existing link to remove')
    let url: URL
    try {
      url = new URL(e.url)
    } catch {
      throw new Error('Invalid link URL')
    }
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol))
      throw new Error('Unsupported link URL')
    const id = await m.relation(e.url, `${R}/hyperlink`, true)
    const fragment = wTag(
      'hyperlink',
      existing
        ? source.slice(existing.openEnd, existing.closeStart)
        : inlineSlice(doc, p, from, to),
      `xmlns:r="${R}" r:id="${id}"`
    )
    return existing
      ? [{ start: existing.start, end: existing.end, text: fragment }]
      : [
          {
            start: p.node.start,
            end: p.node.end,
            text: paragraphWith(
              doc,
              p,
              inlineSlice(doc, p, 0, from) + fragment + inlineSlice(doc, p, to, p.text.length)
            ),
          },
        ]
  }
  throw new Error('Unknown paragraph operation')
}
