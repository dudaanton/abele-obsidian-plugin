import { diff } from '@codemirror/merge'
import type { DiffLine } from '../patch'

export interface TextDiff {
  lines: DiffLine[]
  additions: number
  deletions: number
}
export type BlobContent =
  | { kind: 'text' | 'lfs'; text: string }
  | { kind: 'binary' | 'unsupported'; text?: undefined }

export function decodeBlob(bytes: Uint8Array): BlobContent {
  if ((bytes[0] === 255 && bytes[1] === 254) || (bytes[0] === 254 && bytes[1] === 255))
    return { kind: 'unsupported' }
  if (bytes.includes(0)) return { kind: 'binary' }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return {
      kind: /^version https:\/\/git-lfs.github.com\/spec\/v1\r?\n/.test(text) ? 'lfs' : 'text',
      text,
    }
  } catch {
    return { kind: 'unsupported' }
  }
}

/** Line tokens retain their terminators: an empty file is not one empty line. */
const tokens = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? []

/** Reuse CodeMirror's diff engine on line identities, not word-cleaned character changes. */
export function fullDiff(before: string, after: string): TextDiff {
  const a = tokens(before),
    b = tokens(after)
  if (a.length + b.length > 100000)
    throw new Error('This diff exceeds the line budget. Open each side separately.')
  const ids = new Map<string, string>()
  const encode = (lines: string[]) =>
    lines
      .map((line) => {
        let id = ids.get(line)
        if (!id) {
          // One UTF-16 unit per line keeps the diff's offsets identical to line indexes.
          if (ids.size >= 60000)
            throw new Error('Too many distinct lines to compare safely. Open each side separately.')
          const code = ids.size + 1
          id = String.fromCharCode(code >= 0xd800 ? code + 0x800 : code)
          ids.set(line, id)
        }
        return id
      })
      .join('')
  const changes = diff(encode(a), encode(b), { scanLimit: 10000, timeout: 2000 })
  const lines: DiffLine[] = []
  let ai = 0,
    bi = 0,
    additions = 0,
    deletions = 0
  const push = (token: string, type: 'ctx' | 'del' | 'add', old?: number, next?: number) => {
    lines.push({
      type,
      text: token.replace(/\n$/, ''),
      ...(old !== undefined ? { old } : {}),
      ...(next !== undefined ? { new: next } : {}),
    })
    if (type !== 'ctx' && !token.endsWith('\n'))
      lines.push({
        type: 'note',
        text: `\\ No newline at end of ${type === 'del' ? 'base' : 'target'} file`,
      })
  }
  for (const change of changes) {
    while (ai < change.fromA && bi < change.fromB) {
      push(a[ai], 'ctx', ++ai, ++bi)
    }
    while (ai < change.toA) {
      push(a[ai], 'del', ++ai)
      deletions++
    }
    while (bi < change.toB) {
      push(b[bi], 'add', undefined, ++bi)
      additions++
    }
  }
  while (ai < a.length && bi < b.length) {
    push(a[ai], 'ctx', ++ai, ++bi)
  }
  return { lines, additions, deletions }
}
