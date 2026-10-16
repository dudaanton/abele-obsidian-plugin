/**
 * A stroke's outline written small: every point after the first relative to the one before, to a
 * tenth of a unit. The shape is the same one the canvas fills (`strokePath` in the PDF ink); only
 * the way it is written changes, which takes a drawing of thousands of strokes from tens of
 * megabytes to a few.
 */

/** How many numbers each command takes, and which of them are points. */
const ARGS: Record<string, { n: number; points: number[] }> = {
  M: { n: 2, points: [0] },
  L: { n: 2, points: [0] },
  Q: { n: 4, points: [0, 2] },
  C: { n: 6, points: [0, 2, 4] },
  A: { n: 7, points: [5] },
  Z: { n: 0, points: [] },
}

/** A rounded number with nothing it does not need: `-0.5` as `-.5`, `2.0` as `2`. */
function num(n: number, precision = 10): string {
  const r = Math.round(n * precision) / precision
  const s = String(r === 0 ? 0 : r)
  return s.replace(/^(-?)0\./, '$1.')
}

/** Numbers joined the way SVG reads them: a minus sign or a leading dot needs no space before it. */
function join(nums: string[]): string {
  let out = ''
  for (const s of nums) {
    if (!out) out = s
    else if (s[0] === '-' || (s[0] === '.' && /[.\d]*\.\d*$/.test(out))) out += s
    else out += ` ${s}`
  }
  return out
}

/** Absolute commands rewritten relative; bounded stylus outlines use finer precision. */
export function compactPath(d: string, precision = 10): string {
  const round = (n: number) => Math.round(n * precision) / precision
  const format = (n: number) => num(n, precision)
  const tokens = d.match(/[MLQCAZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []
  let out = ''
  let i = 0
  // Where the outline began as written: a close takes the pen back there, as SVG reads it.
  let sx = 0
  let sy = 0
  // Where the pen is as written, rounded, so errors do not add up along a long outline.
  let wx = 0
  let wy = 0
  let first = true
  while (i < tokens.length) {
    const cmd = tokens[i++].toUpperCase()
    const spec = ARGS[cmd]
    if (!spec) continue
    if (cmd === 'Z') {
      out += 'z'
      wx = sx
      wy = sy
      continue
    }
    const args = tokens.slice(i, i + spec.n).map(Number)
    i += spec.n
    if (args.length < spec.n || args.some((v) => !Number.isFinite(v))) break
    if (first && cmd === 'M') {
      first = false
      wx = round(args[0])
      wy = round(args[1])
      out += `M${join([format(wx), format(wy)])}`
      sx = wx
      sy = wy
      continue
    }
    const rel = args.map((v, k) => {
      const pair = spec.points.find((p) => k === p || k === p + 1)
      if (pair === undefined) return format(v)
      return format(v - (k === pair ? wx : wy))
    })
    // What the end point is as written, to measure the next one from.
    wx = round(wx + Number(rel[spec.n - 2]))
    wy = round(wy + Number(rel[spec.n - 1]))
    if (cmd === 'M') {
      sx = wx
      sy = wy
    }
    out += cmd.toLowerCase() + join(rel)
  }
  return out
}
