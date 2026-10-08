import { parser, GFM, type MarkdownConfig } from '@lezer/markdown'
import { decodeHTML } from 'entities'
import type { SyntaxNode } from '@lezer/common'
import { columnWeights, parseColumnsHeader, type ColumnsOptions } from './core'

export interface SourceParagraph {
  tag: string
  from: number
  to: number
  positions: number[]
}
export interface SourceColumn {
  from: number
  to: number
  body: string
  paragraphs: SourceParagraph[]
}
export interface ColumnSource {
  from: number
  to: number
  depth: number
  options: ColumnsOptions
  columns: SourceColumn[]
}
const nativeInline: MarkdownConfig = {
  defineNodes: ['NativeLink', 'NativeMath'],
  parseInline: [
    {
      name: 'NativeInline',
      before: 'Link',
      parse(context, next, pos) {
        const tail = context.slice(pos, context.end)
        if (next === 91) {
          const link = /^(?:\[\[[^\]\n]+\]\]|\[\^[^\]\n]+\])/.exec(tail)
          if (link) return context.addElement(context.elt('NativeLink', pos, pos + link[0].length))
        }
        if (next === 36) {
          const math = /^\$(?!\$)(?:\\.|[^$\n])+\$/.exec(tail)
          if (math) return context.addElement(context.elt('NativeMath', pos, pos + math[0].length))
        }
        return -1
      },
    },
  ],
}
const markdown = parser.configure([...GFM, nativeInline])
const quote = (line: string) => /^(\s*(?:>\s?)+)(.*)$/.exec(line)
const depthOf = (prefix: string) => [...prefix].filter((c) => c === '>').length

/** Parse the quote frame at a known host source position, never search for rendered text. */
export function columnSource(text: string, from: number): ColumnSource | null {
  const lines = text.split('\n')
  const offsets: number[] = []
  let at = 0
  for (const line of lines) {
    offsets.push(at)
    at += line.length + 1
  }
  const index = offsets.indexOf(from)
  if (index < 0) return null
  // Ask the Markdown grammar about surrounding code, including quoted and unclosed fences.
  const context = markdown.parse(text)
  for (let node: SyntaxNode | null = context.resolveInner(from, 1); node; node = node.parent)
    if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'HTMLBlock')
      return null
  let fence = ''
  const header = quote(lines[index])
  const options = parseColumnsHeader(lines[index])
  if (!header || !options) return null
  const depth = depthOf(header[1])
  const columns: SourceColumn[] = []
  let body = '',
    positions: number[] = [],
    start = 0,
    end = from + lines[index].length
  const finish = () => {
    if (!start) return
    const paragraphs: SourceParagraph[] = []
    const tree = markdown.parse(body)
    const visit = (node: SyntaxNode) => {
      if (
        node.name === 'Paragraph' ||
        node.name === 'Task' ||
        /^ATXHeading[1-6]$/.test(node.name) ||
        /^SetextHeading[12]$/.test(node.name)
      ) {
        const raw = body.slice(node.from, node.to)
        // Standalone native embeds and display math are opaque interactive blocks, not prose.
        if (!/^\s*(?:!\[|\$\$)/.test(raw)) {
          const visible = inlinePositions(node, body).map((n) => positions[n])
          paragraphs.push({
            tag:
              node.name === 'Paragraph' || node.name === 'Task'
                ? node.parent?.name === 'ListItem'
                  ? 'li'
                  : 'p'
                : 'h' + node.name.at(-1),
            from: visible[0] ?? positions[node.from],
            to: positions[node.to - 1] + 1,
            positions: visible,
          })
        }
        return
      }
      for (let child = node.firstChild; child; child = child.nextSibling) visit(child)
    }
    visit(tree.topNode)
    columns.push({ from: start, to: end, body, paragraphs })
  }
  fence = ''
  for (let i = index + 1; i < lines.length; i++) {
    const m = quote(lines[i])
    if (!m || depthOf(m[1]) < depth) break
    const d = depthOf(m[1])
    // Every non-frame byte must belong to a child. Never discard parent prose or orphan text.
    if (
      (d === depth || !start) &&
      m[2].trim() &&
      !(d === depth + 1 && /^\[!abele-column(?:\|[^\]]*)?\](?:\s.*)?$/.test(m[2]))
    )
      return null
    if (!fence && d === depth + 1 && /^\[!abele-column(?:\|[^\]]*)?\](?:\s.*)?$/.test(m[2])) {
      finish()
      start = offsets[i]
      body = ''
      positions = []
    } else if (start && d >= depth + 1) {
      // Remove exactly the frame markers, preserving deeper quotes and their source offsets.
      const prefix = /^(?:\s*>\s?){1}/g
      let removed = 0,
        rest = lines[i]
      for (let n = 0; n < depth + 1; n++) {
        prefix.lastIndex = 0
        const part = prefix.exec(rest)
        if (!part) break
        removed += part[0].length
        rest = rest.slice(part[0].length)
      }
      for (let n = 0; n < rest.length; n++) positions.push(offsets[i] + removed + n)
      body += rest + '\n'
      positions.push(offsets[i] + lines[i].length)
      const marker = /^\s*(`{3,}|~{3,})/.exec(rest)
      if (marker)
        fence = fence
          ? marker[1][0] === fence[0] && marker[1].length >= fence.length
            ? ''
            : fence
          : marker[1]
    } else if (start) {
      body += '\n'
      positions.push(offsets[i] + lines[i].length)
    }
    end = offsets[i] + lines[i].length
  }
  finish()
  return columnWeights(options.ratio, columns.length)
    ? { from, to: end, depth, options, columns }
    : null
}

/** Visible UTF-16 units are mapped by syntax spans, not by matching a rendered string. */
function inlinePositions(node: SyntaxNode, source: string): number[] {
  const hidden = new Set([
    'EmphasisMark',
    'LinkMark',
    'URL',
    'LinkTitle',
    'CodeMark',
    'HeaderMark',
    'TaskMarker',
    'HTMLTag',
    'Link',
    'Image',
    'NativeLink',
    'NativeMath',
    'Autolink',
    'HardBreak',
    'StrikethroughMark',
  ])
  const result: number[] = []
  const walk = (n: SyntaxNode) => {
    if (hidden.has(n.name)) return
    let at = n.from
    for (let child = n.firstChild; child; child = child.nextSibling) {
      for (; at < child.from; at++) result.push(at)
      if (child.name === 'Escape') result.push(child.to - 1)
      else if (child.name === 'Entity') {
        const raw = source.slice(child.from, child.to)
        const value = decodeHTML(raw)
        for (let i = 0; i < value.length; i++) result.push(child.from)
      } else walk(child)
      at = child.to
      if (child.name === 'HeaderMark' || child.name === 'TaskMarker')
        while (at < n.to && /[ \t]/.test(source[at])) at++
    }
    for (; at < n.to; at++) result.push(at)
  }
  walk(node)
  while (result.length && /\s/.test(source[result.at(-1)!])) result.pop()
  return result
}
