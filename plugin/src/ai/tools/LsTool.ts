import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { scopeOf } from '../toolContext'
import { TFile, TFolder } from 'obsidian'
import { tokenOffloadsOf } from '@/sync/tokenOffloadCoordinator'
import { pathCoordinatorOf } from '@/sync/pathCoordinator'

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
    execute: async (_id, params, _signal, ctx) => {
      const scope = scopeOf(ctx)
      const { app } = GlobalStore.getInstance()
      const external = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
      const folderPath = ((params.path as string) || '').replace(/\/+$/, '')

      if (!opts?.skipScope && folderPath && !scope.isFolderInScope(folderPath)) {
        throw new Error(`Access denied: ${folderPath} is not in workspace scope`)
      }

      // If no path, list unique top-level directories of scope (or vault root if skipScope)
      if (!folderPath) {
        const paths = opts?.skipScope
          ? [
              ...app.vault
                .getFiles()
                .map((f) => f.path)
                .filter((path) => external.originalPath(path) === path),
              ...external.files().map((file) => file.path),
            ]
          : scope.getAccessiblePaths()
        const dirs = new Set<string>()
        const rootFiles: string[] = []
        for (const p of paths) {
          const slash = p.indexOf('/')
          if (slash === -1) {
            const absent = external.files().find((file) => file.path === p)
            rootFiles.push(absent ? `${p} · ${absent.size} bytes · offloaded` : p)
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
          if (external.originalPath(child.path) !== child.path) continue
          if (opts?.skipScope || scope.isInScope(child.path)) {
            entries.push(child.name)
          }
        }
      }

      for (const file of external.files()) {
        if (!opts?.skipScope && !scope.isInScope(file.path)) continue
        const prefix = folderPath + '/'
        if (!file.path.startsWith(prefix)) continue
        const name = file.path.slice(prefix.length)
        if (!name.includes('/')) entries.push(`${name} · ${file.size} bytes · offloaded`)
        else if (!entries.includes(name.split('/')[0] + '/')) entries.push(name.split('/')[0] + '/')
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
