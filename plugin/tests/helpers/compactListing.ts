/**
 * Reads a compact listing back into what it was made from — what the "nothing is lost" tests
 * compare against the tool's own data. Written independently of the code that makes the
 * listing, from the format alone, so a listing that drops or garbles something cannot pass
 * by being read back the same wrong way.
 */

export interface ListedRow {
  /** The full path: the folder header joined with the name on the row. */
  path: string
  /** The rest of the row after the name, split on ` | `. */
  fields: string[]
  /** The row's leading marker, `[ ]` or `[x]`, when it has one. */
  marker?: string
}

const HEADER = /^(.*)\/ \((\d+)\)$/

export function readGrouped(text: string): ListedRow[] {
  const rows: ListedRow[] = []
  let folder: string | null = null
  let expected = 0
  let seen = 0
  const close = () => {
    if (folder !== null && seen !== expected) {
      throw new Error(`folder ${folder || '/'} says ${expected} and lists ${seen}`)
    }
  }
  for (const line of text.split('\n')) {
    const header = HEADER.exec(line)
    if (header && !line.startsWith(' ')) {
      close()
      folder = header[1]
      expected = Number(header[2])
      seen = 0
      continue
    }
    if (folder === null || !line.startsWith('  ')) continue
    seen++
    let row = line.slice(2)
    let marker: string | undefined
    const m = /^(\[[ x]\]) /.exec(row)
    if (m) {
      marker = m[1]
      row = row.slice(m[0].length)
    }
    const [name, ...fields] = row.split(' | ')
    rows.push({ path: folder ? `${folder}/${name}` : name, fields, marker })
  }
  close()
  return rows
}

/** `key: value; key: value` back into an object: bare strings, JSON for everything else. */
export function readProperties(line: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let rest = line
  while (rest) {
    const colon = rest.indexOf(': ')
    const key = rest.slice(0, colon)
    rest = rest.slice(colon + 2)
    let value: unknown
    let raw = ''
    // JSON when a prefix parses as JSON and is followed by the separator or the end — a bare
    // string never does, since anything that would is written as JSON instead.
    for (let end = rest.length; end > 0; end--) {
      if (end !== rest.length && !rest.startsWith('; ', end)) continue
      try {
        value = JSON.parse(rest.slice(0, end))
        raw = rest.slice(0, end)
        break
      } catch {
        continue
      }
    }
    if (!raw) {
      const end = rest.indexOf('; ')
      raw = end === -1 ? rest : rest.slice(0, end)
      value = raw
    }
    out[key] = value
    rest = rest.slice(raw.length)
    if (rest.startsWith('; ')) rest = rest.slice(2)
  }
  return out
}
