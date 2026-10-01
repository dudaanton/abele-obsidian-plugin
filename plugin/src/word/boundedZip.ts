/** Inflate Word packages with actual running budgets, never with header-sized output buffers. */
import { Unzip, UnzipInflate, type UnzipFile } from 'fflate'
import { ArchiveError, openZip, type ZipLoader } from '@/reader/zipLoader'

export interface WordZipLimits {
  compressed: number
  expanded: number
  xml: number
  entries: number
}
const INPUT_CHUNK = 1024
export async function openWordZip(
  data: Uint8Array,
  limits: WordZipLimits,
  yieldTask: () => Promise<void> = () => Promise.resolve()
): Promise<ZipLoader> {
  if (data.length > limits.compressed) throw new ArchiveError('Document is too large compressed')
  // Reuse the reader's directory scan, but never its unchecked lazy inflation.
  const declared = openZip(data).entries
  if (
    declared.length > limits.entries ||
    new Set(declared.map((e) => e.filename)).size !== declared.length
  )
    throw new ArchiveError('Too many or duplicate document parts')
  const metadata = new Map(declared.map((e) => [e.filename, e]))
  let declaredTotal = 0
  for (const entry of declared) {
    if (entry.filename.startsWith('/') || entry.filename.split('/').includes('..'))
      throw new ArchiveError('Invalid document part path')
    if (!Number.isSafeInteger(entry.size) || entry.size < 0)
      throw new ArchiveError('Invalid ZIP part size')
    declaredTotal += entry.size
    if (/\.(?:xml|rels)$/i.test(entry.filename) && entry.size > limits.xml)
      throw new ArchiveError('Document XML is too large')
  }
  if (declaredTotal > limits.expanded) throw new ArchiveError('Document is too large unpacked')
  const parts = new Map<string, Uint8Array>()
  const seen = new Set<string>()
  const active = new Set<UnzipFile>()
  let total = 0
  const unzip = new Unzip((file) => {
    const entry = metadata.get(file.name)
    if (!entry || seen.has(file.name)) throw new ArchiveError('Inconsistent or duplicate ZIP parts')
    seen.add(file.name)
    active.add(file)
    const chunks: Uint8Array[] = []
    const maximum = /\.(?:xml|rels)$/i.test(file.name) ? limits.xml : limits.expanded
    let length = 0
    file.ondata = (error, bytes, final) => {
      if (error) throw error
      // Check before retaining any output. Small input pushes also bound transient inflater output.
      if (length + bytes.length > maximum || total + bytes.length > limits.expanded)
        throw new ArchiveError(`${file.name} is too large unpacked`)
      if (length + bytes.length > entry.size)
        throw new ArchiveError(`ZIP size mismatch for ${file.name}`)
      length += bytes.length
      total += bytes.length
      if (bytes.length) chunks.push(bytes)
      if (final) {
        if (length !== entry.size) throw new ArchiveError(`ZIP size mismatch for ${file.name}`)
        const part = new Uint8Array(length)
        let at = 0
        for (const chunk of chunks) {
          part.set(chunk, at)
          at += chunk.length
        }
        chunks.length = 0
        parts.set(file.name, part)
        active.delete(file)
      }
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  try {
    for (let at = 0; at < data.length; at += INPUT_CHUNK) {
      unzip.push(data.subarray(at, at + INPUT_CHUNK), at + INPUT_CHUNK >= data.length)
      if ((at / INPUT_CHUNK + 1) % 16 === 0) await yieldTask()
    }
    if (active.size || parts.size !== declared.length)
      throw new ArchiveError('Incomplete document archive')
  } finally {
    for (const file of active) file.terminate()
  }
  const entries = declared.map((entry) => ({
    filename: entry.filename,
    size: parts.get(entry.filename)!.length,
  }))
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
  return {
    entries,
    loadBytes: (name) => parts.get(name) ?? null,
    getSize: (name) => parts.get(name)?.length ?? 0,
    loadText: (name) => {
      const bytes = parts.get(name)
      return bytes ? decoder.decode(bytes) : null
    },
    loadBlob: (name, type) => {
      const bytes = parts.get(name)
      return bytes ? new Blob([bytes as BlobPart], type ? { type } : undefined) : null
    },
  }
}
