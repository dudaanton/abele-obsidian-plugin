import { columnSource, quoteSourceTree, type QuoteSourceRange, type ColumnSource } from './source'
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

/** One admission gate for cursor commands, rendered controls and mutation revalidation. */
export function resolveColumnTarget(
  text: string,
  position: number,
  expected?: { from: number; to: number }
): ColumnSource | null {
  const containingPath = (ranges: QuoteSourceRange[]): QuoteSourceRange[] => {
    for (const range of ranges) {
      if (position >= range.from && position <= range.to)
        return [range, ...containingPath(range.children)]
    }
    return []
  }
  const path = containingPath(quoteSourceTree(text))
  const index = path.map((range) => range.callout).lastIndexOf('abele-columns')
  const selected = path[index]
  if (
    !selected ||
    !selected.quoteOnlyAncestors ||
    (expected && (selected.from !== expected.from || selected.to !== expected.to))
  )
    return null
  const frame = columnSource(text, selected.from)
  if (!frame || frame.from !== selected.from || frame.to !== selected.to) return null
  // From the cursor up to this frame, only its own direct column quotes are transparent.
  // Foreign/plain quotes and list-contained quotes are barriers, even with a column-like type.
  if (
    path
      .slice(index + 1)
      .some(
        (range) =>
          range.container !== 'Blockquote' ||
          range.callout !== 'abele-column' ||
          !selected.children.includes(range) ||
          !frame.columns.some((column) => column.from === range.from && range.to <= column.to)
      )
  )
    return null
  return frame
}

export function findColumns(text: string, position: number): ColumnSource | null {
  return resolveColumnTarget(text, position)
}

function quoted(body: string, prefix: string, separator = ' '): string {
  return body
    .split('\n')
    .map((line) => prefix + (line ? separator + line : ''))
    .join('\n')
}

interface QuotePrefix {
  marks: string[]
  prefix: string
  separator: string
  body: string
}
function quotePrefix(line: string, depth: number): QuotePrefix | null {
  const marks: string[] = []
  let rest = line
  for (let i = 0; i < depth; i++) {
    const mark = /^[ \t]*>/.exec(rest)?.[0]
    if (!mark) return null
    marks.push(mark)
    rest = rest.slice(mark.length)
  }
  const separator = /^[ \t]/.exec(rest)?.[0] ?? ''
  return { marks, prefix: marks.join(''), separator, body: rest.slice(separator.length) }
}

/** Independent publication guard: prove every original line's container prefix is reproducible. */
function mutationPrefixes(text: string, frame: ColumnSource) {
  const fail = (): never => {
    throw Error('The original column line prefixes cannot be reproduced safely.')
  }
  const parent = quotePrefix(text.slice(frame.from).split('\n')[0], frame.depth) ?? fail()
  const children = frame.columns.map(
    (column) => quotePrefix(text.slice(column.from).split('\n')[0], frame.depth + 1) ?? fail()
  )
  let at = frame.from,
    column = 0
  for (const line of text.slice(frame.from, frame.to).split('\n')) {
    const outer = quotePrefix(line, frame.depth)
    if (!outer || outer.prefix !== parent.prefix) fail()
    if (at !== frame.from) {
      const inner = quotePrefix(line, frame.depth + 1)
      if (inner) {
        while (column + 1 < frame.columns.length && at >= frame.columns[column + 1].from) column++
        if (
          at < frame.columns[column].from ||
          at > frame.columns[column].to ||
          inner.prefix !== children[column].prefix ||
          (inner.body && inner.separator !== children[column].separator)
        )
          fail()
      } else if (outer.body.trim()) fail()
    }
    at += line.length + 1
  }
  return { parent, children }
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

function checkedFrame(text: string, record: ColumnSource): ColumnSource {
  const current = resolveColumnTarget(text, record.from, record)
  if (
    !current ||
    current.to !== record.to ||
    current.columns.length !== record.columns.length ||
    current.columns.some(
      (column, index) =>
        column.from !== record.columns[index].from || column.to !== record.columns[index].to
    )
  )
    throw Error('The column frame changed or contains unsupported structure.')
  return current
}

/** Replace only the parsed frame; the caller owns the editor/vault transaction. */
export function changeColumns(text: string, record: ColumnSource, change: ColumnChange): string {
  record = checkedFrame(text, record)
  const prefixes = mutationPrefixes(text, record)
  const parentTitle = title(text.slice(record.from).split('\n')[0])
  const columns = record.columns.map((c, index) => ({
    header: text.slice(c.from).split('\n')[0],
    body: cleanBody(c.body),
    prefix: prefixes.children[index].prefix,
    separator: prefixes.children[index].separator,
  }))
  let ratio = record.options.ratio
    ? [...record.options.ratio]
    : Array<number>(columns.length).fill(1)
  let mobile = record.options.mobile
  if (change.type === 'add') {
    const { prefix, separator } = prefixes.children[0]
    columns.push({ header: prefix + separator + '[!abele-column]', body: '', prefix, separator })
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
  const { prefix, separator } = prefixes.parent
  const header =
    prefix +
    separator +
    '[!abele-columns|ratio=' +
    ratio.join(':') +
    ' mobile=' +
    mobile +
    ']' +
    (parentTitle ? ' ' + parentTitle : '')
  const framed =
    header +
    '\n' +
    columns
      .map((c) => c.header + '\n' + quoted(c.body, c.prefix, c.separator))
      .join('\n' + prefix + '\n')
  return text.slice(0, record.from) + framed + text.slice(record.to)
}

export function removeColumns(text: string, record: ColumnSource): string {
  record = checkedFrame(text, record)
  const prefixes = mutationPrefixes(text, record)
  const parentTitle = title(text.slice(record.from).split('\n')[0])
  // Retain the original surrounding quote profile or leading indentation, not just its depth.
  const outer = prefixes.parent.marks.slice(0, record.depth - 1).join('')
  const indent = prefixes.parent.marks[0].slice(0, -1)
  const render = (body: string, separator: string) =>
    record.depth > 1
      ? quoted(body, outer, separator)
      : body
          .split('\n')
          .map((line) => indent + line)
          .join('\n')
  const bodies = record.columns.map((c, index) => {
    const heading = title(text.slice(c.from).split('\n')[0])
    return render(
      (heading ? heading + '\n' : '') + cleanBody(c.body),
      prefixes.children[index].separator
    )
  })
  if (parentTitle) bodies.unshift(render(parentTitle, prefixes.parent.separator))
  const content = bodies.join('\n' + (record.depth > 1 ? outer : indent) + '\n')
  return text.slice(0, record.from) + content + text.slice(record.to)
}
