import type { AgentTool, AgentToolResult, UserContentPart } from '../client'
import type { WorkspaceLeaf } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { TFile } from 'obsidian'
import domtoimage from 'dom-to-image-more'
import { findScriptViewTab } from './scriptViewLookup'

export function findLeafByFile(path: string): WorkspaceLeaf | null {
  const { app } = GlobalStore.getInstance()
  let found: WorkspaceLeaf | null = null
  app.workspace.iterateAllLeaves((leaf) => {
    if (!found && (leaf.view as any).file?.path === path) {
      found = leaf
    }
  })
  return found
}

/** The element as a PNG data URL, whole rather than only what is scrolled into view. */
async function capture(el: HTMLElement): Promise<string> {
  return domtoimage.toPng(el, {
    width: el.scrollWidth,
    height: el.scrollHeight,
    style: {
      overflow: 'visible',
    },
  })
}

/** The tool's answer: a line for the log, and the picture itself as the next user turn. */
function picture(subject: string, dataUrl: string): AgentToolResult {
  const imageContent: UserContentPart[] = [
    { type: 'text', text: `[Screenshot: ${subject}]` },
    { type: 'image_url', image_url: { url: dataUrl } },
  ]
  return {
    content: [{ type: 'text', text: `Screenshot captured: ${subject}` }],
    injectMessages: [{ role: 'user', content: imageContent, timestamp: Date.now() }],
  }
}

export function createScreenshotTool(): AgentTool {
  return {
    name: 'screenshot',
    label: 'Screenshot',
    description:
      'Take a screenshot of a file open in Obsidian, or of a script view. Give either path (a note) or view (a script view, by its tab title or script name). If the file is already open, captures its current view without reloading. If not open, opens it in a new tab first. Use this to visually inspect layout, content, or rendering of notes, bases, script views or any other views.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to vault root' },
        view: {
          type: 'string',
          description:
            'A script view, by its tab title or script name. Use instead of path to capture a view a script opened.',
        },
      },
      required: [],
    },
    execute: async (_id, params) => {
      // A script's view has no file behind it and no scope to check: what it shows is what the
      // script built, which the agent asking is usually the author of.
      const viewName = params.view as string | undefined
      if (viewName) {
        const tab = findScriptViewTab(viewName)
        if (!tab.el) throw new Error(`The view "${tab.view.title}" has nothing on screen yet`)
        return picture(`view "${tab.view.title}"`, await capture(tab.el))
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
        // Brief delay to let the view render
        await new Promise((r) => window.setTimeout(r, 500))
      }

      const el = targetLeaf.view.containerEl
      if (!el) throw new Error('Leaf has no container element')

      return picture(path, await capture(el))
    },
  }
}
