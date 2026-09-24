/**
 * Reads a zip archive held in memory, one entry at a time, for the book engine.
 *
 * The file is read from the vault once, whole; each entry is inflated only when the engine asks
 * for it, and dropped again by whoever asked. `unzipSync` with a filter walks the central
 * directory and inflates only the entries the filter keeps, so opening a 200 MB picture book
 * costs its compressed size plus the one picture on screen, not everything unpacked at once.
 */
import { unzipSync } from 'fflate'

/** An entry larger than this unpacked is refused: no book needs it, and a zip bomb does. */
export const MAX_ENTRY_BYTES = 256 * 1024 * 1024

export interface ZipEntry {
  filename: string
  /** Unpacked size in bytes, as the archive states it. */
  size: number
}

export interface ZipLoader {
  entries: ZipEntry[]
  loadText: (name: string) => string | null
  loadBlob: (name: string, type?: string) => Blob | null
  loadBytes: (name: string) => Uint8Array | null
  getSize: (name: string) => number
}

export class ArchiveError extends Error {}

export function openZip(data: Uint8Array): ZipLoader {
  const entries: ZipEntry[] = []
  try {
    unzipSync(data, {
      filter: (file) => {
        entries.push({ filename: file.name, size: file.originalSize })
        return false
      },
    })
  } catch (e) {
    throw new ArchiveError(`Not a readable archive: ${(e as Error).message}`)
  }
  const sizes = new Map(entries.map((e) => [e.filename, e.size]))

  const loadBytes = (name: string): Uint8Array | null => {
    const size = sizes.get(name)
    if (size === undefined) return null
    if (size > MAX_ENTRY_BYTES) throw new ArchiveError(`${name} is too large to open`)
    const out = unzipSync(data, { filter: (file) => file.name === name })
    const bytes = out[name] ?? null
    if (bytes && bytes.length > MAX_ENTRY_BYTES)
      throw new ArchiveError(`${name} is too large to open`)
    return bytes
  }

  const decoder = new TextDecoder()
  return {
    entries,
    loadBytes,
    loadText: (name) => {
      const bytes = loadBytes(name)
      return bytes ? decoder.decode(bytes) : null
    },
    loadBlob: (name, type) => {
      const bytes = loadBytes(name)
      return bytes ? new Blob([bytes as BlobPart], type ? { type } : undefined) : null
    },
    getSize: (name) => sizes.get(name) ?? 0,
  }
}

/** Whether bytes start like a zip archive. */
export function isZip(data: Uint8Array): boolean {
  return (
    data.length > 3 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04
  )
}
