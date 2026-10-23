import { createInterface } from 'node:readline'

// Payload reads can produce receipts larger than the runtime's single-string limit.
// Keep the raw file intact, but retain read operations in memory only for restart.
export async function rendererEntries(stream, restartAt, live = false) {
  const rows = []
  let terminated = false
  const tail = (chunk) => {
    if (chunk.length) terminated = chunk.at(-1) === 10 || chunk.at(-1) === '\n'
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
