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

export function validateZipEntries<S>(
  entries: readonly ZipEntry<S>[],
  limits: ZipLimits = ZIP_LIMITS
): ZipEntry<S>[] {
  if (!entries.length || entries.length > limits.entries)
    throw new Error('ZIP entry count limit exceeded')
  const names = new Set<string>()
  let input = 0
  let metadata = 22
  const result = entries.map((entry) => {
    const name = canonicalEntryName(entry.name)
    if (names.has(name)) throw new Error('Duplicate ZIP entry name')
    names.add(name)
    if (!Number.isSafeInteger(entry.size) || entry.size < 0)
      throw new Error('Invalid ZIP source size')
    input += entry.size
    // Local header + streaming descriptor + central header, with UTF-8 name in both headers.
    metadata += 92 + 2 * new TextEncoder().encode(name).length
    return { ...entry, name }
  })
  for (const name of names) {
    const parts = name.split('/')
    parts.pop()
    while (parts.length) {
      if (names.has(parts.join('/'))) throw new Error('ZIP file/directory prefix conflict')
      parts.pop()
    }
  }
  if (input > limits.inputBytes) throw new Error('ZIP input byte limit exceeded')
  if (metadata > limits.outputBytes) throw new Error('ZIP output metadata limit exceeded')
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
