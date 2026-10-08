import { readCodes, readableSize, closerLooks, type Rect } from '@/transfer/scan'
import { InviteSchema, assertPairedEndpoint } from '@abele/channel-protocol'

/** Uses the native camera/photo picker on mobile, with the bundled WebKit QR decoder. */
export async function invitationPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  const image = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Could not read this picture'))
      image.src = url
    })
    const canvas = createEl('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Picture decoding is unavailable on this device')
    const regions: Rect[] = [
      { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight },
      ...closerLooks(image.naturalWidth, image.naturalHeight),
    ]
    for (const region of regions) {
      const size = readableSize(region.width, region.height)
      canvas.width = size.width
      canvas.height = size.height
      context.drawImage(
        image,
        region.x,
        region.y,
        region.width,
        region.height,
        0,
        0,
        size.width,
        size.height
      )
      for (const text of await readCodes(context.getImageData(0, 0, size.width, size.height))) {
        try {
          const invite = InviteSchema.parse(JSON.parse(text))
          assertPairedEndpoint(invite.endpoint)
          return text
        } catch {
          /* Other QR codes are not node invitations. */
        }
      }
    }
    throw new Error('No node invitation found in this picture')
  } finally {
    URL.revokeObjectURL(url)
  }
}
