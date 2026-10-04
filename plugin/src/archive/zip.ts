import { Zip, ZipDeflate } from 'fflate'

/** Roundtrip ceilings, not an attestation that maximum allocations are safe on every device. */
export const ZIP_LIMITS = Object.freeze({
  entries: 5000,
  inputBytes: 512 * 1024 * 1024,
  outputBytes: 64 * 1024 * 1024,
})
export interface ZipLimits {
  entries: number
  inputBytes: number
  outputBytes: number
}
export interface ZipEntry<S> {
  name: string
  source: S
  size: number
}
export interface ZipPorts<S, R> {
  read(source: S): Promise<Uint8Array>
  /** Synchronous current authorization/identity/cancellation validation, never a cached grant. */
  checkpoint(): void
  /** A genuine macrotask opportunity, supplied by the host (not a resolved Promise). */
  yieldTask: () => Promise<void>
  publish(bytes: Uint8Array): Promise<R>
  limits?: ZipLimits
}

/** Reject ambiguous paths rather than silently reducing or overwriting the selection. */
export function canonicalEntryName(name: string): string {
  if (
    typeof name !== 'string' ||
    !name ||
    /\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(name)
  )
    throw new Error('Invalid ZIP entry name')
  const result = name.replace(/\\/g, '/').normalize('NFC')
  if (
    result.startsWith('/') ||
    /^[a-z]:/i.test(result) ||
    result.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new Error('ZIP entry must be a relative file path without traversal')
  if (new TextEncoder().encode(result).length > 65535)
    throw new Error('ZIP filename byte limit exceeded')
  return result
}

interface NameEdge {
  /** Range of an existing canonical name: splitting an edge never copies a long suffix. */
  text: string
  start: number
  end: number
  file: boolean
  next: Map<number, NameEdge>
}
const SLASH = '/'.charCodeAt(0)

/** Compressed trie: linear character visits, at most two edges per entry, no depth recursion. */
class EntryNames {
  private readonly root = new Map<number, NameEdge>()

  private leaf(text: string, start: number): NameEdge {
    return { text, start, end: text.length, file: true, next: new Map() }
  }

  add(name: string): void {
    let next = this.root
    let offset = 0
    while (offset < name.length) {
      const key = name.charCodeAt(offset)
      const edge = next.get(key)
      if (!edge) {
        next.set(key, this.leaf(name, offset))
        return
      }
      const length = edge.end - edge.start
      let matched = 0
      while (
        matched < length &&
        offset + matched < name.length &&
        edge.text.charCodeAt(edge.start + matched) === name.charCodeAt(offset + matched)
      )
        matched++
      offset += matched
      if (matched < length) {
        const terminal = offset === name.length
        if (terminal && edge.text.charCodeAt(edge.start + matched) === SLASH)
          throw new Error('ZIP file/directory prefix conflict')
        const suffix: NameEdge = { ...edge, start: edge.start + matched }
        edge.end = suffix.start
        edge.file = terminal
        edge.next = new Map([[suffix.text.charCodeAt(suffix.start), suffix]])
        if (!terminal) edge.next.set(name.charCodeAt(offset), this.leaf(name, offset))
        return
      }
      if (offset === name.length) {
        if (edge.file) throw new Error('Duplicate ZIP entry name')
        if (edge.next.has(SLASH)) throw new Error('ZIP file/directory prefix conflict')
        edge.file = true
        return
      }
      // A and AB can coexist; only a slash after a file creates a directory-prefix conflict.
      if (edge.file && name.charCodeAt(offset) === SLASH)
        throw new Error('ZIP file/directory prefix conflict')
      next = edge.next
    }
  }
}

export function validateZipEntries<S>(
  entries: readonly ZipEntry<S>[],
  limits: ZipLimits = ZIP_LIMITS
): ZipEntry<S>[] {
  if (!entries.length || entries.length > limits.entries)
    throw new Error('ZIP entry count limit exceeded')
  const names = new EntryNames()
  let input = 0
  let metadata = 22
  if (metadata > limits.outputBytes) throw new Error('ZIP output metadata limit exceeded')
  const result: ZipEntry<S>[] = []
  for (const entry of entries) {
    const name = canonicalEntryName(entry.name)
    if (!Number.isSafeInteger(entry.size) || entry.size < 0)
      throw new Error('Invalid ZIP source size')
    input += entry.size
    if (input > limits.inputBytes) throw new Error('ZIP input byte limit exceeded')
    // Local header + streaming descriptor + central header, with UTF-8 name in both headers.
    metadata += 92 + 2 * new TextEncoder().encode(name).length
    if (metadata > limits.outputBytes) throw new Error('ZIP output metadata limit exceeded')
    names.add(name)
    result.push({ ...entry, name })
  }
  return result
}

const CHUNK_BYTES = 64 * 1024

/** Sequential streaming compression: one materialized source, bounded output, one final assembly. */
export async function buildZip<S, R>(
  selection: readonly ZipEntry<S>[],
  ports: ZipPorts<S, R>
): Promise<R> {
  const limits = ports.limits ?? ZIP_LIMITS
  ports.checkpoint()
  const entries = validateZipEntries(selection, limits)
  const yieldTask = ports.yieldTask
  let centralBytes = 22
  for (const entry of entries) centralBytes += 46 + new TextEncoder().encode(entry.name).length
  let outputBytes = 0
  let inputBytes = 0
  let ended = false
  let failure: Error | undefined
  const chunks: Uint8Array[] = []
  const zip = new Zip((error, chunk, final) => {
    if (failure) return
    if (error) {
      failure = error
      return
    }
    outputBytes += chunk.length
    if (outputBytes + (final ? 0 : centralBytes) > limits.outputBytes) {
      failure = new Error('ZIP output byte limit exceeded')
      return
    }
    chunks.push(chunk)
    ended = final
  })
  const check = () => {
    if (failure) throw failure
    ports.checkpoint()
  }
  try {
    for (const entry of entries) {
      check()
      // This block deliberately does not retain source bytes in ZIP's central-directory state.
      {
        const data = await ports.read(entry.source)
        check()
        inputBytes += data.byteLength
        if (inputBytes > limits.inputBytes) throw new Error('ZIP input byte limit exceeded')
        const stream = new ZipDeflate(entry.name, { level: 6 })
        zip.add(stream)
        check()
        if (!data.length) stream.push(data, true)
        for (let offset = 0; offset < data.length; offset += CHUNK_BYTES) {
          check()
          stream.push(
            data.subarray(offset, offset + CHUNK_BYTES),
            offset + CHUNK_BYTES >= data.length
          )
          check()
          await yieldTask()
          check()
        }
      }
      // Empty entries also give rendering and Stop a genuine event-loop opportunity.
      if (!entry.size) {
        await yieldTask()
        check()
      }
    }
    check()
    zip.end()
    check()
    if (!ended) throw new Error('ZIP construction did not complete')
    const output = new Uint8Array(outputBytes)
    let offset = 0
    for (const chunk of chunks) {
      output.set(chunk, offset)
      offset += chunk.length
    }
    chunks.length = 0
    check()
    return await ports.publish(output)
  } finally {
    zip.terminate()
    chunks.length = 0
  }
}
