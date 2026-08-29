import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { checkVaultPath } from '@/helpers/pathsHelpers'

export function createCreateFileTool(opts?: { skipScope?: boolean }): AgentTool {
  return {
    name: 'create',
    label: 'Create File',
    description: 'Create a new file in the vault with the specified content.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path for the new file' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['path', 'content'],
    },
    execute: async (_id, params) => {
      const { path, content } = params as { path: string; content: string }
      if (!path) throw new Error('Missing required parameter: path')
      if (content == null) throw new Error('Missing required parameter: content')
      // Before anything is written: Obsidian's own API takes a name with a `#` in it happily,
      // and the note that comes out cannot be linked to from anywhere.
      const wrong = checkVaultPath(path)
      if (wrong) throw new Error(`Cannot create ${path}. ${wrong}`)
      const { app } = GlobalStore.getInstance()
      if (app.vault.getAbstractFileByPath(path)) throw new Error(`File already exists: ${path}`)

      const parentFolder = path.split('/').slice(0, -1).join('/')
      if (parentFolder) {
        const parts = parentFolder.split('/')
        let current = ''
        for (const part of parts) {
          current = current ? `${current}/${part}` : part
          if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current)
        }
      }
      await app.vault.create(path, content)
      // Add new file to scope so agent can read/edit it
      if (!opts?.skipScope) ScopeResolver.getInstance().addFile(path)
      return {
        content: [{ type: 'text', text: `Created: ${path}` }],
        details: { diff: { old: '', new: content } },
      }
    },
  }
}
