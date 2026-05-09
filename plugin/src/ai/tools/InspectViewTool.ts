import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { TFile } from 'obsidian'
import { findLeafByFile } from './ScreenshotTool'

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
      "Inspect the HTML structure of a file's rendered view for debugging. Returns cleaned HTML (no inline styles, no data-attributes, collapsed SVGs). Use optional CSS selector to narrow down to a specific element. If output is truncated, use a more specific selector.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to vault root' },
        selector: {
          type: 'string',
          description:
            'Optional CSS selector to target a specific element within the view (e.g. ".cm-content", ".base-table")',
        },
      },
      required: ['path'],
    },
    execute: async (_id, params) => {
      const path = params.path as string
      const selector = params.selector as string | undefined
      if (!path) throw new Error('Missing required parameter: path')
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
        await new Promise((r) => setTimeout(r, 500))
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
