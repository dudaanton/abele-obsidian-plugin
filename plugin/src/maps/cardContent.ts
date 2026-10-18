import { findGalleryBlocks } from '@/helpers/galleryUtils'
import type { MapPlacePhoto } from './core/records'
import type { ViewerImage } from '@/helpers/viewerImage'

/** Read a note without writing to its galleries or exposing its frontmatter as prose. */
export function cardContent(source: string, resolve: (path: string) => string | null) {
  const lines = source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').split('\n')
  const blocks = findGalleryBlocks(lines)
  const photos: MapPlacePhoto[] = blocks.flatMap((block) =>
    block.images
      .filter((image) => image.mediaType === 'image')
      .map((image) => {
        const url = image.type === 'remote' ? image.path : resolve(image.path)
        return {
          path: image.path,
          url: url ?? '',
          caption: image.description,
          missing: !url,
          type: image.type,
        }
      })
  )
  const text = lines
    .filter((_, index) => !blocks.some((b) => index >= b.headerLine && index <= b.lastLine))
    .join('\n')
    .trim()
  return { text, photos }
}

/** Missing thumbnails keep their positions on the card, but never enter the viewer. */
export function viewerPhotos(
  photos: MapPlacePhoto[],
  index: number
): { images: ViewerImage[]; index: number } | null {
  if (!photos[index] || photos[index].missing) return null
  return {
    images: photos
      .filter((p) => !p.missing)
      .map((p) => ({
        url: p.url,
        alt: p.caption ?? '',
        type: p.type ?? 'local',
        path: p.path,
        description: p.caption,
      })),
    index: photos.slice(0, index).filter((p) => !p.missing).length,
  }
}
