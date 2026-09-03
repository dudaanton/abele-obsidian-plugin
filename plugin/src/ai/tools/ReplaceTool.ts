import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { ReplacementAction } from '@/entities/ReplacementAction'
import { getNoteBody, replaceNoteBody } from '@/helpers/notesUtils'
import { getEditorForFile } from '@/helpers/vaultUtils'
import { TFile } from 'obsidian'

interface ActionParam {
  type:
    | 'set-property'
    | 'remove-property'
    | 'add-to-list'
    | 'remove-from-list'
    | 'replace-in-list'
    | 'replace-in-content'
    | 'replace-in-property'
    | 'move'
  property?: string
  value?: string
  old_value?: string
  directory?: string
}

export function createReplaceTool(opts?: { skipScope?: boolean }): AgentTool {
  return {
    name: 'replace',
    label: 'Replace',
    description:
      'Apply replacement actions to a file. Supports: set-property, remove-property, ' +
      'add-to-list, remove-from-list, replace-in-list, replace-in-content, replace-in-property, move. ' +
      'Multiple actions are applied sequentially. ' +
      'For replace operations, old_value supports regex in /pattern/flags format.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault path of the file' },
        actions: {
          type: 'array',
          description: 'Replacement actions to apply sequentially',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: [
                  'set-property',
                  'remove-property',
                  'add-to-list',
                  'remove-from-list',
                  'replace-in-list',
                  'replace-in-content',
                  'replace-in-property',
                  'move',
                ],
              },
              property: { type: 'string', description: 'Frontmatter property name' },
              value: { type: 'string', description: 'New value' },
              old_value: {
                type: 'string',
                description: 'Old value for replace operations (supports /regex/flags)',
              },
              directory: { type: 'string', description: 'Target directory for move' },
            },
            required: ['type'],
          },
        },
      },
      required: ['path', 'actions'],
    },
    execute: async (_id, params) => {
      const path = params.path as string
      const rawActions = params.actions as ActionParam[]
      if (!path) throw new Error('Missing required parameter: path')
      if (!rawActions?.length) throw new Error('Missing required parameter: actions')

      if (!opts?.skipScope && !ScopeResolver.getInstance().isInScope(path)) {
        throw new Error(`Access denied: ${path} is not in workspace scope`)
      }

      const { app } = GlobalStore.getInstance()
      const file = app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`)

      // Build ReplacementAction instances
      const actions = rawActions.map((a) => {
        const ra = new ReplacementAction()
        ra.type = a.type
        ra.property = a.property || ''
        ra.value = a.value || ''
        ra.oldValue = a.old_value || ''
        ra.directory = a.directory || ''
        return ra
      })

      const invalid = actions.find((a) => !a.isValid())
      if (invalid) {
        throw new Error(`Invalid action: ${invalid.type} (missing required fields)`)
      }

      // Apply actions
      let newPath = path
      let contentChanged = false
      let newContent: string | null = null

      // Read current frontmatter
      let frontmatter: Record<string, any> = {}
      await app.fileManager.processFrontMatter(file, (fm) => {
        frontmatter = { ...fm }
      })
      let newFrontmatter = { ...frontmatter }

      for (const action of actions) {
        newFrontmatter = action.applyPropertyReplacement(newFrontmatter)
        newFrontmatter = action.applyPropertyContentReplacement(newFrontmatter)
        newPath = action.applyPathReplacement(newPath)

        if (action.type === 'replace-in-content') {
          if (newContent === null) {
            const raw = await app.vault.read(file)
            newContent = getNoteBody(raw)
          }
          newContent = action.applyContentReplacement(newContent)
          contentChanged = true
        }
      }

      // Apply frontmatter changes
      const fmChanged = JSON.stringify(frontmatter) !== JSON.stringify(newFrontmatter)
      if (fmChanged) {
        await app.fileManager.processFrontMatter(file, (fm) => {
          for (const [key, value] of Object.entries(newFrontmatter)) {
            fm[key] = value
          }
          for (const key of Object.keys(fm || {})) {
            if (!(key in newFrontmatter)) {
              delete fm[key]
            }
          }
        })
      }

      // Apply content changes
      if (contentChanged && newContent !== null) {
        const raw = await app.vault.read(file)
        const updated = replaceNoteBody(raw, newContent)
        await app.vault.modify(file, updated)
      }

      // Sync editor if open
      const editor = getEditorForFile(file)
      if (editor && (fmChanged || contentChanged)) {
        const val = await app.vault.read(file)
        editor.setValue(val)
      }

      // Move/rename
      if (newPath !== path) {
        await app.fileManager.renameFile(file, newPath)
      }

      const parts: string[] = []
      if (fmChanged) parts.push('frontmatter updated')
      if (contentChanged) parts.push('content updated')
      if (newPath !== path) parts.push(`moved to ${newPath}`)
      return {
        content: [{ type: 'text', text: parts.length ? parts.join(', ') : 'no changes' }],
        // The path after a `move` action, not the one asked about: the file that was written
        // is the one at the end. Absent when nothing was written, so a call that matched
        // nothing links the chat to nothing.
        details: parts.length ? { path: newPath } : undefined,
      }
    },
  }
}
