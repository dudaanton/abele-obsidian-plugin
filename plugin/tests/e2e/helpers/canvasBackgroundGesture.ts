/** Pure screen/world fixture geometry; serialize this function into the app without imports. */
export function canvasBackgroundGesture(
  stage: { left: number; top: number; width: number; height: number },
  camera: { x: number; y: number; zoom: number },
  nodes: { x: number; y: number; width: number; height: number; type?: string }[],
  dx: number,
  dy: number
): [number[], number[]] {
  const clear = (point: number[]) => {
    const [sx, sy] = point
    if (
      sx <= stage.left + 2 ||
      sx >= stage.left + stage.width - 2 ||
      sy <= stage.top + 2 ||
      sy >= stage.top + stage.height - 2
    )
      return false
    const x = (sx - stage.left) / camera.zoom + camera.x
    const y = (sy - stage.top) / camera.zoom + camera.y
    return !nodes.some(
      (node) =>
        node.type !== 'group' &&
        x >= node.x &&
        x <= node.x + node.width &&
        y >= node.y &&
        y <= node.y + node.height
    )
  }
  for (const fy of [0.05, 0.95, 0.15, 0.85])
    for (const fx of [0.05, 0.95, 0.15, 0.85]) {
      const from = [
        Math.round(stage.left + stage.width * fx),
        Math.round(stage.top + stage.height * fy),
      ]
      const to = [from[0] + dx, from[1] + dy]
      if (clear(from) && clear(to)) return [from, to]
    }
  throw new Error('No off-card background gesture: ' + JSON.stringify({ stage, camera, nodes }))
}
