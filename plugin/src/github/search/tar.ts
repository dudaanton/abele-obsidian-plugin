/**
 * Reading the archive GitHub sends for a ref: a gzipped tar, unpacked in memory.
 *
 * Only what GitHub's archives use is understood — ustar headers with their `prefix`, pax
 * extended headers (GitHub puts a global one first, with the commit in it, and a per-file one
 * for any path over a hundred bytes) and GNU long names for good measure. Directories, links and
 * everything else that is not a regular file are passed over.
 */
import { gunzipSync } from 'fflate'

export interface TarEntry {
  path: string
  /** A view into the archive's own bytes, not a copy. */
  data: Uint8Array
}

const BLOCK = 512
const decoder = new TextDecoder()

const text = (bytes: Uint8Array, from: number, length: number): string => {
  const slice = bytes.subarray(from, from + length)
  const end = slice.indexOf(0)
  return decoder.decode(end === -1 ? slice : slice.subarray(0, end))
}

/** A header's number: octal digits, or GNU's base-256 for a size past 8 GB. */
const number = (bytes: Uint8Array, from: number, length: number): number => {
  if (bytes[from] & 0x80) {
    let n = 0
    for (let i = from + 1; i < from + length; i++) n = n * 256 + bytes[i]
    return n
  }
  const raw = text(bytes, from, length).trim()
  return raw ? parseInt(raw, 8) || 0 : 0
}

/** A pax header's `length key=value\n` records. */
function paxRecords(data: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {}
  let i = 0
  while (i < data.length) {
    const space = data.indexOf(0x20, i)
    if (space === -1) break
    const length = parseInt(decoder.decode(data.subarray(i, space)), 10)
    if (!length || length < 0) break
    const record = decoder.decode(data.subarray(space + 1, i + length - 1))
    const eq = record.indexOf('=')
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1)
    i += length
  }
  return out
}

const isZeroBlock = (bytes: Uint8Array, at: number) => {
  for (let i = at; i < at + BLOCK; i++) if (bytes[i] !== 0) return false
  return true
}

/** Every regular file in a tar, in the order the archive holds them. */
export function* readTar(bytes: Uint8Array): Generator<TarEntry> {
  let at = 0
  let longName: string | null = null
  let pax: Record<string, string> = {}

  while (at + BLOCK <= bytes.length) {
    if (isZeroBlock(bytes, at)) break
    const name = text(bytes, at, 100)
    const size = number(bytes, at + 124, 12)
    const type = String.fromCharCode(bytes[at + 156] || 0x30)
    const magic = text(bytes, at + 257, 6)
    const prefix = magic.startsWith('ustar') ? text(bytes, at + 345, 155) : ''
    const dataStart = at + BLOCK
    const data = bytes.subarray(dataStart, Math.min(bytes.length, dataStart + size))
    at = dataStart + Math.ceil(size / BLOCK) * BLOCK

    if (type === 'x') {
      pax = paxRecords(data)
      continue
    }
    if (type === 'L') {
      longName = text(data, 0, data.length)
      continue
    }
    // A global header — GitHub's names the commit — says nothing about any one file.
    if (type === 'g') continue

    const path = pax.path ?? longName ?? (prefix ? `${prefix}/${name}` : name)
    longName = null
    pax = {}
    if (type !== '0' && type !== '7') continue
    yield { path, data }
  }
}

/**
 * Gunzips in the platform's own decompressor where there is one — Obsidian's Electron and the
 * phone's WebView both have `DecompressionStream` — and with fflate where there is not.
 */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'function' && typeof Response === 'function') {
    try {
      const stream = new Blob([bytes as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream('gzip'))
      return new Uint8Array(await new Response(stream).arrayBuffer())
    } catch (e) {
      console.debug('[Abele] DecompressionStream failed, falling back to fflate', e)
    }
  }
  return gunzipSync(bytes)
}

/** GitHub's archives put everything under one `owner-repo-sha/` folder; this takes it off. */
export const stripRoot = (path: string): string => {
  const slash = path.indexOf('/')
  return slash === -1 ? path : path.slice(slash + 1)
}
