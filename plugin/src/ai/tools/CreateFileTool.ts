import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { toSafeVaultPath, describeRename } from '@/helpers/pathsHelpers'

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
      // Obsidian's own API takes a name with a `#` in it happily, and the note that comes out
      // cannot be linked to from anywhere. Cleaned rather than refused: the work the caller
      // was doing is worth more than the punctuation, and the reply says what it ended up as.
      const safePath = toSafeVaultPath(path)
      const renamed = describeRename(path, safePath)

      const { app } = GlobalStore.getInstance()
      if (app.vault.getAbstractFileByPath(safePath)) {
        throw new Error(`File already exists: ${safePath}`)
      }

      const parentFolder = safePath.split('/').slice(0, -1).join('/')
      if (parentFolder) {
        const parts = parentFolder.split('/')
        let current = ''
        for (const part of parts) {
          current = current ? `${current}/${part}` : part
          if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current)
        }
      }
      await app.vault.create(safePath, content)
      // Add new file to scope so agent can read/edit it
      if (!opts?.skipScope) ScopeResolver.getInstance().addFile(safePath)
      return {
        content: [{ type: 'text', text: `Created: ${safePath}${renamed ? ` (${renamed})` : ''}` }],
        // The path as well as the diff: it may not be the one that was asked for, and the
        // script API hands it straight back to the script.
        details: { diff: { old: '', new: content }, path: safePath },
      }
    },
  }
}
