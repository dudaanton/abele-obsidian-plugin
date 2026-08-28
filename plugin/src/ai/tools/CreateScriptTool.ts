import type { AgentTool } from '../client'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { normalizePath } from 'obsidian'
import { SCRIPT_API_DOCS } from '@/scripting/apiDocs'

export function createScriptApiDocsTool(): AgentTool {
  return {
    name: 'script_api_docs',
    label: 'Script API Docs',
    description:
      'Get the full API reference for writing Abele scripts. Call this before create_script to see all available functions.',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({
      content: [{ type: 'text', text: SCRIPT_API_DOCS }],
    }),
  }
}

export function createCreateScriptTool(): AgentTool {
  return {
    name: 'create_script',
    label: 'Create Script',
    description:
      'Create a new JavaScript script in the scripts folder. Use script_api_docs first to get the full API reference for writing scripts.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Script file name (without .js extension)' },
        content: { type: 'string', description: 'Full script content including header comments' },
      },
      required: ['name', 'content'],
    },
    execute: async (_id, params) => {
      const name = params.name as string
      const content = params.content as string
      if (!name) throw new Error('Missing required parameter: name')
      if (!content) throw new Error('Missing required parameter: content')

      const config = AbeleConfig.getInstance().ai
      if (!config.scriptsEnabled || !config.scriptsFolder) {
        throw new Error('Scripts are not enabled or scripts folder is not configured.')
      }

      const path = normalizePath(`${config.scriptsFolder}/${name}.js`)
      const { app } = GlobalStore.getInstance()

      // Ensure folder exists
      const folderPath = path.substring(0, path.lastIndexOf('/'))
      if (folderPath && !app.vault.getAbstractFileByPath(folderPath)) {
        await app.vault.createFolder(folderPath)
      }

      const existing = app.vault.getAbstractFileByPath(path)
      if (existing) {
        throw new Error(`Script already exists: ${path}. Use edit tool to modify it.`)
      }

      await app.vault.create(path, content)
      ScopeResolver.getInstance().addFile(path)

      return {
        content: [
          {
            type: 'text',
            text: `Script created: ${path}. It will be available as a command after auto-discovery.`,
          },
        ],
        details: { diff: { old: '', new: content } },
      }
    },
  }
}
