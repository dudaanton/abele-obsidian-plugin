import { localGroupCandidates } from './localGroupCandidates'
import type { ShareItem } from './shareSets'

export interface ScopeIndexEntry {
  path: string
  folder?: boolean
  groups?: unknown
  links?: readonly string[]
}

/** Host index only: picking never needs file contents, a disk walk or a sync engine. */
export function scopeInventory(entries: readonly ScopeIndexEntry[]) {
  const notes = entries.filter((entry) => !entry.folder && /\.md$/i.test(entry.path))
  const byPath = new Map(entries.map((entry) => [entry.path, entry]))
  const choices: ShareItem[] = [{ kind: 'vault', id: 'local:vault', path: '/' }]
  for (const entry of entries) {
    choices.push({
      kind: entry.folder ? 'folder' : 'file',
      id: 'local:' + (entry.folder ? 'folder:' : 'file:') + entry.path,
      path: entry.path,
    })
    if (!entry.folder && /\.md$/i.test(entry.path))
      choices.push({ kind: 'group', id: 'local:group:' + entry.path, path: entry.path })
  }
  return {
    choices,
    members(root: string): string[] {
      const members = localGroupCandidates(
        root,
        notes.map((note) => ({ path: note.path, groups: note.groups }))
      )
      const result = new Set(members)
      for (const path of members)
        for (const link of byPath.get(path)?.links ?? [])
          if (byPath.has(link) && !byPath.get(link)?.folder && !/\.md$/i.test(link))
            result.add(link)
      return [...result]
    },
  }
}
