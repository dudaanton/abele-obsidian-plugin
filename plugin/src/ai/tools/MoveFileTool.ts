import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { toSafeVaultPath, describeRename } from '@/helpers/pathsHelpers'
import { TFile } from 'obsidian'

export function createMoveFileTool(opts?: { skipScope?: boolean }): AgentTool {
  return {
    name: 'mv',
    label: 'Move/Rename File',
    description: 'Move or rename a file. Source must be in workspace scope.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Current file path' },
        to: { type: 'string', description: 'New file path' },
      },
      required: ['from', 'to'],
    },
    execute: async (_id, params) => {
      const { from, to } = params as { from: string; to: string }
      if (!from) throw new Error('Missing required parameter: from')
      if (!to) throw new Error('Missing required parameter: to')
      const safeTo = toSafeVaultPath(to)
      const renamed = describeRename(to, safeTo)
      if (!opts?.skipScope && !ScopeResolver.getInstance().isInScope(from)) {
        throw new Error(`Access denied: ${from} is not in workspace scope`)
      }
      const { app } = GlobalStore.getInstance()
      const file = app.vault.getAbstractFileByPath(from)
      if (!(file instanceof TFile)) throw new Error(`File not found: ${from}`)
      if (app.vault.getAbstractFileByPath(safeTo)) {
        throw new Error(`Destination exists: ${safeTo}`)
      }
      await app.fileManager.renameFile(file, safeTo)
      ScopeResolver.getInstance().invalidate()
      return {
        content: [
          { type: 'text', text: `Moved: ${from} → ${safeTo}${renamed ? ` (${renamed})` : ''}` },
        ],
        details: { path: safeTo },
      }
    },
  }
}
