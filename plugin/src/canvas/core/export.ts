/** Whole-scene planning and a single raster PDF page; no host, camera or file writes. */
import { cloneCanvas, type CanvasGraph } from './model'
import { pictureRegion } from './painter'
import { rasterScale } from '../../drawing/rasterize'

export type CanvasExportFormat = 'png' | 'svg' | 'pdf'
export const EXPORT_LIMITS = {
  rasterPixels: 4096 * 4096,
  assetBytes: 8 * 1024 * 1024,
  totalAssetBytes: 16 * 1024 * 1024,
  decodedPixels: 16 * 1024 * 1024,
} as const

export function planCanvasExport(source: CanvasGraph, maxSide = 4096) {
  if (!Number.isInteger(maxSide) || maxSide < 64 || maxSide > 4096)
    throw new Error('maxSide must be an integer between 64 and 4096')
  const graph = cloneCanvas(source),
    region = pictureRegion(graph)
  const scale = rasterScale(
    { x: region.x, y: region.y, w: region.width, h: region.height },
    { maxSide }
  )
  return {
    graph,
    region,
    maxSide,
    width: Math.max(1, Math.round(region.width * scale)),
    height: Math.max(1, Math.round(region.height * scale)),
  }
}

/** Header-only dimensions. Unknown encodings must not be decoded by bounded export. */
export function imageDimensions(
  bytes: Uint8Array,
  extension: string
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (start: number, end: number) => new TextDecoder().decode(bytes.subarray(start, end))
  try {
    if (
      extension === 'png' &&
      bytes[0] === 137 &&
      ascii(1, 4) === 'PNG' &&
      ascii(12, 16) === 'IHDR'
    ) {
      // Animation can retain many full decoded frames, beyond the single-surface budget.
      for (let offset = 8; offset + 8 <= bytes.length; ) {
        if (ascii(offset + 4, offset + 8) === 'acTL') return null
        offset += view.getUint32(offset) + 12
      }
      return { width: view.getUint32(16), height: view.getUint32(20) }
    }
    if (extension === 'gif' && ascii(0, 3) === 'GIF') {
      let offset = 13 + (bytes[10] & 128 ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0),
        frames = 0
      const blocks = () => {
        while (offset < bytes.length) {
          const size = bytes[offset++]
          if (!size) return
          offset += size
        }
      }
      while (offset < bytes.length) {
        const kind = bytes[offset++]
        if (kind === 59) break
        if (kind === 33) {
          offset++
          blocks()
        } else if (kind === 44) {
          if (++frames > 1) return null
          const flags = bytes[offset + 8]
          offset += 9 + (flags & 128 ? 3 * (1 << ((flags & 7) + 1)) : 0)
          offset++ // LZW minimum code size, followed by data sub-blocks.
          blocks()
        } else return null
      }
      return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
    }
    if (extension === 'bmp' && ascii(0, 2) === 'BM')
      return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) }
    if (/^jpe?g$/i.test(extension) && bytes[0] === 255 && bytes[1] === 216) {
      let offset = 2
      while (offset + 4 <= bytes.length) {
        if (bytes[offset++] !== 255) return null
        while (bytes[offset] === 255) offset++
        const marker = bytes[offset++]
        if (marker === 217 || marker === 218) return null
        if (marker === 1 || (marker >= 208 && marker <= 215)) continue
        const length = view.getUint16(offset)
        if (length < 2 || offset + length > bytes.length) return null
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker))
          return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) }
        offset += length
      }
    }
    if (extension === 'webp' && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
      const kind = ascii(12, 16)
      if (kind === 'VP8X' && bytes[20] & 2) return null
      if (kind === 'VP8X')
        return {
          width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
          height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
        }
      if (kind === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42)
        return { width: view.getUint16(26, true) & 16383, height: view.getUint16(28, true) & 16383 }
      if (kind === 'VP8L' && bytes[20] === 47) {
        const bits = view.getUint32(21, true)
        return { width: (bits & 16383) + 1, height: ((bits >>> 14) & 16383) + 1 }
      }
    }
  } catch {
    /* Truncated or malformed headers are unavailable, never trusted dimensions. */
  }
  return null
}

/** JPEG-backed PDF, with byte offsets (not string offsets) for every object and stream. */
export function imagePagePdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  if (![width, height].every((v) => Number.isInteger(v) && v > 0 && v <= 4096) || !jpeg.length)
    throw new Error('Invalid PDF image dimensions or bytes')
  const encoder = new TextEncoder(),
    chunks: Uint8Array[] = [],
    offsets: number[] = [0]
  let length = 0
  const append = (value: string | Uint8Array) => {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value
    chunks.push(bytes)
    length += bytes.length
  }
  const object = (id: number, content: string) => {
    offsets[id] = length
    append(`${id} 0 obj\n${content}\nendobj\n`)
  }
  const w = width * 0.75,
    h = height * 0.75
  append('%PDF-1.4\n% raster canvas\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Image 4 0 R >> >> /Contents 5 0 R >>`
  )
  offsets[4] = length
  append(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
  )
  append(jpeg)
  append('\nendstream\nendobj\n')
  const commands = `q\n${w} 0 0 ${h} 0 0 cm\n/Image Do\nQ\n`
  object(5, `<< /Length ${encoder.encode(commands).length} >>\nstream\n${commands}endstream`)
  const xref = length
  append('xref\n0 6\n0000000000 65535 f \n')
  for (const offset of offsets.slice(1)) append(`${String(offset).padStart(10, '0')} 00000 n \n`)
  append(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}
