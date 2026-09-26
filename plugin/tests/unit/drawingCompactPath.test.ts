/**
 * A stroke's outline written small (`drawing/compactPath.ts`): relative, to a tenth, and still
 * the same shape — every point where it was, give or take the tenth, however long the outline.
 */
import { describe, it, expect } from 'vitest'
import { compactPath } from '@/drawing/compactPath'
import { strokePath } from '@/reader/ink/stroke'

/** A relative path read back to absolute numbers, one list per command. */
function absolute(d: string): { cmd: string; args: number[] }[] {
  const tokens = d.match(/[a-z]|-?\d*\.?\d+/gi) ?? []
  const n: Record<string, number> = { m: 2, l: 2, q: 4, c: 6, a: 7, z: 0 }
  const out: { cmd: string; args: number[] }[] = []
  let x = 0
  let y = 0
  let i = 0
  while (i < tokens.length) {
    const c = tokens[i++]
    const lower = c.toLowerCase()
    const args = tokens.slice(i, i + n[lower]).map(Number)
    i += n[lower]
    const rel = c === lower
    const abs = args.map((v, k) => {
      if (lower === 'a' && k < 5) return v
      return rel ? v + (k % 2 === 0 ? x : y) : v
    })
    if (lower === 'a') {
      abs[5] = rel ? args[5] + x : args[5]
      abs[6] = rel ? args[6] + y : args[6]
    }
    if (n[lower]) {
      x = abs[abs.length - 2]
      y = abs[abs.length - 1]
    }
    out.push({ cmd: lower, args: abs })
  }
  return out
}

describe('a stroke outline written small', () => {
  it('keeps every point within a tenth, along a long outline', () => {
    const points: number[] = []
    for (let k = 0; k < 400; k++)
      points.push(1000 + k * 1.37, 500 + Math.sin(k / 7) * 30, 0.2 + (k % 10) / 20)
    const d = strokePath({ tool: 'pen', color: 'black', size: 2.4, points })
    const small = compactPath(d)
    const a = absolute(d.replace(/([MLQA])/g, ' $1 '))
    const b = absolute(small)
    expect(b.map((c) => c.cmd)).toEqual(a.map((c) => c.cmd.toLowerCase()))
    let worst = 0
    a.forEach((c, i) =>
      c.args.forEach((v, k) => (worst = Math.max(worst, Math.abs(v - b[i].args[k]))))
    )
    expect(worst).toBeLessThanOrEqual(0.051)
    expect(small.length).toBeLessThan(d.length * 0.6)
  })

  it('writes numbers without what they do not need', () => {
    expect(compactPath('M10.04 20L10.5 19.5L10 20Z')).toBe('M10 20l.5-.5l-.5.5z')
  })
})
