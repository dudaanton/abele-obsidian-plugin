import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { TFile } from 'obsidian'

export function createEditFileTool(opts?: { skipScope?: boolean }): AgentTool {
  return {
    name: 'edit',
    label: 'Edit File',
    description:
      'Edit a file by replacing an exact string match with new content. File must be in workspace scope.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        old_string: { type: 'string', description: 'Exact string to find' },
        new_string: { type: 'string', description: 'Replacement string' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    execute: async (_id, params) => {
      const { path, old_string, new_string } = params as {
        path: string
        old_string: string
        new_string: string
      }
      if (!path) throw new Error('Missing required parameter: path')
      if (old_string == null) throw new Error('Missing required parameter: old_string')
      if (new_string == null) throw new Error('Missing required parameter: new_string')
      if (!opts?.skipScope && !ScopeResolver.getInstance().isInScope(path)) {
        throw new Error(`Access denied: ${path} is not in workspace scope`)
      }
      const { app } = GlobalStore.getInstance()
      const file = app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`)
      const content = await app.vault.read(file)
      if (!content.includes(old_string)) {
        throw new Error(`String not found in file: "${old_string.slice(0, 100)}"`)
      }
      await app.vault.modify(file, content.replace(old_string, new_string))
      return {
        content: [{ type: 'text', text: `Edited: ${path}` }],
        details: { diff: { old: old_string, new: new_string } },
      }
    },
  }
}
