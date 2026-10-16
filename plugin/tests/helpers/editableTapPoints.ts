/** Browser-injected probe: sample the visible writing surface, including its rounded edges. */
export function editableTapPoints(
  box: { left: number; top: number; width: number; height: number },
  radii: string[]
): Array<[number, number]> {
  const length = (value: string, size: number) =>
    (parseFloat(value) || 0) * (value.endsWith('%') ? size / 100 : 1)
  const corners = radii.map((radius) => {
    const [x, y = x] = radius.split(/\s+/)
    return [length(x, box.width), length(y, box.height)]
  })
  // CSS scales overlapping corner radii together to fit the border box.
  const scale = Math.min(
    1,
    box.width / (corners[0][0] + corners[1][0]),
    box.width / (corners[3][0] + corners[2][0]),
    box.height / (corners[0][1] + corners[3][1]),
    box.height / (corners[1][1] + corners[2][1])
  )
  const [tl, tr, br, bl] = corners.map(([x, y]) => [x * scale, y * scale])
  const inset = Math.min(2, box.width / 4, box.height / 4)
  // At 45 degrees on each corner's ellipse, inset from its painted boundary.
  const diagonal = 1 - Math.SQRT1_2
  const right = box.left + box.width
  const bottom = box.top + box.height
  return [
    [box.left + tl[0] * diagonal + inset, box.top + tl[1] * diagonal + inset],
    [right - tr[0] * diagonal - inset, box.top + tr[1] * diagonal + inset],
    [right - br[0] * diagonal - inset, bottom - br[1] * diagonal - inset],
    [box.left + bl[0] * diagonal + inset, bottom - bl[1] * diagonal - inset],
    [box.left + (tl[0] + box.width - tr[0]) / 2, box.top + inset],
    [right - inset, box.top + (tr[1] + box.height - br[1]) / 2],
    [box.left + (bl[0] + box.width - br[0]) / 2, bottom - inset],
    [box.left + inset, box.top + (tl[1] + box.height - bl[1]) / 2],
    [box.left + box.width / 2, box.top + box.height / 2],
  ]
}
