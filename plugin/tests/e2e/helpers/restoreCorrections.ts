/** Visible corrections, not no-op attempts while a renderer is still measuring. */
export function correctiveScrollFrames(attempts: number[], pixels: number[]): number[] {
  const used = new Set<number>()
  const corrections: number[] = []
  for (let frame = 0; frame < pixels.length; frame++) {
    if (pixels[frame] === (frame === 0 ? 0 : pixels[frame - 1])) continue
    // Source-mode restoration is deferred to CodeMirror's measurement frame. Attribute
    // only a nearby movement, once per request; later render anchoring is not a restore.
    const request = attempts.findLast((at) => at <= frame && at >= frame - 2)
    if (request === undefined || used.has(request)) continue
    used.add(request)
    corrections.push(frame)
  }
  return corrections
}
