/** The note write shown for approval. All preview fields are text, never rendered markdown. */
export interface ProtocolWrite {
  path: string
  mode: 'append' | 'replace'
  current: string | null
  content: string
  creates: boolean
}

/** Ordinary relative notes only. Validate before normalising so traversal never disappears. */
export function protocolNotePath(raw: string, protectedFolders: string[]): string | null {
  const path = raw.trim()
  if (
    !path ||
    /[\\:]/.test(path) ||
    Array.from(path).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    return null
  const segments = path.split('/')
  if (segments.some((s) => !s || s.startsWith('.'))) return null
  const name = segments[segments.length - 1]
  if (name.includes('.') && !/\.md$/i.test(name)) return null
  const note = /\.md$/i.test(path) ? path : `${path}.md`
  const lower = note.toLowerCase()
  if (
    protectedFolders.some((folder) => {
      const dir = folder
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '')
        .toLowerCase()
      return dir && (lower === dir || lower.startsWith(`${dir}/`))
    })
  )
    return null
  return note
}
