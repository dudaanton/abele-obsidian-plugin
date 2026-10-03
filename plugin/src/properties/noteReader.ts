import type { App, TFile } from 'obsidian'
import { parseNoteContent } from '@/helpers/notesUtils'
import { cachedFrontmatter } from './noteCache'

export type NotePropertySource =
  | { source: 'cache' }
  | { source: 'disk' }
  | { source: 'text'; text: string }

/**
 * Explicit sources, not interchangeable parsers. Cache keeps host values; disk/text use the
 * installed front-matter reader and retain the existing reserved content/body contract.
 * Editor callers pass their captured text; reading a background editor is not a disk read.
 */
export async function readNoteProperties(
  app: App,
  file: TFile,
  source: NotePropertySource
): Promise<Record<string, any> | null> {
  if (source.source === 'cache') return cachedFrontmatter(app.metadataCache.getFileCache(file))
  const content = source.source === 'text' ? source.text : await app.vault.read(file)
  return parseNoteContent(file, content)
}
