/**
 * Where a rule applies: folders and globs, note types, a property. Pure apart from the metadata
 * cache, which is read for the type and the property — so a note that is out of a rule's reach
 * costs nothing to skip, without reading its text.
 */
import type { App, TFile } from 'obsidian'
import { matchesFilter } from '@/helpers/noteFilter'
import type { LintRuleSetting } from './settings'

const GLOB = /[*?[]/

const clean = (pattern: string): string =>
  pattern
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+$/, '')

/** A glob as a regular expression over a whole path: `**` crosses folders, `*` and `?` do not. */
function globRegex(glob: string): RegExp {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      // `**/` also matches no folder at all.
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?'
        i += 2
      } else {
        out += '.*'
        i += 1
      }
    } else if (c === '*') out += '[^/]*'
    else if (c === '?') out += '[^/]'
    else out += c.replace(/[.+^${}()|\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`, 'i')
}

/**
 * Whether a note's path is covered by a pattern: a folder (the note is in it, at any depth), a
 * note's own path with or without `.md`, or a glob matched against the path or one of its folders.
 */
export function pathMatches(path: string, pattern: string): boolean {
  const p = clean(pattern)
  if (!p) return false
  if (!GLOB.test(p)) {
    const lower = path.toLowerCase()
    const want = p.toLowerCase()
    return lower === want || lower === `${want}.md` || lower.startsWith(`${want}/`)
  }
  const re = globRegex(p)
  if (re.test(path)) return true
  const parts = path.split('/')
  for (let i = parts.length - 1; i > 0; i--) {
    if (re.test(parts.slice(0, i).join('/'))) return true
  }
  return false
}

export const anyMatch = (path: string, patterns: string[]): boolean =>
  patterns.some((p) => pathMatches(path, p))

/** Whether the rule, set up this way, looks at this note. */
export function ruleApplies(app: App, file: TFile, setting: LintRuleSetting): boolean {
  if (setting.folders.length && !anyMatch(file.path, setting.folders)) return false
  if (anyMatch(file.path, setting.exclude)) return false
  if (setting.types.length) {
    const type = app.metadataCache.getFileCache(file)?.frontmatter?.type as unknown
    const types = (Array.isArray(type) ? type : [type]).map((t) => String(t ?? '').trim())
    if (!types.some((t) => setting.types.includes(t))) return false
  }
  if (setting.property) {
    const filter = { property: setting.property, value: setting.value || undefined }
    if (!matchesFilter(app, file, filter)) return false
  }
  return true
}
