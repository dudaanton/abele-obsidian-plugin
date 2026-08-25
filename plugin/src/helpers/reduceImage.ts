import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'

const MAX_DIM = 2000

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality)
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface ReduceResult {
  reduced: boolean
  originalSize: number
  newSize: number
}

/** Re-encode image at reduced quality/size. Returns whether it was actually reduced. */
export async function reduceImageFile(file: TFile): Promise<ReduceResult> {
  const { app } = GlobalStore.getInstance()
  const buffer = await app.vault.readBinary(file)
  const blob = new Blob([buffer])
  const imgUrl = URL.createObjectURL(blob)

  try {
    const img = await loadImage(imgUrl)
    let width = img.naturalWidth
    let height = img.naturalHeight

    if (width > MAX_DIM || height > MAX_DIM) {
      const ratio = Math.min(MAX_DIM / width, MAX_DIM / height)
      width = Math.round(width * ratio)
      height = Math.round(height * ratio)
    }

    const canvas = createEl('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, width, height)

    const mimeType = file.extension === 'png' ? 'image/png' : 'image/jpeg'
    const quality = mimeType === 'image/jpeg' ? 0.8 : undefined
    const reducedBlob = await canvasToBlob(canvas, mimeType, quality)
    const reducedBuffer = await reducedBlob.arrayBuffer()

    if (reducedBuffer.byteLength >= buffer.byteLength) {
      return { reduced: false, originalSize: buffer.byteLength, newSize: buffer.byteLength }
    }

    await app.vault.modifyBinary(file, reducedBuffer)
    return { reduced: true, originalSize: buffer.byteLength, newSize: reducedBuffer.byteLength }
  } finally {
    URL.revokeObjectURL(imgUrl)
  }
}
