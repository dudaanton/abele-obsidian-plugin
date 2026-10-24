import type { MetadataCache } from 'obsidian'
import { parseTaskLine } from './tasksUtils'
import { isTaskType } from './taskType'

export function taskLinkPath(wikilink: string): string {
  return wikilink.slice(2, -2).split('|')[0].split('#')[0]
}

export function taskLinkOnLine(
  line: string,
  sourcePath: string,
  cache: MetadataCache | null | undefined
): string | null {
  const link = parseTaskLine(line)
  if (!link) return null
  if (!cache) return link
  const file = cache.getFirstLinkpathDest(taskLinkPath(link), sourcePath)
  return !file || isTaskType(cache.getFileCache(file)?.frontmatter?.type) ? link : null
}
