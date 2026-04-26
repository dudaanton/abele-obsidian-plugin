import type { AgentTool } from '../client'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { normalizePath } from 'obsidian'

const SCRIPT_API_DOCS = `# Script API Reference

## Header Format
\`\`\`js
// @name My Script Name
// @description What the script does
// @param paramName string "Required string parameter"
// @param optionalParam number? "Optional number parameter"
// @param flag boolean? "Optional boolean flag"
\`\`\`
Parameter types: string, number, boolean. Add ? after type for optional.

## File Operations (all async)
- read(path) → string — read vault file content
- edit(path, oldString, newString) — replace exact string in file
- create(path, content) — create new file
- remove(path) — delete file (to trash)
- move(from, to) — move/rename file
- copy(from, to) — copy file
- ls(path?) → string[] — list folder contents
- find({ name?, property?, value?, content? }) → string[] — search files

## Templates
- applyTemplate(path, variables?) → string — create note from template; variables is { name: value }
- listTemplates(type?) → string — list available templates, optionally filtered by type

## Network
- fetch(url, opts?) → { status, headers, data, text } — HTTP request; opts: { method?, headers?, body? }. Supports \${abele_key:name} secret substitution in url/headers/body
- downloadImage(url, filename?) → string — download image to vault, returns path
- downloadFile(url, filename?, extension?) → string — download any file to vault, returns path

## AI
- agent(task, opts?) → string — delegate task to AI sub-agent; opts: { model?: 'primary' | 'delegate' | 'wise' }
- generateImage(prompt) → string — generate image from text prompt, returns vault path

## Scripts
- runScript(name, params?) → string — call another script by name, returns its output

## UI
- notice(message, timeout?) — show Obsidian notification
- setStatus(text) — set status bar text (auto-cleared when script ends)
- form(fields) → object|null — show form modal (command palette only); fields: [{ name, label, type?: 'text'|'textarea'|'select', options?, default?, required? }]

## Globals
- params — object with resolved parameter values
- signal — AbortSignal for cancellation
- log(...args) — captured output (returned as result)

All file operations respect workspace scope. Scripts run with 60s timeout.

## Example
\`\`\`js
// @name Summarize Note
// @description Read a note and create a summary using AI
// @param path string "Path to the note"
const content = await read(params.path)
const summary = await agent("Summarize this note concisely:\\n\\n" + content)
await create(params.path.replace('.md', ' Summary.md'), summary)
return "Summary created"
\`\`\``

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
