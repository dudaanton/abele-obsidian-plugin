// A `.http` file of REST Client or the JetBrains client: requests apart by `###`, each the method
// and address, headers, a blank line and the body; `@name = value` lines are file variables.
import type { EnvVar } from '../wire'
import {
  SECRET_NAME,
  bodyFormat,
  credential,
  isMethod,
  leave,
  request,
  splitQuery,
  type Imported,
} from './shared'

export function importHttp(text: string): Imported {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const vars: EnvVar[] = []
  const leftOut: string[] = []
  const blocks: { title: string; lines: string[] }[] = [{ title: '', lines: [] }]
  for (const line of lines) {
    const fileVar = /^@([\w.-]+)\s*=\s*(.*)$/.exec(line.trim())
    if (fileVar && blocks.length === 1 && !blocks[0]!.lines.some((l) => l.trim())) {
      const [, key, value] = fileVar
      vars.push(
        SECRET_NAME.test(key!) ? { key: key!, secret: true } : { key: key!, value: value!.trim() }
      )
      continue
    }
    const sep = /^###(.*)$/.exec(line)
    if (sep) blocks.push({ title: sep[1]!.trim(), lines: [] })
    else blocks.at(-1)!.lines.push(line)
  }
  const requests = blocks.flatMap((b, i) => {
    let name = b.title
    let at = 0
    for (; at < b.lines.length; at++) {
      const l = b.lines[at]!.trim()
      if (!l) continue
      const meta = /^(?:#|\/\/)\s*@name\s+(.+)$/.exec(l)
      if (meta) name = meta[1]!.trim()
      else if (!/^(#|\/\/)/.test(l)) break
    }
    const line = b.lines[at]?.trim()
    if (!line) return []
    const words = line.split(/\s+/)
    const method = words[0]!.toUpperCase()
    const address = (isMethod(method) ? line.slice(words[0]!.length) : line)
      .trim()
      .replace(/\s+HTTP\/[\d.]+$/i, '')
    const { url, params } = splitQuery(address)
    const headers = []
    for (at++; at < b.lines.length; at++) {
      const h = b.lines[at]!
      if (!h.trim()) break
      if (/^\s*(#|\/\/)/.test(h)) continue
      const colon = h.indexOf(':')
      if (colon <= 0) continue
      const key = h.slice(0, colon).trim()
      const value = h.slice(colon + 1).trim()
      if (credential(key, value)) leave(leftOut, key)
      else headers.push({ key, value })
    }
    const body = b.lines
      .slice(at + 1)
      .filter((l) => !/^\s*(#|\/\/)/.test(l))
      .join('\n')
      .trim()
    return [
      {
        doc: request({
          name: name || `Request ${i}`,
          method: isMethod(method) ? method : 'GET',
          url,
          params,
          headers,
          ...(body ? { body: { format: bodyFormat(headers, body), text: body } } : {}),
        }),
      },
    ]
  })
  return { collection: 'Imported', requests, vars, leftOut }
}
