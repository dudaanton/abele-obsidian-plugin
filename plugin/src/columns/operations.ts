import { columnSource, type ColumnSource } from './source'
import { columnWeights } from './core'

export type ColumnTemplate = 'two' | 'three' | 'aside'
export type ColumnChange =
  | { type: 'add' }
  | { type: 'move'; index: number; to: number }
  | { type: 'options'; ratio: number[]; mobile: 'stack' | 'keep' }

export function columnFrames(text: string): ColumnSource[] {
  const frames: ColumnSource[] = []
  let from = 0
  for (const line of text.split('\n')) {
    if (/^\s*(?:>\s*)+\[!abele-columns(?:\||\])/.test(line)) {
      const record = columnSource(text, from)
      if (record) frames.push(record)
    }
    from += line.length + 1
  }
  return frames
}

export function findColumns(text: string, position: number): ColumnSource | null {
  return (
    columnFrames(text)
      .filter((frame) => position >= frame.from && position <= frame.to)
      .at(-1) ?? null
  )
}

/** Resolve a rendered quote path without equating identical text or metadata. */
export function descendantColumns(
  text: string,
  rootFrom: number,
  path: number[]
): ColumnSource | null {
  const frames = columnFrames(text)
  let frame = frames.find((candidate) => candidate.from === rootFrom)
  for (const index of path) {
    if (!frame) return null
    const parent = frame
    const children = frames.filter(
      (candidate) =>
        candidate.from > parent.from &&
        candidate.to <= parent.to &&
        !frames.some(
          (between) =>
            between.from > parent.from &&
            between.from < candidate.from &&
            between.to >= candidate.to
        )
    )
    frame = children[index]
  }
  return frame ?? null
}

function quoted(body: string, prefix: string): string {
  return body
    .split('\n')
    .map((line) => prefix + (line ? ' ' + line : ''))
    .join('\n')
}
function title(line: string): string {
  return /^\s*(?:>\s*)+\[![^\]]+\]\s*(.*)$/.exec(line)?.[1] ?? ''
}
function cleanBody(body: string): string {
  return body.replace(/\n+$/, '')
}

export function createColumns(selection: string, kind: ColumnTemplate): string {
  const count = kind === 'three' ? 3 : 2
  const ratio = kind === 'aside' ? '2:1' : Array(count).fill(1).join(':')
  return (
    '> [!abele-columns|ratio=' +
    ratio +
    ' mobile=stack]\n' +
    Array.from(
      { length: count },
      (_, i) =>
        '> > [!abele-column' +
        (kind === 'aside' && i === 1 ? '|role=aside' : '') +
        ']\n' +
        quoted(i === 0 ? selection : '', '> >')
    ).join('\n>\n')
  )
}

/** Replace only the parsed frame; the caller owns the editor/vault transaction. */
export function changeColumns(text: string, record: ColumnSource, change: ColumnChange): string {
  const parentTitle = title(text.slice(record.from).split('\n')[0])
  const columns = record.columns.map((c) => ({
    header: text.slice(c.from).split('\n')[0],
    body: cleanBody(c.body),
  }))
  let ratio = record.options.ratio
    ? [...record.options.ratio]
    : Array<number>(columns.length).fill(1)
  let mobile = record.options.mobile
  if (change.type === 'add') {
    columns.push({ header: '> '.repeat(record.depth + 1) + '[!abele-column]', body: '' })
    ratio = [...ratio, 1]
  }
  if (change.type === 'move') {
    if (!columns[change.index] || !columns[change.to]) throw Error('Choose an existing column.')
    const [column] = columns.splice(change.index, 1)
    columns.splice(change.to, 0, column)
    const [weight] = ratio.splice(change.index, 1)
    ratio.splice(change.to, 0, weight)
  }
  if (change.type === 'options') {
    if (
      !columnWeights(change.ratio, columns.length) ||
      change.ratio.some((n) => !Number.isFinite(n) || n <= 0)
    )
      throw Error('Use one positive weight per column.')
    ratio = change.ratio
    mobile = change.mobile
  }
  const prefix = Array(record.depth).fill('>').join(' ')
  const childPrefix = prefix + ' >'
  const header =
    prefix +
    ' [!abele-columns|ratio=' +
    ratio.join(':') +
    ' mobile=' +
    mobile +
    ']' +
    (parentTitle ? ' ' + parentTitle : '')
  const framed =
    header +
    '\n' +
    columns.map((c) => c.header + '\n' + quoted(c.body, childPrefix)).join('\n' + prefix + '\n')
  return text.slice(0, record.from) + framed + text.slice(record.to)
}

export function removeColumns(text: string, record: ColumnSource): string {
  const parentTitle = title(text.slice(record.from).split('\n')[0])
  const bodies = record.columns.map((c) => {
    const heading = title(text.slice(c.from).split('\n')[0])
    return (heading ? heading + '\n' : '') + cleanBody(c.body)
  })
  let content = (parentTitle ? parentTitle + '\n\n' : '') + bodies.join('\n\n')
  // Nested columns return to their surrounding quote, not to the document's root.
  if (record.depth > 1)
    content = quoted(
      content,
      Array(record.depth - 1)
        .fill('>')
        .join(' ')
    )
  return text.slice(0, record.from) + content + text.slice(record.to)
}
