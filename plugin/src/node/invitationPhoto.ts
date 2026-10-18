import { UiError, uiMessage } from '@/i18n/streamBErrors'
import { readCodes, readableSize, closerLooks, type Rect } from '@/transfer/scan'
import { InviteSchema, assertPairedEndpoint } from '@abele/channel-protocol'

/** Uses the native camera/photo picker on mobile, with the bundled WebKit QR decoder. */
export async function invitationPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  const image = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new UiError(uiMessage('streamBError.74e2c88c85')))
      image.src = url
    })
    const canvas = createEl('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new UiError(uiMessage('streamBError.fbba4c81db'))
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
    throw new UiError(uiMessage('streamBError.35732e49c9'))
  } finally {
    URL.revokeObjectURL(url)
  }
}
