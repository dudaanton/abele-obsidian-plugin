import { assertExternalDestinationAvailable } from '@/sync/external/destination'
import type { AgentTool } from '../client'
import { guardChatWrite } from './chatWriteGuard'
import { appOf } from '../toolContext'
import { scopeOf } from '../toolContext'
import { toSafeVaultPath, describeRename } from '@/helpers/pathsHelpers'
import { TFile } from 'obsidian'

export function createMoveFileTool(opts?: { skipScope?: boolean }): AgentTool {
  return {
    name: 'mv',
    label: 'Move/Rename File',
    description:
      'Move or rename a file. Source must be in workspace scope. Creates missing parent folders; do not create placeholder files.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Current file path' },
        to: { type: 'string', description: 'New file path' },
      },
      required: ['from', 'to'],
    },
    execute: async (_id, params, signal, ctx) => {
      signal?.throwIfAborted()
      const { from, to } = params as { from: string; to: string }
      if (!from) throw new Error('Missing required parameter: from')
      if (!to) throw new Error('Missing required parameter: to')
      // Prevent both importing arbitrary text and renaming a chat out of the namespace to edit it.
      guardChatWrite(from)
      guardChatWrite(to)
      const safeTo = toSafeVaultPath(to)
      guardChatWrite(safeTo)
      const renamed = describeRename(to, safeTo)
      if (!opts?.skipScope && !scopeOf(ctx).isInScope(from)) {
        throw new Error(`Access denied: ${from} is not in workspace scope`)
      }
      const app = appOf(ctx)
      assertExternalDestinationAvailable(app, safeTo)
      const file = app.vault.getAbstractFileByPath(from)
      if (!(file instanceof TFile)) throw new Error(`File not found: ${from}`)
      if (app.vault.getAbstractFileByPath(safeTo)) {
        throw new Error(`Destination exists: ${safeTo}`)
      }
      let parent = ''
      for (const part of safeTo.split('/').slice(0, -1)) {
        parent = parent ? `${parent}/${part}` : part
        signal?.throwIfAborted()
        if (!app.vault.getAbstractFileByPath(parent)) await app.vault.createFolder(parent)
      }
      signal?.throwIfAborted()
      await app.fileManager.renameFile(file, safeTo)
      if (!opts?.skipScope) scopeOf(ctx).addFile(safeTo)
      scopeOf(ctx).invalidate()
      return {
        content: [
          { type: 'text', text: `Moved: ${from} → ${safeTo}${renamed ? ` (${renamed})` : ''}` },
        ],
        details: { path: safeTo },
      }
    },
  }
}
