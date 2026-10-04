import type { AgentTool } from '../client'
import { createVaultZip } from '@/archive/vaultZip'

export function createZipTool(): AgentTool {
  return {
    name: 'zip',
    label: 'Create ZIP',
    description:
      'Create a new .zip archive from explicitly selected context-visible files, preserving raw bytes. Optional entry names choose virtual subfolders/renames; defaults preserve vault hierarchy. No folders, globs, overwrite or automatic renaming. Any inaccessible source rejects the whole request; approval only authorizes creation, never source access.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Exact new vault-relative .zip output path' },
        files: {
          type: 'array',
          minItems: 1,
          maxItems: 5000,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', description: 'Exact context-visible source file path' },
              name: {
                type: 'string',
                description:
                  'Optional virtual relative ZIP entry path; separators become / and Unicode becomes NFC',
              },
            },
            required: ['path'],
          },
        },
      },
      required: ['path', 'files'],
    },
    execute: async (_id, params, signal, ctx) => {
      if (!ctx?.agentId || !ctx.app || !ctx.validateWrite)
        throw new Error('ZIP requires a bound agent invocation context')
      const saved = await createVaultZip(params, {
        app: ctx.app,
        scope: ctx.scope,
        agentId: ctx.agentId,
        validateWrite: ctx.validateWrite,
        signal,
      })
      return {
        content: [
          {
            type: 'text',
            text: `Saved ZIP: ${saved.path} (${saved.count} files, ${saved.size} bytes)${saved.warning ? `. ${saved.warning}` : ''}`,
          },
        ],
        details: saved,
      }
    },
  }
}
