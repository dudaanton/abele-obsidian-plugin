import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'

export function createFindTool(): AgentTool {
  return {
    name: 'find',
    label: 'Find Files',
    description:
      'Search for files within workspace scope by name pattern, frontmatter property, or content text.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'File name pattern (case-insensitive substring match)',
        },
        property: { type: 'string', description: 'Frontmatter property name' },
        value: { type: 'string', description: 'Frontmatter property value to match' },
        content: { type: 'string', description: 'Text to search for in file content' },
        limit: { type: 'number', description: 'Max results (default 50)' },
      },
    },
    execute: async (_id, params) => {
      const {
        name,
        property,
        value,
        content,
        limit: rawLimit,
      } = params as {
        name?: string
        property?: string
        value?: string
        content?: string
        limit?: number
      }
      const scope = ScopeResolver.getInstance()
      const { app } = GlobalStore.getInstance()
      const limit = rawLimit || 50

      let paths = scope.getAccessiblePaths()

      if (name) {
        const lower = name.toLowerCase()
        paths = paths.filter((p) => p.toLowerCase().includes(lower))
      }

      if (property) {
        paths = paths.filter((p) => {
          const file = app.vault.getAbstractFileByPath(p)
          if (!file) return false
          const fm = app.metadataCache.getFileCache(file as any)?.frontmatter
          return value ? String(fm?.[property]) === value : fm?.[property] !== undefined
        })
      }

      if (content) {
        const term = content.toLowerCase()
        const matched: string[] = []
        for (const p of paths) {
          if (matched.length >= limit) break
          const file = app.vault.getAbstractFileByPath(p)
          if (!file) continue
          const text = await app.vault.cachedRead(file as any)
          if (text.toLowerCase().includes(term)) matched.push(p)
        }
        paths = matched
      }

      paths = paths.slice(0, limit)
      return {
        content: [
          {
            type: 'text',
            text: paths.length ? `${paths.length} files:\n${paths.join('\n')}` : 'No files found.',
          },
        ],
      }
    },
  }
}
