import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { TFile } from 'obsidian'

export function createOpenFileTool(): AgentTool {
  return {
    name: 'open',
    label: 'Open File',
    description: 'Open a file in the Obsidian editor.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault path of the file to open' },
      },
      required: ['path'],
    },
    execute: async (_id, params) => {
      const path = params.path as string
      if (!path) throw new Error('Missing required parameter: path')
      const { app } = GlobalStore.getInstance()
      const file = app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`)
      await app.workspace.getLeaf(false).openFile(file)
      return { content: [{ type: 'text', text: `Opened: ${path}` }] }
    },
  }
}
