/** The provisional callout record; no renderer or host API belongs here. */
export interface ColumnsOptions {
  ratio: number[] | null
  mobile: 'stack' | 'keep'
}

export function parseColumnsHeader(line: string): ColumnsOptions | null {
  const match = /^\s*(?:>\s*)*\[!abele-columns(?:\|([^\]]*))?\](?:\s.*)?$/.exec(line)
  if (!match) return null
  let ratio: number[] | null = null
  let mobile: 'stack' | 'keep' = 'stack'
  const seen = new Set<string>()
  for (const token of (match[1] ?? '').trim().split(/\s+/).filter(Boolean)) {
    const [key, value, extra] = token.split('=')
    if (extra !== undefined || seen.has(key)) return null
    seen.add(key)
    if (key === 'mobile' && (value === 'stack' || value === 'keep')) {
      mobile = value
      continue
    }
    if (key !== 'ratio' || !value) return null
    const parts = value.split(':')
    if (parts.length < 2 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return null
    ratio = parts.map(Number)
    if (ratio.some((n) => !Number.isFinite(n) || n <= 0)) return null
  }
  return { ratio, mobile }
}

export function columnWeights(ratio: number[] | null, count: number): number[] | null {
  if (count < 2 || (ratio && ratio.length !== count)) return null
  return ratio ?? Array<number>(count).fill(1)
}
