export function isHeicImport(name: string, mime = ''): boolean {
  return /\.(heic|heif)$/i.test(name) || /^image\/(heic|heif)(-sequence)?(?:;|$)/i.test(mime)
}

async function nativePng(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Native HEIC decoding unavailable'))
      image.src = url
    })
    const canvas = createEl('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context || !canvas.width || !canvas.height) throw new Error('Image has no pixels')
    context.drawImage(image, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (png) => (png ? resolve(png) : reject(new Error('PNG encoding failed'))),
        'image/png'
      )
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Normalize an incoming image before choosing its vault filename. */
export async function normalizeImageImport(
  name: string,
  blob: Blob
): Promise<{ name: string; blob: Blob; unconvertedHeic?: boolean }> {
  if (!isHeicImport(name, blob.type)) return { name, blob }
  // iOS WebKit can decode HEIC without shipping a decoder into the page.
  try {
    const png = await nativePng(blob)
    return { name: name.replace(/\.(heic|heif)$/i, '') + '.png', blob: png }
  } catch {
    // A platform without native decoding keeps the original as a file, never mislabeled PNG.
    return { name, blob, unconvertedHeic: true }
  }
}
