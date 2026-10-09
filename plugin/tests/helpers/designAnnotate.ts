import type { DesignSnapshot, Violation } from './designLint'

/** Browser-only renderer. Screenshot pixels are mapped to CSS coordinates, including HiDPI. */
export async function annotateDesign(
  snapshot: DesignSnapshot,
  violations: Violation[],
  png: string,
  emit: (name: string, dataUrl: string) => void
): Promise<void> {
  const image = new Image()
  image.src = png
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = snapshot.viewport.width
  canvas.height = snapshot.viewport.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  ctx.font = '11px sans-serif'
  ctx.lineWidth = 1
  for (const e of snapshot.elements) {
    ctx.strokeStyle = 'rgba(0,130,210,0.28)'
    ctx.strokeRect(e.rect.x, e.rect.y, e.rect.width, e.rect.height)
    if (e.slot === 'text' && e.firstLine) {
      ctx.save()
      ctx.setLineDash([3, 3])
      ctx.strokeStyle = 'rgba(0,130,210,0.65)'
      ctx.beginPath()
      ctx.moveTo(e.firstLine.x, 0)
      ctx.lineTo(e.firstLine.x, canvas.height)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(0,160,100,0.65)'
      ctx.beginPath()
      ctx.moveTo(e.firstLine.x, e.baseline ?? e.firstLine.y + e.firstLine.height)
      ctx.lineTo(
        e.firstLine.x + e.firstLine.width,
        e.baseline ?? e.firstLine.y + e.firstLine.height
      )
      ctx.stroke()
      ctx.restore()
    }
  }
  const guides = document.createElement('canvas')
  guides.width = canvas.width
  guides.height = canvas.height
  guides.getContext('2d')!.drawImage(canvas, 0, 0)
  const labels = new Map<number, number>()
  violations.forEach((v, i) => {
    ctx.strokeStyle = '#e00020'
    ctx.lineWidth = 2
    for (const b of v.boxes) ctx.strokeRect(b.x, b.y, b.width, b.height)
    const b = v.boxes[0]
    if (!b) return
    const x = Math.max(0, Math.min(canvas.width - 180, b.x)),
      key = Math.round(b.y / 12)
    const offset = labels.get(key) ?? 0
    labels.set(key, offset + 1)
    const y = Math.max(12, Math.min(canvas.height - 2, b.y - 3 + offset * 13))
    const label = `${i + 1}: ${v.rule}`
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(x, y - 11, ctx.measureText(label).width + 4, 13)
    ctx.fillStyle = '#c00020'
    ctx.fillText(label, x + 2, y)
  })
  emit('annotated.png', canvas.toDataURL('image/png'))
  for (const [i, v] of violations.entries()) {
    if (!v.boxes.length) continue
    const x = Math.max(0, Math.floor(Math.min(...v.boxes.map((b) => b.x)) - 20))
    const y = Math.max(0, Math.floor(Math.min(...v.boxes.map((b) => b.y)) - 24))
    const right = Math.min(
      canvas.width,
      Math.ceil(Math.max(...v.boxes.map((b) => b.x + b.width)) + 20)
    )
    const bottom = Math.min(
      canvas.height,
      Math.ceil(Math.max(...v.boxes.map((b) => b.y + b.height)) + 20)
    )
    if (right <= x || bottom <= y) continue
    const crop = document.createElement('canvas')
    crop.width = (right - x) * 3
    crop.height = (bottom - y) * 3
    const context = crop.getContext('2d')!
    context.imageSmoothingEnabled = false
    context.drawImage(guides, x, y, right - x, bottom - y, 0, 0, crop.width, crop.height)
    context.scale(3, 3)
    context.strokeStyle = '#e00020'
    context.lineWidth = 2
    for (const b of v.boxes) context.strokeRect(b.x - x, b.y - y, b.width, b.height)
    context.font = '11px sans-serif'
    const label = `#${i + 1}${v.delta !== undefined ? ' ' + v.delta.toFixed(1) + 'px' : ''}`
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, context.measureText(label).width + 4, 14)
    context.fillStyle = '#c00020'
    context.fillText(label, 2, 11)
    emit(
      `violation-${String(i + 1).padStart(3, '0')}-${v.rule}-3x.png`,
      crop.toDataURL('image/png')
    )
  }
}
