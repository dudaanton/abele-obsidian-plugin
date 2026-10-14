/** Canvas embed subpaths are presentation requests, never storage edits. */
import type { Rect } from './core/model'

export interface CanvasEmbedOptions {
  step?: number
  node?: string
  /** A part of the canvas, in its own units: `#part=x,y,width,height`, as a drawing names one. */
  region?: Rect
}

export function canvasEmbedOptions(source: string): CanvasEmbedOptions {
  const subpath = source.split('|')[0].split('#').slice(1).join('#')
  if (subpath.startsWith('step=')) {
    const value = subpath.slice(5)
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
      throw new Error('Canvas step must be a positive one-based number')
    return { step: Number(value) }
  }
  if (subpath.startsWith('node=')) {
    if (!subpath.slice(5)) throw new Error('Canvas node id is empty')
    return { node: subpath.slice(5) }
  }
  if (subpath.startsWith('part=')) {
    const nums = subpath.slice(5).split(',').map(Number)
    if (nums.length !== 4 || !nums.every(Number.isFinite) || nums[2] <= 0 || nums[3] <= 0)
      throw new Error('Canvas part must be x,y,width,height with a positive width and height')
    const [x, y, width, height] = nums
    return { region: { x, y, width, height } }
  }
  return {}
}

/** The embed of a canvas, of one card or frame in it, or of a part of it. */
export function canvasEmbed(path: string, options: { node?: string; region?: Rect }): string {
  const r = options.region
  const subpath = r
    ? `#part=${[r.x, r.y, r.width, r.height].map((n) => Math.round(n)).join(',')}`
    : options.node
      ? `#node=${options.node}`
      : ''
  return `![[${path}${subpath}]]`
}
