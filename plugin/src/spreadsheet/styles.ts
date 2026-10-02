import { descendants, type XmlNode } from '@/ooxml/xml'
export const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
export const sc = (node: XmlNode | undefined, local: string) =>
  node?.children.find((n) => n.ns === S && n.local === local)
export const builtinFormats: Record<number, string> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  14: 'mm-dd-yy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yy h:mm',
  49: '@',
}
export interface CellStyle {
  bold: boolean
  italic: boolean
  fill?: string
  numberFormat: string
}
export const defaultStyle: CellStyle = { bold: false, italic: false, numberFormat: 'General' }
const enabled = (n: XmlNode | undefined) => !!n && !['0', 'false'].includes(n.attrs.val)
export function readStyles(root?: XmlNode): CellStyle[] {
  if (!root) return [defaultStyle]
  const formats = new Map(
    descendants(root, S, 'numFmt').map((n) => [Number(n.attrs.numFmtId), n.attrs.formatCode])
  )
  const fonts = sc(root, 'fonts')?.children ?? []
  const fills = sc(root, 'fills')?.children ?? []
  return (sc(root, 'cellXfs')?.children ?? []).map((xf) => {
    const font = fonts[Number(xf.attrs.fontId || 0)]
    const fill = sc(fills[Number(xf.attrs.fillId || 0)], 'patternFill')
    const rgb = sc(fill, 'fgColor')?.attrs.rgb
    return {
      bold: enabled(sc(font, 'b')),
      italic: enabled(sc(font, 'i')),
      fill:
        fill?.attrs.patternType === 'solid' && /^[0-9a-f]{8}$/i.test(rgb ?? '')
          ? '#' + rgb.slice(2)
          : undefined,
      numberFormat:
        formats.get(Number(xf.attrs.numFmtId)) ??
        builtinFormats[Number(xf.attrs.numFmtId || 0)] ??
        'General',
    }
  })
}
export type CellValue = string | number | boolean | null
/** Common formats only; unsupported/custom patterns retain the underlying value. */
export function formatValue(value: CellValue, pattern: string, date1904: boolean): string {
  if (value === null) return ''
  if (typeof value !== 'number')
    return typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : value
  const clean = pattern.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '').split(';')[0]
  if (/[ydhms]/i.test(clean) && !/[eE][+-]/.test(clean)) {
    const days = date1904 ? value : value >= 60 ? value - 1 : value
    const epoch = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 31)
    const date = new Date(epoch + Math.round(days * 86400000))
    if (!Number.isFinite(date.getTime())) return String(value)
    const iso = date.toISOString()
    const time = /h|s/i.test(clean)
    return /y|d/i.test(clean)
      ? iso.slice(0, 10) + (time ? ' ' + iso.slice(11, 19) : '')
      : iso.slice(11, /s/i.test(clean) ? 19 : 16)
  }
  const decimals = /\.([0#]+)/.exec(clean)?.[1].length ?? 0
  if (/[0#]/.test(clean)) {
    const percent = clean.includes('%')
    const number = (percent ? value * 100 : value).toLocaleString('en-US', {
      minimumFractionDigits: Math.min(decimals, 10),
      maximumFractionDigits: Math.min(decimals, 10),
      useGrouping: clean.includes(','),
    })
    const currency = /^["']?([$€£])/.exec(pattern)?.[1] ?? ''
    return currency + number + (percent ? '%' : '')
  }
  return String(value)
}
