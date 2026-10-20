import { Inflate, strFromU8 } from 'fflate'
import { MAX_CHUNK_BYTES, type ChunkSource } from '@abele/sync-sdk/core'
import { ArchiveError, MAX_ENTRY_BYTES, type ZipEntry } from './zipLoader'

interface Entry extends ZipEntry {
  offset: number
  compressed: number
  method: number
  crc: number
}
export interface RangedZip {
  entries: ZipEntry[]
  loadBytes: (name: string) => Promise<Uint8Array | null>
  loadText: (name: string) => Promise<string | null>
  loadBlob: (name: string, type?: string) => Promise<Blob | null>
  getSize: (name: string) => number
}
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const fail = (): never => {
  throw new ArchiveError('Not a readable archive')
}
const integer64 = (data: DataView, offset: number) => {
  const value = Number(data.getBigUint64(offset, true))
  if (!Number.isSafeInteger(value)) fail()
  return value
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  return value >>> 0
})

/** Central-directory metadata and individual resources; never retains the compressed book. */
export async function openRangedZip(source: ChunkSource): Promise<RangedZip> {
  const read = async (at: number, length: number) => {
    if (at < 0 || length < 0 || at + length > source.size || length > MAX_CHUNK_BYTES) fail()
    const bytes = await source.read(at, length)
    if (bytes.length !== length || bytes.buffer.byteLength > MAX_CHUNK_BYTES) fail()
    return bytes
  }
  const tail = await read(Math.max(0, source.size - 65557), Math.min(source.size, 65557))
  const end = view(tail)
  let eocd = tail.length - 22
  while (
    eocd >= 0 &&
    !(
      end.getUint32(eocd, true) === 0x06054b50 &&
      eocd + 22 + end.getUint16(eocd + 20, true) === tail.length
    )
  )
    eocd--
  if (eocd < 0 || end.getUint16(eocd + 4, true) || end.getUint16(eocd + 6, true)) fail()
  let count = end.getUint16(eocd + 10, true),
    directorySize = end.getUint32(eocd + 12, true)
  let at = end.getUint32(eocd + 16, true)
  const endOffset = source.size - tail.length + eocd
  if (count === 65535 || at === 0xffffffff || directorySize === 0xffffffff) {
    const locator = view(await read(endOffset - 20, 20))
    if (
      locator.getUint32(0, true) !== 0x07064b50 ||
      locator.getUint32(4, true) ||
      locator.getUint32(16, true) !== 1
    )
      fail()
    const record = view(await read(integer64(locator, 8), 56))
    if (
      record.getUint32(0, true) !== 0x06064b50 ||
      record.getUint32(16, true) ||
      record.getUint32(20, true)
    )
      fail()
    count = integer64(record, 32)
    directorySize = integer64(record, 40)
    at = integer64(record, 48)
  }
  const directoryEnd = at + directorySize
  if (directoryEnd > endOffset || count > directorySize / 46) fail()
  const entries = new Map<string, Entry>(),
    decoder = new TextDecoder()
  for (let i = 0; i < count; i++) {
    const header = view(await read(at, 46))
    if (header.getUint32(0, true) !== 0x02014b50 || header.getUint16(8, true) & 1) fail()
    const nameLength = header.getUint16(28, true),
      extra = header.getUint16(30, true),
      comment = header.getUint16(32, true)
    const entry: Entry = {
      filename: strFromU8(await read(at + 46, nameLength), !(header.getUint16(8, true) & 2048)),
      size: header.getUint32(24, true),
      compressed: header.getUint32(20, true),
      offset: header.getUint32(42, true),
      method: header.getUint16(10, true),
      crc: header.getUint32(16, true),
    }
    if (
      entry.offset === 0xffffffff ||
      entry.size === 0xffffffff ||
      entry.compressed === 0xffffffff
    ) {
      const fields = view(await read(at + 46 + nameLength, extra))
      let offset = 0,
        found = false
      while (offset + 4 <= fields.byteLength) {
        const id = fields.getUint16(offset, true),
          length = fields.getUint16(offset + 2, true)
        offset += 4
        if (offset + length > fields.byteLength) fail()
        if (id === 1) {
          const limit = offset + length
          for (const key of ['size', 'compressed', 'offset'] as const) {
            if (entry[key] !== 0xffffffff) continue
            if (offset + 8 > limit) fail()
            entry[key] = integer64(fields, offset)
            offset += 8
          }
          found = true
          break
        }
        offset += length
      }
      if (!found) fail()
    }
    if (entries.has(entry.filename)) fail()
    entries.set(entry.filename, entry)
    at += 46 + nameLength + extra + comment
    if (at > directoryEnd) fail()
  }
  const loadBytes = async (name: string): Promise<Uint8Array | null> => {
    const entry = entries.get(name)
    if (!entry) return null
    if (entry.size > MAX_ENTRY_BYTES) throw new ArchiveError(`${name} is too large to open`)
    const local = view(await read(entry.offset, 30))
    if (local.getUint32(0, true) !== 0x04034b50 || local.getUint16(8, true) !== entry.method) fail()
    const start = entry.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true)
    const result = new Uint8Array(entry.size)
    let written = 0,
      crc = 0xffffffff
    const append = (bytes: Uint8Array) => {
      if (written + bytes.length > result.length) fail()
      result.set(bytes, written)
      written += bytes.length
      for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
    }
    const inflate = entry.method === 8 ? new Inflate(append) : null
    if (!inflate && entry.method !== 0) fail()
    for (let offset = 0; offset < entry.compressed; offset += MAX_CHUNK_BYTES) {
      const bytes = await read(start + offset, Math.min(MAX_CHUNK_BYTES, entry.compressed - offset))
      if (inflate) inflate.push(bytes, offset + bytes.length === entry.compressed)
      else append(bytes)
    }
    if (written !== entry.size || (crc ^ 0xffffffff) >>> 0 !== entry.crc) fail()
    await source.assertUnchanged()
    return result
  }
  await source.assertUnchanged()
  return {
    entries: [...entries.values()].map(({ filename, size }) => ({ filename, size })),
    getSize: (name) => entries.get(name)?.size ?? 0,
    loadBytes,
    loadText: async (name) => {
      const bytes = await loadBytes(name)
      return bytes ? decoder.decode(bytes) : null
    },
    loadBlob: async (name, type) => {
      const bytes = await loadBytes(name)
      return bytes ? new Blob([bytes as BlobPart], { type }) : null
    },
  }
}
