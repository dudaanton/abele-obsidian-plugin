/** Incremental, bounded smoothing in document units; independent of the host and renderer. */
export class StylusSmoother {
  readonly points: number[] = []
  private previous: [number, number] | null = null

  constructor(private readonly zoom: number) {}

  /**
   * Keep the tip exact. When its successor arrives, ease only the preceding point once,
   * using raw neighbours (no accumulated drift). Both neighbours must be within two CSS
   * pixels: sparse samples describe shape, not sensor jitter. Turns >=45 degrees stay intact.
   * Pressure is deliberately untouched: even a one-sample width peak keeps its location.
   */
  add(x: number, y: number, pressure: number): void {
    const p = this.points,
      n = p.length
    if (n >= 3) {
      const bx = p[n - 3],
        by = p[n - 2]
      // Coalesced events often repeat the dispatched event. Do not turn it into a corner.
      if (bx === x && by === y && p[n - 1] === pressure) return
      const a = this.previous
      if (a) {
        const ux = bx - a[0],
          uy = by - a[1],
          vx = x - bx,
          vy = y - by
        const zoom = Number.isFinite(this.zoom) && this.zoom > 0 ? this.zoom : 1
        const before = Math.hypot(ux, uy),
          after = Math.hypot(vx, vy)
        const lengths = before * after
        if (
          before <= 2 / zoom &&
          after <= 2 / zoom &&
          lengths > 0 &&
          (ux * vx + uy * vy) / lengths > Math.SQRT1_2
        ) {
          const dx = (a[0] - 2 * bx + x) / 8,
            dy = (a[1] - 2 * by + y) / 8
          const cap = 0.25 / zoom
          const scale = Math.min(1, cap / (Math.hypot(dx, dy) || 1))
          p[n - 3] = bx + dx * scale
          p[n - 2] = by + dy * scale
        }
      }
      this.previous = [bx, by]
    }
    p.push(x, y, pressure)
  }
}
