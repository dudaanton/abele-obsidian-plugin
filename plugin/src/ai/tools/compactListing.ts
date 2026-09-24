/**
 * Listings as an agent reads them cheaply, and without losing anything.
 *
 * A flat list of full paths spends most of its tokens saying the same folder over and over:
 * `Finance/Transactions/2026/03/` two hundred times. Grouped under the folder, each path is its
 * folder header plus its own name, so every path can still be put back together exactly — the
 * tests do just that — at a fraction of the cost. The same holds for properties every row
 * shares, which are said once above the rows instead of in each.
 *
 * Only for what an agent is sent. A script parses a tool's answer line by line, so the tools a
 * script calls keep answering in full paths; `compact` is what switches a tool over.
 */

/** The folder a path is in, without a trailing slash; empty for the vault root. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** The header a folder's group starts with: `Folder/Sub/ (12)`, or `/ (3)` for the root. */
export function folderHeader(folder: string, count: number): string {
  return `${folder ? folder + '/' : '/'} (${count})`
}

/**
 * Items grouped under the folder of their path, each group in the order its first item came,
 * and the items inside it in their own order. `row` renders one item, given its name alone.
 */
export function groupByFolder<T>(
  items: readonly T[],
  pathOf: (item: T) => string,
  row: (item: T, name: string) => string
): string {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const folder = folderOf(pathOf(item))
    const group = groups.get(folder)
    if (group) group.push(item)
    else groups.set(folder, [item])
  }
  const out: string[] = []
  for (const [folder, group] of groups) {
    out.push(folderHeader(folder, group.length))
    for (const item of group) out.push(`  ${row(item, nameOf(pathOf(item)))}`)
  }
  return out.join('\n')
}

/** Paths as a tree one folder deep: each folder once, its files under it. */
export function pathTree(paths: readonly string[]): string {
  return groupByFolder(
    paths,
    (p) => p,
    (_p, name) => name
  )
}

/** A string that reads back as itself when written bare; anything else is quoted as JSON. */
function bare(value: string): boolean {
  return (
    value !== '' &&
    value.trim() === value &&
    !/[;\n\r"|]/.test(value) &&
    !/^[[{]/.test(value) &&
    !/^(true|false|null|-?\d+(\.\d+)?)$/.test(value)
  )
}

/** One property value on one line: a plain string bare, everything else as JSON. */
export function inlineValue(value: unknown): string {
  if (typeof value === 'string') return bare(value) ? value : JSON.stringify(value)
  if (value === undefined) return 'null'
  return JSON.stringify(value)
}

/** Properties on one line, `key: value; key: value`, leaving out the keys in `skip`. */
export function propertiesLine(props: Record<string, unknown>, skip: ReadonlySet<string>): string {
  return Object.entries(props)
    .filter(([key]) => !skip.has(key))
    .map(([key, value]) => `${key}: ${inlineValue(value)}`)
    .join('; ')
}

/**
 * The properties every one of these has with the same value — said once for all of them.
 * Only when there are at least two: for one file there is nothing to share.
 */
export function sharedProperties(all: readonly Record<string, unknown>[]): Record<string, unknown> {
  if (all.length < 2) return {}
  const shared: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(all[0])) {
    const text = JSON.stringify(value)
    if (
      all.every(
        (p) => Object.prototype.hasOwnProperty.call(p, key) && JSON.stringify(p[key]) === text
      )
    ) {
      shared[key] = value
    }
  }
  return shared
}
