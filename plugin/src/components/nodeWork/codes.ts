// The codes the node screens speak in: a glyph per kind of change and per kind of copy, with the
// words for their tooltips. One place, so a square means the same thing in every view.
import type { KitColor } from '@/constants/colors'
import type { ChangeKind, CopySummary, FileChange } from './types'

export const changeGlyphs: Record<ChangeKind, { icon: string; color: KitColor }> = {
  modified: { icon: 'square-dot', color: 'orange' },
  added: { icon: 'square-plus', color: 'green' },
  deleted: { icon: 'square-minus', color: 'red' },
  renamed: { icon: 'square-arrow-right', color: 'blue' },
  conflict: { icon: 'triangle-alert', color: 'red' },
}

export const changeLabel = (c: FileChange) =>
  ({
    modified: 'Modified',
    added: 'New file',
    deleted: 'Deleted',
    renamed: `Renamed from ${c.from ?? ''}`,
    conflict: 'Conflict: both sides changed it',
  })[c.kind] +
  (c.stage === 'staged'
    ? ' · staged'
    : c.stage === 'partly' || c.partlyStaged
      ? ' · partly staged'
      : '') +
  (c.when ? ` · ${c.when}` : '')

export const copyIcon = (copy: CopySummary) =>
  copy.missing
    ? 'folder-x'
    : copy.kind === 'project'
      ? 'house'
      : copy.kind === 'detached'
        ? 'git-commit-horizontal'
        : 'git-branch'

export const copyKind = (copy: CopySummary) =>
  copy.missing
    ? 'Not found on the node'
    : copy.kind === 'project'
      ? 'The folder itself'
      : copy.kind === 'detached'
        ? `Detached at ${copy.branch}`
        : 'Worktree'

export const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
export const dirName = (path: string) =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
