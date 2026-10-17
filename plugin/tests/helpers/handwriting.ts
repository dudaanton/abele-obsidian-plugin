import type { InkStroke } from '@/ink/stroke'

/** Invented sparse loop, independent of any recorded handwriting. */
export const handwriting: InkStroke = {
  tool: 'pen',
  color: 'black',
  size: 2.2,
  linear: true,
  points: Array.from({ length: 17 }, (_, i) => {
    const t = (i * Math.PI) / 12
    return [80 + 35 * Math.sin(t), 80 - 45 * Math.cos(t), 0.5]
  }).flat(),
}
