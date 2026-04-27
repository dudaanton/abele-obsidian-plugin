import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { Criterion } from '@/entities/Criterion'
import { getNoteBody } from '@/helpers/notesUtils'
import { TFile } from 'obsidian'
import { stringifyYaml } from 'obsidian'

interface CriterionParam {
  type: 'path' | 'name' | 'property' | 'content'
  operator:
    | 'equals'
    | 'contains'
    | 'notContains'
    | 'startsWith'
    | 'endsWith'
    | 'regex'
    | 'exists'
    | 'notExists'
  property?: string
  value?: string
}

export function createFindTool(): AgentTool {
  return {
    name: 'find',
    label: 'Find Files',
    description:
      'Search for files using criteria. Multiple criteria are combined with AND logic. ' +
      'Each criterion has a type (path, name, property, content), an operator ' +
      '(equals, contains, notContains, startsWith, endsWith, regex, exists, notExists), ' +
      'and optionally property (for property type) and value. ' +
      "Set include_frontmatter to see each file's properties in the results.",
    parameters: {
      type: 'object',
      properties: {
        criteria: {
          type: 'array',
          description: 'Search criteria (AND logic). Each: {type, operator, property?, value?}',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['path', 'name', 'property', 'content'],
                description: 'What to match against',
              },
              operator: {
                type: 'string',
                enum: [
                  'equals',
                  'contains',
                  'notContains',
                  'startsWith',
                  'endsWith',
                  'regex',
                  'exists',
                  'notExists',
                ],
                description: 'How to match. exists/notExists only for property type.',
              },
              property: {
                type: 'string',
                description: 'Frontmatter property name (required when type is property)',
              },
              value: {
                type: 'string',
                description: 'Value to match (not needed for exists/notExists)',
              },
            },
            required: ['type', 'operator'],
          },
        },
        include_frontmatter: {
          type: 'boolean',
          description: 'Include frontmatter properties for each file in results (default false)',
        },
        limit: { type: 'number', description: 'Max results (default 50)' },
      },
      required: ['criteria'],
    },
    execute: async (_id, params) => {
      const {
        criteria: rawCriteria,
        include_frontmatter: includeFm,
        limit: rawLimit,
      } = params as {
        criteria: CriterionParam[]
        include_frontmatter?: boolean
        limit?: number
      }

      if (!rawCriteria?.length) {
        return { content: [{ type: 'text', text: 'No criteria provided.' }] }
      }

      const scope = ScopeResolver.getInstance()
      const { app } = GlobalStore.getInstance()
      const limit = rawLimit || 50

      // Build Criterion instances
      const criteria = rawCriteria.map((c) => {
        const cr = new Criterion()
        cr.type = c.type
        cr.operator = c.operator
        cr.property = c.property || ''
        cr.value = c.value || ''
        return cr
      })

      const pathCriteria = criteria.filter((c) => c.type === 'path')
      const nameCriteria = criteria.filter((c) => c.type === 'name')
      const propertyCriteria = criteria.filter((c) => c.type === 'property')
      const contentCriteria = criteria.filter((c) => c.type === 'content')

      let paths = scope.getAccessiblePaths()

      // Path & name filters (cheap, no I/O)
      if (pathCriteria.length) {
        paths = paths.filter((p) => pathCriteria.every((c) => c.checkPathCriterion(p)))
      }
      if (nameCriteria.length) {
        paths = paths.filter((p) => {
          const name = p.split('/').pop()?.replace(/\.md$/, '') || ''
          return nameCriteria.every((c) => c.checkPathCriterion(name))
        })
      }

      // Property filter (uses cached metadata, fast)
      if (propertyCriteria.length) {
        paths = paths.filter((p) => {
          const file = app.vault.getAbstractFileByPath(p)
          if (!file) return false
          const fm = app.metadataCache.getFileCache(file as any)?.frontmatter || {}
          return propertyCriteria.every((c) => c.checkPropertyCriterion(fm))
        })
      }

      // Content filter (reads files, expensive — run last)
      if (contentCriteria.length) {
        const matched: string[] = []
        for (const p of paths) {
          if (matched.length >= limit) break
          const file = app.vault.getAbstractFileByPath(p)
          if (!file) continue
          const text = await app.vault.cachedRead(file as any)
          const body = getNoteBody(text)
          if (contentCriteria.every((c) => c.checkContentCriterion(body))) {
            matched.push(p)
          }
        }
        paths = matched
      }

      paths = paths.slice(0, limit)

      if (!paths.length) {
        return { content: [{ type: 'text', text: 'No files found.' }] }
      }

      // Format output
      let text: string
      if (includeFm) {
        const lines: string[] = []
        for (const p of paths) {
          const file = app.vault.getAbstractFileByPath(p)
          const fm =
            file instanceof TFile ? app.metadataCache.getFileCache(file)?.frontmatter : undefined
          if (fm) {
            const clean = { ...fm }
            delete clean.position
            lines.push(`${p}\n${stringifyYaml(clean).trim()}`)
          } else {
            lines.push(p)
          }
        }
        text = `${paths.length} files:\n\n${lines.join('\n\n')}`
      } else {
        text = `${paths.length} files:\n${paths.join('\n')}`
      }

      return { content: [{ type: 'text', text }] }
    },
  }
}
