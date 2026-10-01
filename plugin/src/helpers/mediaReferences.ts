import type { App } from 'obsidian'
import { parseYaml } from 'obsidian'
import { markdownLinkTargets } from './markdownLinkTargets'

/** Formats whose references are not included in Obsidian's Markdown link index. */
const STRUCTURED = new Set(['abchat', 'json', 'jsonl', 'canvas', 'base', 'yaml', 'yml'])

const MEDIA_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'mp4',
  'webm',
  'ogv',
  'mov',
  'mkv',
  'mp3',
  'ogg',
  'wav',
  'flac',
  'aac',
  'm4a',
  'pdf',
]

export function resolveMediaTarget(app: App, target: string, source: string): string | null {
  const paths = resolveMediaTargets(app, target, source)
  return paths.length === 1 ? paths[0] : null
}

function resolveMediaTargets(app: App, target: string, source: string): string[] {
  target = target.trim().replace(/^<|>$/g, '').split('#')[0]
  if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return []
  try {
    target = decodeURIComponent(target)
  } catch {
    /* A literal percent in a vault name. */
  }
  target = target.replace(/\\([ ()])/g, '$1')
  const resolved = app.metadataCache.getFirstLinkpathDest(target, source)
  if (resolved) return [resolved.path]
  // Obsidian resolves extensionless notes, but not extensionless attachments. Preserve the
  // cleanup tool's support for those links without overriding a real note of the same name.
  // Multiple possible extensions count as used, but cannot be safely rewritten.
  if (target.length < 500 && !/[\r\n[\]<>]/.test(target)) {
    const candidates = MEDIA_EXTENSIONS.flatMap((ext) => {
      const file = app.metadataCache.getFirstLinkpathDest(`${target}.${ext}`, source)
      return file ? [file.path] : []
    })
    if (candidates.length) return [...new Set(candidates)]
  }
  return [target]
}

/**
 * Conservative reference collection for destructive media operations. A read/parse error is
 * deliberately fatal: an unreadable chat is not evidence that its attachments are unused.
 * Keep historical log records too, since they can still be recovered from the chat.
 */
export async function collectMediaReferences(app: App): Promise<Set<string>> {
  const referenced = new Set<string>()
  for (const links of Object.values(app.metadataCache.resolvedLinks)) {
    for (const path of Object.keys(links)) referenced.add(path)
  }
  for (const file of app.vault.getFiles()) {
    const ext = file.extension.toLowerCase()
    if (ext !== 'md' && ext !== 'svg' && !STRUCTURED.has(ext)) continue
    const text = await app.vault.read(file)
    for (const path of mediaReferencesInText(app, text, file.path, STRUCTURED.has(ext))) {
      referenced.add(path)
    }
    if (ext === 'md') {
      // Preserve support for properties represented by Obsidian's cache as nested values.
      collectStrings(app.metadataCache.getFileCache(file)?.frontmatter, (s) => {
        for (const path of referencesInString(app, s, file.path)) referenced.add(path)
      })
    }
  }
  return referenced
}

export function mediaReferencesInText(
  app: App,
  text: string,
  source: string,
  structured = false
): Set<string> {
  const paths = new Set<string>()
  const add = (s: string) => {
    for (const path of referencesInString(app, s, source)) paths.add(path)
  }
  if (structured) {
    const ext = source.split('.').pop().toLowerCase()
    if (['base', 'yaml', 'yml'].includes(ext)) collectStrings(parseYaml(text), add)
    else {
      let value: unknown
      try {
        value = JSON.parse(text)
      } catch {
        // Append-only chats and other JSON logs contain one complete object per line.
        value = text
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line))
      }
      collectStrings(value, add)
    }
  } else {
    add(text)
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
    if (frontmatter) collectStrings(parseYaml(frontmatter[1]), add)
  }
  return paths
}

function collectStrings(value: unknown, add: (s: string) => void): void {
  if (typeof value === 'string') add(value)
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, add))
  else if (value && typeof value === 'object')
    Object.values(value).forEach((v) => collectStrings(v, add))
}

function referencesInString(app: App, value: string, source: string): Set<string> {
  const paths = new Set<string>()
  const add = (target: string) => {
    for (const path of resolveMediaTargets(app, target, source)) paths.add(path)
  }
  add(value)
  for (const m of value.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) add(m[1])
  for (const { start, end } of markdownLinkTargets(value)) add(value.slice(start, end))
  for (const m of value.matchAll(/(?:src|poster|href)\s*=\s*["']([^"']+)["']/gi)) add(m[1])
  return paths
}
