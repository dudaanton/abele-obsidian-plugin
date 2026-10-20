import type { AgentTool } from '../client'
import { appOf } from '../toolContext'
import { scopeOf } from '../toolContext'
import { TFile } from 'obsidian'
import { trashUnindexedFile } from '@/helpers/vaultUtils'

export function createDeleteFileTool(opts?: { skipScope?: boolean }): AgentTool {
  return {
    name: 'rm',
    label: 'Delete File',
    description: 'Delete a file (moves to trash). File must be in workspace scope.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to delete' },
      },
      required: ['path'],
    },
    execute: async (_id, params, signal, ctx) => {
      signal?.throwIfAborted()
      const path = params.path as string
      if (!path) throw new Error('Missing required parameter: path')
      if (
        path.startsWith('/') ||
        path.includes('\\') ||
        path.split('/').some((part) => part === '..' || part === '.')
      )
        throw new Error('Expected a relative vault file path')
      if (!opts?.skipScope && !scopeOf(ctx).isInScope(path)) {
        throw new Error(`Access denied: ${path} is not in workspace scope`)
      }
      const app = appOf(ctx)
      const file = app.vault.getAbstractFileByPath(path)
      if (file instanceof TFile) await app.fileManager.trashFile(file)
      else await trashUnindexedFile(app, path)
      scopeOf(ctx).invalidate()
      return { content: [{ type: 'text', text: `Deleted: ${path}` }] }
    },
  }
}
