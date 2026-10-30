import { assertExternalDestinationAvailable } from '@/sync/external/destination'
import { prepareExternalFile } from '@/sync/external/fileAccess'
import type { AgentTool } from '../client'
import { guardChatWrite } from './chatWriteGuard'
import { appOf } from '../toolContext'
import { scopeOf } from '../toolContext'
import { toSafeVaultPath, describeRename } from '@/helpers/pathsHelpers'
import { TFile } from 'obsidian'
import { chatCopyBytes } from '../chatText'
import { noteFileToolScriptCopy } from '@/scripting/trust/fileToolScriptWrite'

export function createCopyFileTool(opts?: {
  skipScope?: boolean
  scriptAuthor?: boolean
}): AgentTool {
  return {
    name: 'cp',
    label: 'Copy File',
    description:
      'Copy a file to a new location. Source must be in workspace scope. Chat logs copy only the conversation text available through read, regardless of the destination extension.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source file path' },
        to: { type: 'string', description: 'Destination file path' },
      },
      required: ['from', 'to'],
    },
    execute: async (_id, params, signal, ctx) => {
      signal?.throwIfAborted()
      const { from, to } = params as { from: string; to: string }
      if (!from) throw new Error('Missing required parameter: from')
      if (!to) throw new Error('Missing required parameter: to')
      guardChatWrite(to)
      const safeTo = toSafeVaultPath(to)
      guardChatWrite(safeTo)
      const renamed = describeRename(to, safeTo)
      if (!opts?.skipScope && !scopeOf(ctx).isInScope(from)) {
        throw new Error(`Access denied: ${from} is not in workspace scope`)
      }
      const app = appOf(ctx)
      assertExternalDestinationAvailable(app, safeTo)
      await prepareExternalFile(app, from)
      if (!opts?.skipScope && !scopeOf(ctx).isInScope(from))
        throw new Error(`Access denied: ${from} is not in workspace scope`)
      const file = app.vault.getAbstractFileByPath(from)
      if (!(file instanceof TFile)) throw new Error(`File not found: ${from}`)
      if (app.vault.getAbstractFileByPath(safeTo)) {
        throw new Error(`Destination exists: ${safeTo}`)
      }
      const content = chatCopyBytes(file.path, file.basename, await app.vault.readBinary(file))
      signal?.throwIfAborted()
      // Ordinary attachments keep their bytes; a chat never exports its private fields.
      if (!opts?.scriptAuthor) await noteFileToolScriptCopy(app, file.path, safeTo, content)
      assertExternalDestinationAvailable(app, safeTo)
      await app.vault.createBinary(safeTo, content)
      scopeOf(ctx).invalidate()
      return {
        content: [
          { type: 'text', text: `Copied: ${from} → ${safeTo}${renamed ? ` (${renamed})` : ''}` },
        ],
        details: { path: safeTo },
      }
    },
  }
}
