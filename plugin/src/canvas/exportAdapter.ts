/** Capture once, paint with the shared renderer, encode completely, then create a new file. */
import { TFile, type App } from 'obsidian'
import { ObsidianCanvasStore, canvasPath } from './obsidianStore'
import { canvasPicture } from './pictureAdapter'
import { imagePagePdf, planCanvasExport, type CanvasExportFormat } from './core/export'

export function exportPath(input: string, format: CanvasExportFormat): string {
  // Apply the same vault-relative safety rules, including hidden directories, as canvas sources.
  if (!input.endsWith(`.${format}`)) throw new Error(`Output must end in .${format}`)
  canvasPath(input.slice(0, -format.length) + 'canvas')
  return input
}
export async function exportCanvas(
  app: App,
  options: {
    path: string
    output: string
    format: CanvasExportFormat
    maxSide?: number
    inScope: (path: string) => boolean
    signal?: AbortSignal
  }
) {
  const { signal, inScope, format } = options
  const path = canvasPath(options.path),
    output = exportPath(options.output, format)
  const check = () => {
    signal?.throwIfAborted()
    if (!inScope(path)) throw new Error('Canvas is outside scope')
    if (app.vault.getAbstractFileByPath(output)) throw new Error(`Output already exists: ${output}`)
  }
  check()
  const snapshot = await new ObsidianCanvasStore(app).snapshot(path)
  const plan = planCanvasExport(snapshot.graph, options.maxSide)
  check()
  const picture = await canvasPicture(
    app,
    plan.graph,
    path,
    {
      region: plan.region,
      maxSide: plan.maxSide,
      boundedAssets: true,
    },
    inScope,
    signal
  )
  signal?.throwIfAborted()
  let bytes: Uint8Array
  try {
    if (format === 'svg') {
      const url = picture.canvas.toDataURL('image/png')
      if (!url.startsWith('data:image/png;base64,'))
        throw new Error('SVG image encoding unavailable')
      bytes = new TextEncoder().encode(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${picture.canvas.width}" height="${picture.canvas.height}" viewBox="0 0 ${picture.canvas.width} ${picture.canvas.height}"><image width="100%" height="100%" href="${url}"/></svg>\n`
      )
    } else {
      const blob = await new Promise<Blob>((resolve, reject) =>
        picture.canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Image encoding unavailable'))),
          format === 'pdf' ? 'image/jpeg' : 'image/png',
          0.95
        )
      )
      signal?.throwIfAborted()
      const encoded = new Uint8Array(await blob.arrayBuffer())
      bytes =
        format === 'pdf'
          ? imagePagePdf(encoded, picture.canvas.width, picture.canvas.height)
          : encoded
    }
    check()
    // Never expose a truncated final picture. This is output staging, not canvas persistence.
    const folder = output.includes('/') ? output.slice(0, output.lastIndexOf('/') + 1) : ''
    const staging = `${folder}canvas-export-${crypto.randomUUID()}.tmp`
    let file: TFile
    try {
      file = await app.vault.createBinary(staging, bytes.buffer as ArrayBuffer)
      check()
      await app.vault.rename(file, output)
    } catch (error) {
      const partial = app.vault.getAbstractFileByPath(staging)
      if (partial instanceof TFile) {
        try {
          await app.fileManager.trashFile(partial)
        } catch {
          /* The final output is still absent. */
        }
      }
      throw error
    }
    return {
      file,
      revision: snapshot.revision,
      region: picture.region,
      width: picture.canvas.width,
      height: picture.canvas.height,
      visible: picture.visible,
      warnings: picture.warnings,
      rasterBacked: true,
    }
  } finally {
    // Release the raster backing store even on encoding/write failure or cancellation.
    picture.canvas.width = picture.canvas.height = 0
  }
}
