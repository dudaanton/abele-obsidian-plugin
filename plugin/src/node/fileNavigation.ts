import type { PathTarget } from './NodePathModel'
import type { NodePathTabState } from './nodePathNavigation'
import { parseNodeRepositoryLink } from '@/repository/nodeLinks'
import type { InjectionKey } from 'vue'
export const FILE_NAVIGATION: InjectionKey<(url: string) => boolean> =
  Symbol('node-file-navigation')

/** Working-file navigation stays in the file surface; historical links keep their revision. */
export function fileNavigation(
  target: PathTarget,
  url: string
): Extract<NodePathTabState, { kind: 'file' }> | undefined {
  const link = parseNodeRepositoryLink(url)
  if (
    !link ||
    link.source.provider !== 'node' ||
    link.source.node !== target.registrationId ||
    link.source.project !== target.projectId ||
    link.source.workspace !== target.id ||
    link.location.kind !== 'file' ||
    !(
      link.revision?.kind === 'working-tree' ||
      link.location.ref.startsWith('working-') ||
      link.location.ref === 'WORKTREE'
    )
  )
    return
  return {
    kind: 'file',
    target,
    path: link.location.path,
    ...(link.location.lines ? { line: link.location.lines.from } : {}),
    ...(link.location.lines && link.location.lines.to !== link.location.lines.from
      ? { endLine: link.location.lines.to }
      : {}),
  }
}
