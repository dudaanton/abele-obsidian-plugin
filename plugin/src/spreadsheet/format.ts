import { PackageMutation, nodeWithContent, setAttributes } from '@/ooxml/mutation'
import { escapeXml, parseXml, patchXml, R, REL } from '@/ooxml/xml'
import { cellAddress, parseRange } from './address'
import { assertEditable, expandDimension, patchCells, sTag, validText } from './edit'
import { type Workbook } from './package'
import { builtinFormats, S, sc } from './styles'
export interface CellFormat {
  bold?: boolean
  italic?: boolean
  fill?: string
  number_format?: string
}
export interface FormatEdit {
  sheet: string
  range: string
  format: CellFormat
}
const defaultStyles = `<styleSheet xmlns="${S}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
const styleOrder = [
  'numFmts',
  'fonts',
  'fills',
  'borders',
  'cellStyleXfs',
  'cellXfs',
  'cellStyles',
  'dxfs',
  'tableStyles',
  'colors',
  'extLst',
]
async function appendRecord(
  mutation: PackageMutation,
  part: string,
  collection: string,
  fragment: string
): Promise<number> {
  const source = mutation.source(part)
  const root = await parseXml(source)
  const group = sc(root, collection)
  const count = group?.children.length ?? 0
  if (count >= 64000) throw new Error('Workbook style record limit exceeded')
  if (group) {
    const next = nodeWithContent(
      source,
      group,
      source.slice(group.openEnd, group.closeStart) + fragment
    )
    const updated = setAttributes(
      next,
      {
        ...group,
        start: 0,
        openEnd: source.slice(group.start, group.openEnd).replace(/\/\s*>$/, '>').length,
        end: next.length,
      },
      { count: String(count + 1) }
    )
    mutation.set(part, patchXml(source, [{ start: group.start, end: group.end, text: updated }]))
  } else {
    const next = root.children.find(
      (n) => styleOrder.indexOf(n.local) > styleOrder.indexOf(collection)
    )
    const at = next?.start ?? root.closeStart
    mutation.set(
      part,
      patchXml(source, [{ start: at, end: at, text: sTag(collection, fragment, 'count="1"') }])
    )
  }
  return count
}
export async function applyWorkbookFormat(book: Workbook, edit: FormatEdit): Promise<Uint8Array> {
  const range = parseRange(edit.range, 1000)
  const format = edit.format
  if (
    !format ||
    typeof format !== 'object' ||
    !Object.keys(format).length ||
    Object.keys(format).some((k) => !['bold', 'italic', 'fill', 'number_format'].includes(k))
  )
    throw new Error('Name basic cell formatting')
  for (const key of ['bold', 'italic'] as const)
    if (format[key] !== undefined && typeof format[key] !== 'boolean')
      throw new Error('Bold/italic must be boolean')
  if (
    format.fill !== undefined &&
    (typeof format.fill !== 'string' ||
      (format.fill !== '' && !/^#[0-9a-f]{6}$/i.test(format.fill)))
  )
    throw new Error('Fill colour must be #RRGGBB or empty to clear')
  if (format.number_format !== undefined) {
    if (
      typeof format.number_format !== 'string' ||
      !format.number_format.length ||
      format.number_format.length > 255
    )
      throw new Error('Number format must be 1–255 characters')
    validText(format.number_format)
  }
  const sheet = await book.sheet(edit.sheet)
  const addresses = []
  for (let r = range.from.row; r <= range.to.row; r++)
    for (let c = range.from.column; c <= range.to.column; c++) addresses.push(cellAddress(r, c))
  assertEditable(book, sheet, addresses, false)
  const mutation = new PackageMutation(book)
  let part = book.stylesPart
  if (!part) {
    const folder = book.workbookPart.split('/').slice(0, -1).join('/')
    let n = 1
    part = `${folder}/abele-styles-${n}.xml`
    while (book.archive.loadBytes(part)) part = `${folder}/abele-styles-${++n}.xml`
    mutation.set(part, defaultStyles)
  }
  const baseSource = mutation.source(part)
  const baseRoot = await parseXml(baseSource)
  const xfs = sc(baseRoot, 'cellXfs')?.children ?? []
  const fonts = sc(baseRoot, 'fonts')?.children ?? []
  const changes = new Map<string, string>()
  const styles = new Map<number, number>()
  for (const address of addresses) {
    const cell = sheet.cells.get(address)
    const styleId = cell?.styleId ?? 0
    const original = cell?.style ?? book.styles[0]
    const xf = xfs[styleId]
    if (!xf) throw new Error('Missing cell style record')
    const desiredFill = format.fill?.toUpperCase()
    const same =
      (format.bold === undefined || format.bold === original.bold) &&
      (format.italic === undefined || format.italic === original.italic) &&
      (format.fill === undefined ||
        (desiredFill
          ? original.fill?.toUpperCase() === desiredFill
          : Number(xf.attrs.fillId || 0) === 0)) &&
      (format.number_format === undefined || format.number_format === original.numberFormat)
    if (same) continue
    let nextId = styles.get(styleId)
    if (nextId === undefined) {
      const attrs: Record<string, string> = {}
      if (format.bold !== undefined || format.italic !== undefined) {
        const font = fonts[Number(xf.attrs.fontId || 0)]
        if (!font) throw new Error('Missing font record')
        const patches = font.children
          .filter(
            (n) =>
              n.ns === S &&
              ((n.local === 'b' && format.bold !== undefined) ||
                (n.local === 'i' && format.italic !== undefined))
          )
          .map((n) => ({ start: n.start - font.openEnd, end: n.end - font.openEnd, text: '' }))
        const content =
          patchXml(baseSource.slice(font.openEnd, font.closeStart), patches) +
          (format.bold ? sTag('b') : '') +
          (format.italic ? sTag('i') : '')
        const fontId = await appendRecord(
          mutation,
          part,
          'fonts',
          nodeWithContent(baseSource, font, content)
        )
        attrs.fontId = String(fontId)
        attrs.applyFont = '1'
      }
      if (format.fill !== undefined) {
        attrs.fillId = desiredFill
          ? String(
              await appendRecord(
                mutation,
                part,
                'fills',
                sTag(
                  'fill',
                  `<patternFill patternType="solid"><fgColor rgb="FF${desiredFill.slice(1)}"/><bgColor indexed="64"/></patternFill>`
                )
              )
            )
          : '0'
        attrs.applyFill = '1'
      }
      if (format.number_format !== undefined) {
        const builtin = Object.entries(builtinFormats).find(
          ([, code]) => code === format.number_format
        )
        if (builtin) attrs.numFmtId = builtin[0]
        else {
          const source = mutation.source(part)
          const root = await parseXml(source)
          const formats = sc(root, 'numFmts')?.children ?? []
          const existing = formats.find((n) => n.attrs.formatCode === format.number_format)
          const id = existing
            ? Number(existing.attrs.numFmtId)
            : Math.max(163, ...formats.map((n) => Number(n.attrs.numFmtId))) + 1
          if (id > 65535) throw new Error('Number format ID limit exceeded')
          if (!existing)
            await appendRecord(
              mutation,
              part,
              'numFmts',
              sTag('numFmt', '', `numFmtId="${id}" formatCode="${escapeXml(format.number_format)}"`)
            )
          attrs.numFmtId = String(id)
        }
        attrs.applyNumberFormat = '1'
      }
      nextId = await appendRecord(mutation, part, 'cellXfs', setAttributes(baseSource, xf, attrs))
      styles.set(styleId, nextId)
    }
    changes.set(
      address,
      cell
        ? setAttributes(sheet.source, cell.node, { s: String(nextId) })
        : sTag('c', '', `r="${address}" s="${nextId}"`)
    )
  }
  if (!changes.size) return book.original
  mutation.set(
    sheet.part,
    await expandDimension(
      patchCells(sheet, changes),
      Math.max(sheet.maxRow, range.to.row),
      Math.max(sheet.maxColumn, range.to.column),
      range.from.row,
      range.from.column
    )
  )
  if (!book.stylesPart) {
    const relSource = mutation.source(book.relsPart)
    const rels = await parseXml(relSource)
    let i = 1
    while (rels.children.some((n) => n.attrs.Id === `abeleStyles${i}`)) i++
    await mutation.append(
      book.relsPart,
      `<Relationship xmlns="${REL}" Id="abeleStyles${i}" Type="${R}/styles" Target="${part.split('/').at(-1)}"/>`
    )
    await mutation.ensureType(
      part,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'
    )
  }
  return mutation.finish()
}
