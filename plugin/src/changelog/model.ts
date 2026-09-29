export interface Release {
  version: string
  date: string
  dateSource?: 'tag' | 'history'
  features: string[]
  fixes: string[]
  improvements: string[]
}
export interface Range {
  from: string
  to: string
}

function parse(version: string): { core: number[]; pre: string[] } | null {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      version
    )
  if (!match) return null
  const core = match.slice(1, 4).map(Number)
  if (core.some((n) => !Number.isSafeInteger(n))) return null
  const pre = match[4]?.split('.') ?? []
  if (
    pre.some(
      (part) =>
        /^\d+$/.test(part) &&
        ((part.length > 1 && part[0] === '0') || !Number.isSafeInteger(Number(part)))
    )
  )
    return null
  return { core, pre }
}

/** Null means either version is invalid; numeric identifiers never use locale ordering. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const left = parse(a),
    right = parse(b)
  if (!left || !right) return null
  for (let i = 0; i < 3; i++)
    if (left.core[i] !== right.core[i]) return left.core[i] < right.core[i] ? -1 : 1
  if (!left.pre.length || !right.pre.length)
    return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i],
      y = right.pre[i]
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    if (x === y) continue
    const xn = /^\d+$/.test(x),
      yn = /^\d+$/.test(y)
    if (xn !== yn) return xn ? -1 : 1
    if (xn) return Number(x) < Number(y) ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}

export function normalizeRange(value: unknown, current: string): Range | null {
  if (!value || typeof value !== 'object') return null
  const { from, to } = value as Partial<Range>
  if (
    typeof from !== 'string' ||
    typeof to !== 'string' ||
    compareVersions(from, current) === null ||
    compareVersions(to, current) === null
  )
    return null
  const upper = compareVersions(to, current)! > 0 ? current : to
  return compareVersions(from, upper)! < 0 ? { from, to: upper } : null
}

export function selectReleases<T extends { version: string }>(
  releases: T[],
  range: Range | null
): T[] {
  if (!range) return releases
  return releases.filter(({ version }) => {
    const lower = compareVersions(version, range.from),
      upper = compareVersions(version, range.to)
    return lower !== null && upper !== null && lower > 0 && upper <= 0
  })
}
