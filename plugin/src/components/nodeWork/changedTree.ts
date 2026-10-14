// The changed files of a copy as a tree of the folders that hold them, the way a source control
// pane draws it: folders before files, each by name, and a folder whose only entry is another
// folder joined with it into one row ("src/components"), so a deep change is not a staircase.
import type { FileChange, TreeEntry } from './types'

export function changedTree(changes: FileChange[]): TreeEntry[] {
  const root: TreeEntry = { path: '', name: '', kind: 'folder', children: [] }
  for (const change of changes) {
    const parts = change.path.split('/')
    let at = root
    parts.slice(0, -1).forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/')
      let next = at.children!.find((e) => e.kind === 'folder' && e.path === path)
      if (!next) at.children!.push((next = { path, name, kind: 'folder', children: [] }))
      at = next
    })
    at.children!.push({ path: change.path, name: parts[parts.length - 1], kind: 'file', change })
  }
  const tidy = (list: TreeEntry[]): TreeEntry[] =>
    list
      .map((e) => {
        if (e.kind !== 'folder') return e
        let folder = e
        while (folder.children!.length === 1 && folder.children![0].kind === 'folder') {
          const only = folder.children![0]
          folder = { ...only, name: `${folder.name}/${only.name}` }
        }
        return { ...folder, children: tidy(folder.children!) }
      })
      .sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1
      )
  return tidy(root.children!)
}
