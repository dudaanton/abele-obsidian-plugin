import { t } from '@/i18n'
import { formatBytes } from '@/helpers/displayFormat'
import type { ExternalFile } from './types'

/** The glyph of a file's kind, by its type. */
export function externalIcon(file: Pick<ExternalFile, 'mime' | 'name'>): string {
  const [kind, sub] = file.mime.split('/')
  if (kind === 'image') return 'file-image'
  if (kind === 'audio') return 'file-audio'
  if (kind === 'video') return 'file-video'
  if (sub === 'pdf' || sub === 'epub+zip') return 'file'
  if (sub === 'zip') return 'file-archive'
  if (kind === 'text') return 'file-text'
  return 'file'
}

/** What kind of file, in a word: the extension in capitals, as Finder names it. */
export function externalKind(file: Pick<ExternalFile, 'name'>): string {
  const dot = file.name.lastIndexOf('.')
  return dot > 0 ? file.name.slice(dot + 1).toUpperCase() : t('streamC.50009ce1da4d15e1')
}

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const two = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

/** The quiet facts after the name: kind, size, dimensions or length. */
export function externalFacts(file: ExternalFile): string[] {
  const facts = [externalKind(file), formatBytes(file.size)]
  if (file.width && file.height) facts.push(`${file.width} × ${file.height}`)
  if (file.duration !== undefined) facts.push(clock(file.duration))
  return facts
}

export { formatBytes }
