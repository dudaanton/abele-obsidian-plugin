import { TFile, type App, type ReferenceCache } from 'obsidian'
import { encodeLinkPath } from '@/drawing/embedRelink'
import { mediaReferencesInText, resolveMediaTarget } from './mediaReferences'

export function equalMediaBytes(left: ArrayBuffer, right: ArrayBuffer): boolean {
  if (left.byteLength !== right.byteLength) return false
  const a = new Uint8Array(left)
  const b = new Uint8Array(right)
  return a.every((byte, index) => byte === b[index])
}

/** Only replace the target token; labels, sizes, fragments and titles are not paths. */
function replaceTarget(original: string, keep: string): string {
  const wiki = /^(!?\[\[)([^\]|#]*)([\s\S]*\]\])$/.exec(original)
  if (wiki) return wiki[1] + keep + wiki[3]
  const start = original.indexOf('](')
  if (start >= 0) {
    let from = start + 2
    while (/\s/.test(original[from] ?? '') && from < original.length) from++
    const angle = original[from] === '<'
    if (angle) from++
    let to = from
    let depth = 0
    for (; to < original.length; to++) {
      const c = original[to]
      if (c === '\\') {
        to++
        continue
      }
      if (angle) {
        if (c === '>') break
      } else {
        if (c === '(') depth++
        else if (c === ')') {
          if (depth === 0) break
          depth--
        } else if (/\s/.test(c) && depth === 0) break
      }
    }
    const fragmentAt = original.slice(from, to).indexOf('#')
    const fragment = fragmentAt < 0 ? '' : original.slice(from + fragmentAt, to)
    return original.slice(0, from) + encodeLinkPath(keep) + fragment + original.slice(to)
  }
  throw new Error('Unsupported link syntax. Duplicate files were kept.')
}

/** Cached spans must still describe the text being changed, not an older cache revision. */
export function rewriteMediaLinks(
  text: string,
  links: readonly ReferenceCache[],
  resolve: (target: string) => string | null,
  remove: ReadonlySet<string>,
  keep: string
): { text: string; remainder: string } {
  let next = text
  let remainder = text
  const seen = new Set<number>()
  for (const link of [...links].sort((a, b) => b.position.start.offset - a.position.start.offset)) {
    const path = resolve(link.link)
    if (!path || !remove.has(path)) continue
    const from = link.position.start.offset
    const to = link.position.end.offset
    if (seen.has(from)) continue
    seen.add(from)
    if (text.slice(from, to) !== link.original) {
      throw new Error('Link metadata changed. Scan again before merging.')
    }
    next = next.slice(0, from) + replaceTarget(link.original, keep) + next.slice(to)
    remainder = remainder.slice(0, from) + remainder.slice(to)
  }
  return { text: next, remainder }
}

export async function mergeMediaFiles(
  app: App,
  keepPath: string,
  removePaths: string[]
): Promise<void> {
  const fileAt = (path: string): TFile => {
    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) throw new Error(`File no longer exists: ${path}`)
    return file
  }
  const assertEqual = async (path: string) => {
    const keep = await app.vault.readBinary(fileAt(keepPath))
    const duplicate = await app.vault.readBinary(fileAt(path))
    if (!equalMediaBytes(keep, duplicate))
      throw new Error('File bytes differ. Scan again before merging.')
  }
  for (const path of removePaths) await assertEqual(path)

  const remove = new Set(removePaths)
  const plans: { file: TFile; before: string; after: string }[] = []
  const expectedSources = new Map<string, string>()
  const isSource = (file: TFile) =>
    ['md', 'svg', 'abchat', 'json', 'jsonl', 'canvas', 'base', 'yaml', 'yml'].includes(
      file.extension.toLowerCase()
    )
  // Prepare every rewrite before touching anything. Structured attachments and unsupported
  // references are a reason to keep the duplicate, not to silently break a chat or a property.
  for (const file of app.vault.getFiles()) {
    const ext = file.extension.toLowerCase()
    if (!isSource(file)) continue
    const before = await app.vault.read(file)
    let after = before
    let remainder = before
    if (ext === 'md') {
      const cache = app.metadataCache.getFileCache(file)
      const rewritten = rewriteMediaLinks(
        before,
        [...(cache?.links ?? []), ...(cache?.embeds ?? [])],
        (target) => resolveMediaTarget(app, target, file.path),
        remove,
        keepPath
      )
      after = rewritten.text
      remainder = rewritten.remainder
      // Code examples are not references. The actual edits above use Obsidian's parsed spans.
      remainder = remainder
        .replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '')
        .replace(/(`+)[\s\S]*?\1/g, '')
    }
    const remainingRefs = mediaReferencesInText(
      app,
      remainder,
      file.path,
      ext !== 'md' && ext !== 'svg'
    )
    if ([...remove].some((path) => remainingRefs.has(path))) {
      throw new Error(
        `Reference in ${file.path} cannot be safely rewritten. Duplicate files were kept.`
      )
    }
    expectedSources.set(file.path, after)
    if (after !== before) plans.push({ file, before, after })
  }
  for (const plan of plans) {
    await app.vault.process(plan.file, (current) => {
      if (current !== plan.before)
        throw new Error('Note changed during merge. Duplicate files were kept.')
      return plan.after
    })
  }
  for (const path of removePaths) {
    // References may have appeared while the note writes were in flight. Fail closed on any
    // changed/new source, including formats for which Obsidian has no metadata index.
    for (const source of app.vault.getFiles().filter(isSource)) {
      if ((await app.vault.read(source)) !== expectedSources.get(source.path)) {
        throw new Error('References changed during merge. Duplicate files were kept.')
      }
    }
    // A scan (or the writes above) may have taken a while. Never trust preview-time bytes.
    await assertEqual(path)
    await app.fileManager.trashFile(fileAt(path))
    expectedSources.delete(path)
  }
}
