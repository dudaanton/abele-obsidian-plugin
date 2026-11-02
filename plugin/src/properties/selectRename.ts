import type { App } from 'obsidian'
import { selectValues } from './select'

/** Cache narrows the candidates; only current frontmatter may authorize a replacement.
 * Writes are sequential and awaited so a failure stops the operation and reaches its caller.
 * Repeating after a partial failure is safe: already renamed values no longer match.
 */
export async function renameSelectValueInNotes(
  app: App,
  key: string,
  from: string,
  to: string
): Promise<void> {
  const lower = (value: string) => value.trim().toLowerCase()
  const matches = (value: unknown) =>
    (typeof value === 'string' || typeof value === 'number') && lower(String(value)) === lower(from)
  for (const file of app.vault.getMarkdownFiles()) {
    const cached = app.metadataCache.getFileCache(file)?.frontmatter
    const cachedKey = cached && Object.keys(cached).find((name) => lower(name) === lower(key))
    if (!cachedKey || !selectValues(cached[cachedKey]).some(matches)) continue
    await app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => {
      const currentKey = Object.keys(front).find((name) => lower(name) === lower(key))
      if (!currentKey) return
      const value = front[currentKey]
      if (Array.isArray(value)) {
        if (value.some(matches))
          front[currentKey] = value.map((item) => (matches(item) ? to : item))
      } else if (matches(value)) front[currentKey] = to
    })
  }
}
