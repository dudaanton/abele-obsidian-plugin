/**
 * A script's view as text an agent can read: the tree it built, with the values it would ask
 * about. Node per line, children indented two spaces.
 *
 * The HTML of the same tab answers a different question — which classes the kit put on which
 * div. An agent that has just written the script wants the other one: what its own nodes hold
 * now. So a button prints its text and whether it is disabled, an input its value, a tabs its
 * active id, and nothing prints a wrapper.
 */
import type { View } from './View'
import { isNode, type TableColumn, type TableRow, type ViewNode } from './components'

/** Where a text value is cut. Markup gets more room because a tag eats most of a short line. */
const CUT = 120
const MARKUP_CUT = 300
/** A table this long is a list; past that the shape is clear and the rest is noise. */
const MAX_ROWS = 20

const short = (s: string, n = CUT) => (s.length > n ? s.slice(0, n) + '…' : s)
const q = (s: string) => `"${short(s)}"`
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/**
 * One loose alias instead of a cast per branch, as `ScriptNode.vue` does: the switch below is
 * on `type`, and each case reads the props of whichever class that is.
 */
type Any = ViewNode & Record<string, any>

export function describeView(view: View): string {
  const head = `View ${q(view.title)} — script ${q(view.origin.script)}, params ${JSON.stringify(view.origin.params)}, state ${JSON.stringify(view.state)}`
  return [head, ...view.nodes.map((n) => describeNode(n))].join('\n')
}

export function describeNode(node: ViewNode, depth = 0): string {
  const n = node as Any
  const pad = '  '.repeat(depth)
  const tail = [n.id ? `#${n.id}` : '', n.hidden ? '(hidden)' : ''].filter(Boolean).join(' ')
  const line = (text: string) => pad + [text, tail].filter(Boolean).join(' ')
  const kids = (list: ViewNode[], d = depth + 1) => list.map((c) => describeNode(c, d))

  switch (n.type) {
    case 'stack':
    case 'row':
    case 'grid':
      return [line(cap(n.type)), ...kids(n.children)].join('\n')
    case 'section':
      return [line(`Section${n.title ? ' ' + q(n.title) : ''}`), ...kids(n.children)].join('\n')
    case 'setting':
      return [line(`Setting ${q(n.name)}`), ...kids(n.children)].join('\n')
    case 'tabs': {
      const strip = n.tabs.map((t: { id: string; label: string }) => `${t.id} ${q(t.label)}`)
      // Every tab's content, not just the active one's: a script builds all of them, and the
      // agent is usually asking why the tab it cannot see is empty. The id in front of each
      // says which tab a line came from; the active tab is named in the header.
      const content = n.tabs.flatMap((t: { id: string }) =>
        n
          .contentOf(t.id)
          .map((c: ViewNode) => describeNode(c, depth + 1).replace(/^(\s*)/, `$1[${t.id}] `))
      )
      return [line(`Tabs active=${n.active} [${strip.join(', ')}]`), ...content].join('\n')
    }
    case 'markdown':
      return line(n.file ? `Markdown file=${n.file}` : `Markdown ${q(n.text)}`)
    case 'text':
      return line(`Text ${q(n.text)}`)
    case 'image':
      return line(`Image src=${n.src}${n.alt ? ` alt=${q(n.alt)}` : ''}`)
    case 'table': {
      // A cell is text or a node of its own; the node prints as its own one-line description,
      // undented, so the row still reads as a row.
      const cells = (r: TableRow) =>
        n.columns
          .map((c: TableColumn) => {
            const v = r[c.key]
            return isNode(v) ? describeNode(v).trim() : (v ?? '')
          })
          .join(' | ')
      const rows = n.rows.slice(0, MAX_ROWS).map((r: TableRow) => pad + '  ' + cells(r))
      const keys = n.columns.map((c: { key: string }) => c.key).join(', ')
      return [line(`Table columns=[${keys}] rows=${n.rows.length}`), ...rows].join('\n')
    }
    case 'badge':
      return line(`Badge ${q(n.text)}${n.accent ? ' accent' : ''}`)
    case 'empty':
      return line(`EmptyState ${q(n.text)}`)
    case 'button':
      return line(
        `Button ${q(n.text)}${n.icon ? ` icon=${n.icon}` : ''}${n.accent ? ' accent' : ''}${n.warning ? ' warning' : ''}${n.disabled ? ' disabled' : ''}`
      )
    case 'icon':
      return line(`Icon ${n.icon} ${q(n.tooltip)}${n.disabled ? ' disabled' : ''}`)
    case 'input':
      return line(
        `Input value=${q(n.value)}${n.placeholder ? ` placeholder=${q(n.placeholder)}` : ''}${n.textarea ? ' textarea' : ''}${n.disabled ? ' disabled' : ''}`
      )
    case 'select':
      return line(
        `Select value=${n.value} options=[${n.options.map((o: { value: string }) => o.value).join(', ')}]`
      )
    case 'checkbox':
      return line(
        `Checkbox ${n.checked ? 'checked' : 'unchecked'}${n.label ? ' ' + q(n.label) : ''}`
      )
    case 'search':
      return line(`Search value=${q(n.value)}${n.suggest ? ` suggest=${n.suggest}` : ''}`)
    case 'card':
      return [
        line(
          `Card ${q(n.title)}${n.subtitle ? ` ${q(n.subtitle)}` : ''}${n.selected ? ' selected' : ''}`
        ),
        ...kids(n.badges),
        ...kids(n.actions),
        ...kids(n.children),
      ].join('\n')
    case 'html': {
      // The raw markup, not the rendered DOM: what the script wrote is what it can change.
      const slots = Object.entries(n.slots as Record<string, ViewNode>).map(
        ([sel, child]) => pad + `  slot ${sel}: ` + describeNode(child).trim()
      )
      return [line(`Html ${short(n.html, MARKUP_CUT)}`), ...slots].join('\n')
    }
    default:
      return line(cap(n.type))
  }
}
