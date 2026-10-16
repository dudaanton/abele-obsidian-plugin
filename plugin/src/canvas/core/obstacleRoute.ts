/** Orthogonal visibility-grid routing around card bounds. */
import type { Rect } from './model'
interface Point {
  x: number
  y: number
}
export function obstacleRoute(a: Point, b: Point, obstacles: Rect[]): Point[] {
  if (obstacles.length > 102)
    throw new Error('Obstacle routing supports up to 100 cards; use explicit waypoints')
  const boxes = obstacles.map((r) => ({
    x: r.x - 12,
    y: r.y - 12,
    width: r.width + 24,
    height: r.height + 24,
  }))
  const inside = (p: Point, r: Rect) =>
    p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height
  if (boxes.some((r) => inside(a, r) || inside(b, r)))
    throw new Error(
      'Connection anchor is covered by another card; move cards or choose another side'
    )
  const xs = [...new Set([a.x, b.x, ...boxes.flatMap((r) => [r.x, r.x + r.width])])].sort(
    (a, b) => a - b
  )
  const ys = [...new Set([a.y, b.y, ...boxes.flatMap((r) => [r.y, r.y + r.height])])].sort(
    (a, b) => a - b
  )
  const width = xs.length,
    count = width * ys.length
  const start = ys.indexOf(a.y) * width + xs.indexOf(a.x),
    end = ys.indexOf(b.y) * width + xs.indexOf(b.x)
  const point = (i: number) => ({ x: xs[i % width], y: ys[Math.floor(i / width)] })
  const distances = new Map<number, number>([[start, 0]]),
    previous = new Map<number, number>()
  const queue: [number, number][] = [[start, 0]]
  // Binary heap bounds work even for a dense canvas grid.
  const push = (entry: [number, number]) => {
    queue.push(entry)
    let i = queue.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (queue[p][1] <= entry[1]) break
      queue[i] = queue[p]
      i = p
    }
    queue[i] = entry
  }
  const pop = () => {
    const first = queue[0],
      last = queue.pop()!
    if (queue.length) {
      let i = 0
      while (i * 2 + 1 < queue.length) {
        let child = i * 2 + 1
        if (child + 1 < queue.length && queue[child + 1][1] < queue[child][1]) child++
        if (queue[child][1] >= last[1]) break
        queue[i] = queue[child]
        i = child
      }
      queue[i] = last
    }
    return first
  }
  while (queue.length) {
    const [id, cost] = pop()
    if (cost !== distances.get(id)) continue
    if (id === end) {
      const path: Point[] = []
      let cursor = id
      while (cursor !== start) {
        path.push(point(cursor))
        cursor = previous.get(cursor)!
      }
      path.push(a)
      path.reverse()
      return path.filter(
        (p, i) =>
          i === 0 ||
          i === path.length - 1 ||
          !(
            (path[i - 1].x === p.x && p.x === path[i + 1].x) ||
            (path[i - 1].y === p.y && p.y === path[i + 1].y)
          )
      )
    }
    const p = point(id)
    const neighbors = [
      id - width,
      id + width,
      ...(id % width > 0 ? [id - 1] : []),
      ...(id % width < width - 1 ? [id + 1] : []),
    ]
    for (const next of neighbors) {
      if (next < 0 || next >= count) continue
      const q = point(next)
      if (
        boxes.some(
          (r) =>
            inside(q, r) ||
            (p.x === q.x
              ? p.x > r.x &&
                p.x < r.x + r.width &&
                Math.max(p.y, q.y) > r.y &&
                Math.min(p.y, q.y) < r.y + r.height
              : p.y > r.y &&
                p.y < r.y + r.height &&
                Math.max(p.x, q.x) > r.x &&
                Math.min(p.x, q.x) < r.x + r.width)
        )
      )
        continue
      const distance = cost + Math.abs(p.x - q.x) + Math.abs(p.y - q.y)
      if (distance < (distances.get(next) ?? Infinity)) {
        distances.set(next, distance)
        previous.set(next, id)
        push([next, distance])
      }
    }
  }
  throw new Error('No route around cards; choose different anchors or explicit waypoints')
}
