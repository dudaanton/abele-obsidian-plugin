import { getStroke } from 'perfect-freehand'

/** Invented pencil graph: dense samples, including quantised input needing streamline. */
const curves = [1, 2].flatMap((strokeWidth, row) =>
  [false, true].map((simulatePressure, column) => ({
    id: `curve-${row}-${column}`,
    type: 'freedraw',
    x: 35.013,
    y: 65.027 + (row * 2 + column) * 70,
    width: 260,
    height: 38,
    strokeWidth,
    strokeColor: '#000000',
    opacity: 100,
    simulatePressure,
    points: Array.from({ length: 1301 }, (_, i) => [
      i * 0.2,
      Math.round(Math.cos(i / 207) * 19 * 4) / 4,
    ]),
    pressures: Array.from({ length: 1301 }, (_, i) => 0.12 + (i / 1300) * 0.75),
  }))
)
export const pencilElements = [
  ...curves,
  { ...curves[1], id: 'simulated-dot', points: [[10.02, 12.03]], pressures: [0.99] },
  ...[
    [
      [20, 20],
      [20, 330],
    ],
    [
      [20, 330],
      [315, 330],
    ],
    [
      [320, 320],
      [325, 320],
      [322, 320],
      [322, 340],
    ],
  ].map((points, i) => ({
    ...curves[0],
    id: `axis-label-${i}`,
    x: 0,
    y: 0,
    width: 330,
    height: 340,
    strokeColor: '#868e96',
    simulatePressure: false,
    points,
    pressures: points.map(() => 0.2),
  })),
]
export const pencilScene = JSON.stringify({ type: 'excalidraw', elements: pencilElements })

/** Independent reference: Excalidraw shape.ts variable freedraw and outline closure. */
export function referencePath(el: (typeof pencilElements)[number]): string {
  const outline = getStroke(
    el.points.map(([x, y], i) =>
      el.simulatePressure ? [x + el.x, y + el.y] : [x + el.x, y + el.y, el.pressures[i]]
    ),
    {
      size: el.strokeWidth * 4.25,
      thinning: 0.6,
      smoothing: 0.5,
      streamline: 0.5,
      simulatePressure: el.simulatePressure,
      easing: (t) => Math.sin((t * Math.PI) / 2),
      last: true,
    }
  )
  if (!outline.length) return ''
  let d = `M${outline[0].join(' ')} Q`
  outline.forEach((p, i) => {
    const next = outline[(i + 1) % outline.length]
    d += `${p[0]} ${p[1]} ${(p[0] + next[0]) / 2} ${(p[1] + next[1]) / 2} `
  })
  return d + `L${outline[0].join(' ')}Z`
}
