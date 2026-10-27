import type { PathTarget } from './NodePathModel'

const prefix = 'abele-node-code:'
export interface CodeDestination {
  path: string
  line?: number
  endLine?: number
  match?: { column: number; length: number }
}
const identity = (target: PathTarget) => [target.nodeId, target.projectId, target.kind, target.id]

/** Portable working-tree citation: no credentials, endpoint or local filesystem root. */
export function nodeCodeLink(
  target: PathTarget,
  path: string,
  range?: { start: number; end: number; match?: { column: number; length: number } }
): string {
  return (
    prefix +
    encodeURIComponent(
      JSON.stringify({
        scope: identity(target),
        path,
        ...(range
          ? {
              line: range.start,
              endLine: range.end,
              ...(range.match ? { match: range.match } : {}),
            }
          : {}),
      })
    )
  )
}

export function resolveNodeCodeLink(
  resource: string,
  target: PathTarget | undefined,
  root?: string
): CodeDestination | undefined {
  try {
    let destination: CodeDestination
    if (resource.startsWith(prefix)) {
      const parsed = JSON.parse(decodeURIComponent(resource.slice(prefix.length)))
      if (!target || JSON.stringify(parsed.scope) !== JSON.stringify(identity(target))) return
      destination = { path: parsed.path, line: parsed.line, endLine: parsed.endLine ?? parsed.line }
      if (parsed.match !== undefined) {
        if (
          !parsed.match ||
          !Number.isSafeInteger(parsed.match.column) ||
          parsed.match.column < 0 ||
          !Number.isSafeInteger(parsed.match.length) ||
          parsed.match.length < 1 ||
          !parsed.line
        )
          return
        destination.match = { column: parsed.match.column, length: parsed.match.length }
      }
    } else {
      let path = resource
      if (path.startsWith('file://')) {
        const url = new URL(path)
        if (url.hostname || url.search) return
        path = decodeURIComponent(url.pathname) + url.hash
      }
      const match = path.match(/^(.*?)(?::([0-9]+)(?:-([0-9]+))?|#L([0-9]+)(?:-L([0-9]+))?)$/)
      destination = match
        ? {
            path: match[1],
            line: Number(match[2] ?? match[4]),
            endLine: Number(match[3] ?? match[5] ?? match[2] ?? match[4]),
          }
        : { path }
      if (destination.path.startsWith('/')) {
        const base = root?.replace(/\/+$/, '')
        if (!base || !destination.path.startsWith(base + '/')) return
        destination.path = destination.path.slice(base.length + 1)
      }
    }
    if (
      typeof destination.path !== 'string' ||
      !destination.path ||
      destination.path.length > 4096 ||
      /[\\:#?]/.test(destination.path) ||
      Array.from(destination.path).some((char) => char.charCodeAt(0) < 32)
    )
      return
    const parts = destination.path.split('/').filter((part) => part !== '.')
    if (parts.some((part) => !part || part === '..')) return
    if (
      destination.line !== undefined &&
      (!Number.isSafeInteger(destination.line) ||
        destination.line < 1 ||
        !Number.isSafeInteger(destination.endLine) ||
        destination.endLine! < destination.line)
    )
      return
    return { ...destination, path: parts.join('/') }
  } catch {
    return
  }
}
