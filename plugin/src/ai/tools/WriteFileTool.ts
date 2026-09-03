import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { TFile } from 'obsidian'

export function createWriteFileTool(opts?: { skipScope?: boolean }): AgentTool {
  return {
    name: 'write',
    label: 'Write File',
    description:
      'Overwrite a file with new content entirely. Use this when you need to rewrite the whole file instead of making a targeted edit. File must be in workspace scope.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'New file content' },
      },
      required: ['path', 'content'],
    },
    execute: async (_id, params) => {
      const path = params.path as string
      const content = params.content as string
      if (!path) throw new Error('Missing required parameter: path')
      if (content == null) throw new Error('Missing required parameter: content')
      if (!opts?.skipScope && !ScopeResolver.getInstance().isInScope(path)) {
        throw new Error(`Access denied: ${path} is not in workspace scope`)
      }
      const { app } = GlobalStore.getInstance()
      const file = app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`)
      const old = await app.vault.read(file)
      await app.vault.modify(file, content)
      return {
        content: [{ type: 'text', text: `Written: ${path}` }],
        details: { diff: { old, new: content }, path },
      }
    },
  }
}
