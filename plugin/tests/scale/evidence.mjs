import { createInterface } from 'node:readline'
import { createReadStream, createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

// Profiles rotate every ten seconds. Bounded individual JSON inputs fail explicitly,
// rather than exhausting the runtime while reading a damaged or unrotated receipt.
export async function readEvidenceJson(path, limit = 64 * 1024 ** 2) {
  const chunks = []
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length
    if (bytes > limit) throw new Error('Evidence JSON exceeds bounded input limit')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export function* jsonPieces(value, ancestors = new Set()) {
  if (value === null || typeof value !== 'object') {
    yield JSON.stringify(value) ?? 'null'
    return
  }
  if (ancestors.has(value)) throw new Error('Cyclic evidence value')
  ancestors.add(value)
  const array = Array.isArray(value)
  yield array ? '[' : '{'
  let first = true
  for (const [key, child] of array ? value.entries() : Object.entries(value)) {
    if (!array && ['undefined', 'function', 'symbol'].includes(typeof child)) continue
    if (!first) yield ','
    first = false
    if (!array) yield JSON.stringify(key) + ':'
    yield* jsonPieces(child, ancestors)
  }
  yield array ? ']' : '}'
  ancestors.delete(value)
}

export async function writeEvidenceJson(path, value) {
  return writeEvidenceChunks(path, jsonPieces(value))
}

export async function writeEvidenceChunks(path, pieces) {
  function* buffers() {
    let pending = ''
    for (const piece of pieces) {
      pending += piece
      if (pending.length >= 65536) {
        yield pending
        pending = ''
      }
    }
    if (pending) yield pending
  }
  try {
    await pipeline(Readable.from(buffers()), createWriteStream(path + '.next'))
    await rename(path + '.next', path)
  } catch (error) {
    await rm(path + '.next', { force: true })
    throw error
  }
}

// Payload reads can produce receipts larger than the runtime's single-string limit.
// Keep the raw file intact, but retain read operations in memory only for restart.
export async function rendererEntries(stream, restartAt, live = false, lineLimit = 4 * 1024 ** 2) {
  const rows = []
  let terminated = false
  let lineBytes = 0
  const tail = (chunk) => {
    if (chunk.length) terminated = chunk.at(-1) === 10 || chunk.at(-1) === '\n'
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    let offset = 0
    while (offset < bytes.length) {
      const newline = bytes.indexOf(10, offset)
      const end = newline < 0 ? bytes.length : newline
      lineBytes += end - offset
      if (lineBytes > lineLimit) {
        stream.destroy(new Error('Evidence line exceeds bounded receipt limit'))
        return
      }
      if (newline >= 0) lineBytes = 0
      offset = end + 1
    }
  }
  stream.on('data', tail)
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let incomplete
  try {
    for await (const line of lines) {
      if (incomplete) throw incomplete
      let row
      try {
        row = JSON.parse(line)
      } catch (error) {
        // A live append can end with an incomplete receipt; the next scan sees it.
        incomplete = error
        continue
      }
      if (
        ['content-read-start', 'content-read-finish', 'content-read-ready'].includes(row.event) &&
        !(Number.isFinite(restartAt) && row.at >= restartAt)
      )
        continue
      rows.push(row)
    }
  } finally {
    stream.off('data', tail)
    lines.close()
  }
  if (incomplete && (!live || terminated)) throw incomplete
  return rows
}
