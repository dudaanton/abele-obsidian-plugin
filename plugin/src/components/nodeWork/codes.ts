import { streamBLabel } from '@/i18n/streamBLabels'
import { t } from '@/i18n'
import { streamBCount } from '@/i18n/streamBCounts'
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
    modified: streamBLabel('Modified'),
    added: streamBLabel('New file'),
    deleted: streamBLabel('Deleted'),
    renamed: t('streamBMeta.5f2b9e1925', { path: c.from ?? '' }),
    conflict: streamBLabel('Conflict: both sides changed it'),
  })[c.kind] +
  (c.stage === 'staged'
    ? streamBLabel(' · staged')
    : c.stage === 'partly' || c.partlyStaged
      ? streamBLabel(' · partly staged')
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
    ? streamBLabel('Not found on the node')
    : copy.kind === 'project'
      ? streamBLabel('The folder itself')
      : copy.kind === 'detached'
        ? t('streamBMeta.358c86cabc', { branch: copy.branch })
        : t('streamBMeta.c893ba3003')

/** A file's glyph by its kind, as an icon set for the file explorer draws them. */
export function fileIcon(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (name.startsWith('.env')) return 'file-lock'
  if (/^(md|txt|rst|adoc)$/.test(ext) || /^(readme|license|changelog)/i.test(name))
    return 'file-text'
  if (/^(json|jsonc)$/.test(ext)) return 'file-json'
  if (/^(ya?ml|toml|ini|cfg|conf)$/.test(ext) || name.startsWith('.')) return 'file-cog'
  if (/^(png|jpe?g|gif|svg|webp|avif|heic|bmp|ico)$/.test(ext)) return 'file-image'
  if (/^(mp4|mov|webm|mkv)$/.test(ext)) return 'file-video'
  if (/^(mp3|wav|ogg|flac|m4a)$/.test(ext)) return 'file-audio'
  if (/^(zip|gz|tgz|tar|7z|rar)$/.test(ext)) return 'file-archive'
  if (/^(csv|tsv|xlsx?|ods)$/.test(ext)) return 'file-spreadsheet'
  if (/^(sh|bash|zsh|fish|ps1)$/.test(ext)) return 'file-terminal'
  if (/^(pdf|epub|docx?)$/.test(ext)) return 'file-type'
  if (/^(ttf|otf|woff2?)$/.test(ext)) return 'file-type-2'
  if (/^(lock)$/.test(ext)) return 'file-lock'
  return /\./.test(name) ? 'file-code' : 'file'
}

export const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
export const dirName = (path: string) =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

export const plural = streamBCount
