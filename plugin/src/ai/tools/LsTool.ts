import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { TFile, TFolder } from 'obsidian'

export function createLsTool(opts?: { skipScope?: boolean }): AgentTool {
  return {
    name: 'ls',
    label: 'List Directory',
    description:
      'List files and subdirectories in a folder. Only shows items within workspace scope. Use without path to list scope root folders.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Folder path. Omit to list top-level scope entries.' },
      },
    },
    execute: async (_id, params) => {
      const scope = ScopeResolver.getInstance()
      const { app } = GlobalStore.getInstance()
      const folderPath = (params.path as string) || ''

      if (!opts?.skipScope && folderPath && !scope.isFolderInScope(folderPath)) {
        throw new Error(`Access denied: ${folderPath} is not in workspace scope`)
      }

      // If no path, list unique top-level directories of scope (or vault root if skipScope)
      if (!folderPath) {
        const paths = opts?.skipScope
          ? app.vault.getMarkdownFiles().map((f) => f.path)
          : scope.getAccessiblePaths()
        const dirs = new Set<string>()
        const rootFiles: string[] = []
        for (const p of paths) {
          const slash = p.indexOf('/')
          if (slash === -1) {
            rootFiles.push(p)
          } else {
            dirs.add(p.substring(0, slash))
          }
        }
        const entries = [...[...dirs].sort().map((d) => d + '/'), ...rootFiles.sort()]
        return {
          content: [{ type: 'text', text: entries.length ? entries.join('\n') : '(empty scope)' }],
        }
      }

      const folder = app.vault.getAbstractFileByPath(folderPath)
      if (!(folder instanceof TFolder)) throw new Error(`Not a folder: ${folderPath}`)

      const entries: string[] = []
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          if (opts?.skipScope || scope.isFolderInScope(child.path)) {
            entries.push(child.name + '/')
          }
        } else if (child instanceof TFile) {
          if (opts?.skipScope || scope.isInScope(child.path)) {
            entries.push(child.name)
          }
        }
      }

      entries.sort()
      return {
        content: [
          { type: 'text', text: entries.length ? entries.join('\n') : '(empty or no access)' },
        ],
      }
    },
  }
}
