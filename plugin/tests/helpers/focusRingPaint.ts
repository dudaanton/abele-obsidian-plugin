/** Test-only paint estimate, serialized into the live layout probes. */
export function outwardBoxShadowReach(boxShadow: string): number {
  // A shadow list's separators are outside color functions, not rgba's own commas.
  const layers: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < boxShadow.length; i++) {
    const char = boxShadow[i]
    if (char === '(') depth++
    else if (char === ')') depth--
    else if (char === ',' && depth === 0) {
      layers.push(boxShadow.slice(start, i))
      start = i + 1
    }
  }
  layers.push(boxShadow.slice(start))

  return layers.reduce((reach, layer) => {
    // Ignore only this inward layer: another layer may still paint a real outer ring.
    if (/\binset\b/i.test(layer)) return reach
    const nums = (layer.match(/-?\d*\.?\d+px/g) || []).map(parseFloat)
    // Keep the existing conservative blur/spread math; do not change offsets or geometry.
    const outer = Math.max(0, nums[2] ?? 0) + Math.max(0, nums[3] ?? 0)
    return Math.max(reach, outer)
  }, 0)
}
