import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { TFile } from 'obsidian'
import { findLeafByFile } from './ScreenshotTool'
import type { ScriptViewModel } from '@/views/ScriptView'

const MAX_OUTPUT = 15_000

function cleanHtml(el: Element): string {
  const tag = el.tagName.toLowerCase()

  // Skip SVG internals, scripts, styles
  if (['script', 'style', 'svg', 'noscript'].includes(tag)) {
    return tag === 'svg' ? '<svg>...</svg>' : ''
  }

  const classes = el.className
  const classStr = typeof classes === 'string' && classes.trim() ? ` class="${classes.trim()}"` : ''

  // Keep only meaningful attributes: class, id, href, src, type, role, aria-label
  const keepAttrs = ['id', 'href', 'src', 'type', 'role', 'aria-label']
  let attrStr = ''
  for (const name of keepAttrs) {
    const val = el.getAttribute(name)
    if (val) attrStr += ` ${name}="${val}"`
  }

  const children = Array.from(el.childNodes)
  let inner = ''
  for (const child of children) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent || '').trim()
      if (text) inner += text
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      inner += cleanHtml(child as Element)
    }
  }

  // Self-closing tags
  if (['br', 'hr', 'img', 'input'].includes(tag)) {
    return `<${tag}${classStr}${attrStr}/>`
  }

  // Skip wrapper-only divs/spans with no attributes
  if (!classStr && !attrStr && ['div', 'span'].includes(tag) && inner) {
    return inner
  }

  if (!inner && !classStr && !attrStr) return ''

  return `<${tag}${classStr}${attrStr}>${inner}</${tag}>`
}

export function createInspectViewTool(): AgentTool {
  return {
    name: 'inspect_view',
    label: 'Inspect View',
    description:
      "Inspect the HTML structure of a file's rendered view for debugging. Returns cleaned HTML (no inline styles, no data-attributes, collapsed SVGs). Use optional CSS selector to narrow down to a specific element. If output is truncated, use a more specific selector. Give either path (a note) or view (a script view).",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to vault root' },
        view: {
          type: 'string',
          description:
            'A script view, by its tab title or script name. Use instead of path to inspect a view a script opened.',
        },
        selector: {
          type: 'string',
          description:
            'Optional CSS selector to target a specific element within the view (e.g. ".cm-content", ".base-table")',
        },
      },
      required: [],
    },
    execute: async (_id, params) => {
      const selector = params.selector as string | undefined

      // A script's view has no file behind it, so it is answered before the path checks: its
      // nodes are the truth, and the rendered HTML would only show what the kit made of them.
      // Imported here rather than at the top so the tool does not pull the view runtime in.
      const viewName = params.view as string | undefined
      if (viewName) {
        const { describeView } = await import('@/scripting/view/describe')
        // Every open script tab, bound or not: the service knows only the leaves that have a
        // view, and a tab whose script is still running or has failed is exactly the one an
        // agent asks about after writing that script. The cast undoes `ref`'s deep unwrapping,
        // which strips the private fields off the `View` class the models hold.
        const models = GlobalStore.getInstance().scriptViews.value as ScriptViewModel[]
        const open = models.map((m) => m.view).filter((v): v is NonNullable<typeof v> => Boolean(v))
        const wanted = viewName.toLowerCase()
        const hit =
          open.find(
            (v) => v.title.toLowerCase() === wanted || v.origin.script.toLowerCase() === wanted
          ) ??
          open.find(
            (v) =>
              v.title.toLowerCase().includes(wanted) ||
              v.origin.script.toLowerCase().includes(wanted)
          )
        if (!hit) {
          // Naming what is open turns a miss into the answer to the next question anyway. A
          // tab whose script is still running, or whose script failed, has no view to describe
          // but is very likely the one being asked about — say so rather than leave it out.
          const names =
            models
              .map((m) => {
                if (m.view) return `"${m.view.title}" (${m.view.origin.script})`
                const script = m.saved?.script ?? (m.status.kind === 'live' ? '' : m.status.script)
                if (m.status.kind === 'failed') return `"${script}" (failed: ${m.status.message})`
                return `"${script}" (starting)`
              })
              .join(', ') || 'none'
          throw new Error(`No script view named "${viewName}". Open: ${names}`)
        }
        let text = describeView(hit)
        if (text.length > MAX_OUTPUT) {
          text =
            text.slice(0, MAX_OUTPUT) +
            '\n\n[Output truncated. Inspect a smaller view, or reach one node through its id.]'
        }
        return { content: [{ type: 'text', text }] }
      }

      const path = params.path as string
      if (!path) throw new Error('Missing required parameter: path or view')
      if (!ScopeResolver.getInstance().isInScope(path)) {
        throw new Error(`Access denied: ${path} is not in workspace scope`)
      }

      const { app } = GlobalStore.getInstance()
      const file = app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`)

      let targetLeaf = findLeafByFile(path)

      if (!targetLeaf) {
        targetLeaf = app.workspace.getLeaf('tab')
        await targetLeaf.openFile(file)
        await new Promise((r) => window.setTimeout(r, 500))
      }

      const container = targetLeaf.view.containerEl
      if (!container) throw new Error('Leaf has no container element')

      let targetEl: Element = container
      if (selector) {
        const found = container.querySelector(selector)
        if (!found) throw new Error(`Selector "${selector}" not found in view`)
        targetEl = found
      }

      let html = cleanHtml(targetEl)
      let truncated = false

      if (html.length > MAX_OUTPUT) {
        html = html.slice(0, MAX_OUTPUT)
        truncated = true
      }

      const truncMsg = truncated
        ? '\n\n[Output truncated. Use a more specific CSS selector to narrow down.]'
        : ''

      return {
        content: [{ type: 'text', text: html + truncMsg }],
      }
    },
  }
}
