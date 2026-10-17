import type { App } from 'obsidian'
import { folderMutations } from './folderMutations'

export type ScopeRootIssue =
  | { kind: 'deleted' }
  | { kind: 'moved'; path: string }
  | { kind: 'server-renamed'; from: string; to: string }

/** Observe the root before a recursive vault operation can report its children. */
export function watchScopeRoot(
  app: App,
  root: string,
  unavailable: (issue: ScopeRootIssue) => void
): () => void {
  if (root === '/') return () => {}
  let deleted = false
  const notice = (issue: ScopeRootIssue) => {
    if (deleted || (issue.kind === 'moved' && issue.path === root)) return
    if (issue.kind === 'moved') root = issue.path
    else deleted = true
    unavailable(issue)
  }
  const contains = (path: string) => root === path || root.startsWith(path + '/')
  const stopMutation = folderMutations(app.vault).watch((path, to) => {
    if (contains(path))
      notice(
        to === undefined
          ? { kind: 'deleted' }
          : { kind: 'moved', path: to + root.slice(path.length) }
      )
  })
  const refs = [
    app.vault.on('delete', (file) => {
      if (deleted) return
      if (
        contains(file.path) ||
        (file.path.startsWith(root + '/') && !app.vault.getAbstractFileByPath(root))
      )
        notice({ kind: 'deleted' })
    }),
    app.vault.on('rename', (file, from) => {
      if (deleted) return
      if (contains(from)) notice({ kind: 'moved', path: file.path + root.slice(from.length) })
    }),
  ]
  return () => {
    stopMutation()
    refs.forEach((ref) => app.vault.offref(ref))
  }
}
