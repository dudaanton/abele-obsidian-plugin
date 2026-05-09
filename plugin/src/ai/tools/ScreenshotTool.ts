import type { AgentTool, UserContentPart } from '../client'
import type { WorkspaceLeaf } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { TFile } from 'obsidian'
import domtoimage from 'dom-to-image-more'

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

export function createScreenshotTool(): AgentTool {
  return {
    name: 'screenshot',
    label: 'Screenshot',
    description:
      'Take a screenshot of a file open in Obsidian. If the file is already open, captures its current view without reloading. If not open, opens it in a new tab first. Use this to visually inspect layout, content, or rendering of notes, bases, or any other views.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to vault root' },
      },
      required: ['path'],
    },
    execute: async (_id, params) => {
      const path = params.path as string
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
        // Brief delay to let the view render
        await new Promise((r) => setTimeout(r, 500))
      }

      const el = targetLeaf.view.containerEl
      if (!el) throw new Error('Leaf has no container element')

      const dataUrl = await domtoimage.toPng(el, {
        width: el.scrollWidth,
        height: el.scrollHeight,
        style: {
          overflow: 'visible',
        },
      })

      const imageContent: UserContentPart[] = [
        { type: 'text', text: `[Screenshot: ${path}]` },
        { type: 'image_url', image_url: { url: dataUrl } },
      ]

      return {
        content: [{ type: 'text', text: `Screenshot captured: ${path}` }],
        injectMessages: [{ role: 'user', content: imageContent, timestamp: Date.now() }],
      }
    },
  }
}
