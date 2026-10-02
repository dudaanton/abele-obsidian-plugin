/** Archive validation is storage-independent; the script context supplies the vault writer. */
export const MAX_ZIP_BYTES = 64 * 1024 * 1024
export const MAX_UNZIP_BYTES = 512 * 1024 * 1024
export const MAX_UNZIP_ENTRIES = 5000

export interface ArchiveWriter {
  write(path: string, data: Uint8Array): Promise<void>
}

/** Canonicalise within the given root, rejecting absolute paths and traversal out of it. */
function relativePath(raw: string): string {
  const path = raw.normalize('NFC').replace(/\\/g, '/')
  if (path.includes('\0') || path.startsWith('/') || /^[a-z]:/i.test(path)) {
    throw new Error(`Archive path "${raw}" is not relative to its target folder`)
  }
  const result: string[] = []
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!result.length) throw new Error(`Archive path "${raw}" escapes its target folder`)
      result.pop()
    } else result.push(segment)
  }
  return result.join('/')
}

/** Validate and inflate the whole archive before admitting any writes. Hidden files stay valid. */
export async function extractArchive(
  bytes: Uint8Array,
  targetFolder: string,
  writer: ArchiveWriter,
  signal?: AbortSignal
): Promise<string[]> {
  signal?.throwIfAborted()
  if (bytes.byteLength > MAX_ZIP_BYTES) throw new Error('Archive size exceeds 64 MB')
  const folder = relativePath(targetFolder)
  const { unzipSync } = await import('fflate')
  let count = 0
  let allocationBytes = 0
  // The first pass reads only directory metadata. Returning false admits no STORE copies
  // or DEFLATE output buffers, even when many records point at the same compressed data.
  unzipSync(bytes, {
    filter: (entry) => {
      if (++count > MAX_UNZIP_ENTRIES)
        throw new Error(`Archive exceeds ${MAX_UNZIP_ENTRIES} entries`)
      // STORE copies `size`, not `originalSize`. DEFLATE uses a fixed originalSize output
      // buffer in fflate. Account for both the declared size and the actual allocation bound.
      const allocation = Math.max(entry.originalSize, entry.compression === 0 ? entry.size : 0)
      if (allocation > MAX_UNZIP_BYTES || allocationBytes + allocation > MAX_UNZIP_BYTES)
        throw new Error('Unpacked archive size exceeds 512 MB')
      allocationBytes += allocation
      const path = relativePath(entry.name)
      if (entry.name.endsWith('/') || entry.name.endsWith('\\')) return false
      if (!path) throw new Error('Archive entry has an empty file path')
      return false
    },
  })
  signal?.throwIfAborted()
  const entries = unzipSync(bytes, {
    filter: (entry) => !entry.name.endsWith('/') && !entry.name.endsWith('\\'),
  })
  let total = 0
  const planned = Object.entries(entries).map(([raw, data]) => {
    total += data.byteLength
    if (total > MAX_UNZIP_BYTES) throw new Error('Unpacked archive size exceeds 512 MB')
    const path = relativePath(raw)
    return { path: folder ? `${folder}/${path}` : path, data }
  })
  const created: string[] = []
  for (const entry of planned) {
    signal?.throwIfAborted()
    await writer.write(entry.path, entry.data)
    created.push(entry.path)
  }
  return created
}
