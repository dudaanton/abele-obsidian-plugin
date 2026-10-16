import { parser } from '@lezer/markdown'
import { jsonLanguage } from '@codemirror/lang-json'

export interface RewriteOptions {
  source: string
  target: string
  kind: 'md' | 'canvas'
  resolve(link: string): string | null
}

const markdown = parser.configure({
  defineNodes: ['DrawingWikiLink'],
  parseInline: [
    {
      name: 'DrawingWikiLink',
      before: 'Link',
      parse(context, next, pos) {
        if (next !== 91 && next !== 33) return -1
        const match = /^!?\[\[[^\]\n]+\]\]/.exec(context.slice(pos, context.end))
        return match
          ? context.addElement(context.elt('DrawingWikiLink', pos, pos + match[0].length))
          : -1
      },
    },
  ],
})

/** Edit syntax tokens, resolving each destination against the current referring file. */
export function rewriteDrawingReferences(
  text: string,
  options: RewriteOptions
): { text: string; count: number } {
  const edits: { from: number; to: number; value: string }[] = []
  const destination = (raw: string, encoded = false): string | null => {
    const hash = raw.indexOf('#')
    let path = hash < 0 ? raw : raw.slice(0, hash)
    const suffix = hash < 0 ? '' : raw.slice(hash)
    path = path.replace(/\\([ ()])/g, '$1')
    try {
      path = decodeURIComponent(path)
    } catch {
      /* Literal percent in a filename. */
    }
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(path)) return null
    if (path !== options.source && options.resolve(path) !== options.source) return null
    return (
      (encoded ? options.target.split('/').map(encodeURIComponent).join('/') : options.target) +
      suffix
    )
  }
  if (options.kind === 'canvas') {
    // Validate before editing; patch only a file property's string token, retaining all other bytes.
    JSON.parse(text)
    jsonLanguage.parser.parse(text).iterate({
      enter(ref) {
        const node = ref.node
        if (
          node.name !== 'Property' ||
          text.slice(node.firstChild.from, node.firstChild.to) !== '"file"'
        )
          return
        const object = node.parent
        const nodes = object?.parent?.parent
        if (
          object?.name !== 'Object' ||
          object.parent?.name !== 'Array' ||
          nodes?.name !== 'Property' ||
          text.slice(nodes.firstChild.from, nodes.firstChild.to) !== '"nodes"' ||
          nodes.parent?.parent?.name !== 'JsonText'
        )
          return
        const value = JSON.parse(text.slice(object.from, object.to)) as { type?: string }
        const token = node.lastChild
        if (value.type !== 'file' || token.name !== 'String') return
        const next = destination(JSON.parse(text.slice(token.from, token.to)) as string)
        if (next) edits.push({ from: token.from, to: token.to, value: JSON.stringify(next) })
      },
    })
  } else {
    const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text)?.[0].length ?? 0
    const tree = markdown.parse(text)
    const definitions = new Map<string, string>()
    const labelKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase()
    tree.iterate({
      enter(ref) {
        if (ref.name !== 'LinkReference' || ref.from < frontmatter) return
        const label = ref.node.getChild('LinkLabel')
        const url = ref.node.getChild('URL')
        if (label && url)
          definitions.set(
            labelKey(text.slice(label.from + 1, label.to - 1)),
            text.slice(url.from, url.to).replace(/^<|>$/g, '')
          )
      },
    })
    tree.iterate({
      enter(ref) {
        const node = ref.node
        if (
          node.to <= frontmatter ||
          ['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'CommentBlock'].includes(node.name)
        )
          return false
        if (node.name === 'DrawingWikiLink') {
          for (let parent = node.parent; parent; parent = parent.parent)
            if (parent.name === 'Link' || parent.name === 'Image') return false
          const raw = text.slice(node.from, node.to)
          const start = raw.startsWith('!') ? 3 : 2
          const pipe = raw.indexOf('|')
          const end = pipe < 0 ? raw.length - 2 : pipe
          const next = destination(raw.slice(start, end))
          if (next) edits.push({ from: node.from + start, to: node.from + end, value: next })
          return false
        }
        if (node.name === 'Image' && !node.getChild('URL')) {
          const marks = node.getChildren('LinkMark')
          const alt = text.slice(marks[0].to, marks[1].from)
          const label = node.getChild('LinkLabel')
          const key = label ? text.slice(label.from + 1, label.to - 1) || alt : alt
          const raw = definitions.get(labelKey(key))
          const next = raw ? destination(raw) : null
          if (next) {
            edits.push({
              from: node.from,
              to: node.to,
              value: `![[${next}${alt ? `|${alt}` : ''}]]`,
            })
            return false
          }
        }
        if (
          node.name !== 'URL' ||
          !['Link', 'Image', 'LinkReference'].includes(node.parent?.name ?? '')
        )
          return
        let from = node.from,
          to = node.to
        if (text[from] === '<') {
          from++
          to--
        }
        const next = destination(text.slice(from, to), true)
        if (!next) return
        const image = node.parent
        if (image.name === 'Image') {
          const marks = image.getChildren('LinkMark')
          const alt = text.slice(marks[0].to, marks[1].from)
          const wiki = destination(text.slice(from, to))
          edits.push({
            from: image.from,
            to: image.to,
            value: `![[${wiki}${alt ? `|${alt}` : ''}]]`,
          })
        } else edits.push({ from, to, value: next })
      },
    })
  }
  for (const edit of edits.sort((a, b) => b.from - a.from))
    text = text.slice(0, edit.from) + edit.value + text.slice(edit.to)
  return { text, count: edits.length }
}
