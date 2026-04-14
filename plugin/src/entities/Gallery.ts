import { genid } from '@/helpers/vueUtils'
import { GalleryImageEntry } from '@/helpers/galleryUtils'
import { GlobalStore } from '@/stores/GlobalStore'

export class Gallery {
  public readonly id: string
  public readonly filePath: string
  public readonly images: GalleryImageEntry[]
  public readonly layout: string

  constructor(data: {
    id?: string
    filePath: string
    images: GalleryImageEntry[]
    layout: string
  }) {
    this.id = data.id || genid()
    this.filePath = data.filePath
    this.images = data.images
    this.layout = data.layout
  }

  resolveImageUrl(image: GalleryImageEntry, version = 0): string | null {
    if (image.type === 'remote') {
      return image.path
    }

    const { app } = GlobalStore.getInstance()
    const file = app.metadataCache.getFirstLinkpathDest(image.path, this.filePath)
    if (file) {
      const url = app.vault.getResourcePath(file)
      return version ? `${url}#v=${version}` : url
    }

    return null
  }

  cleanup() {
    // nothing to clean up for now
  }
}
