import { Notice, TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { getMediaType } from '@/helpers/galleryUtils'
import { getAttachmentFolder } from '@/ai/tools/imageUtils'

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'ogv']
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']
const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]

/**
 * Find the first image/video embed in a note's content.
 * Returns the resolved TFile or null.
 */
export function findFirstMedia(content: string, sourcePath: string): TFile | null {
  const { app } = GlobalStore.getInstance()

  // Wikilink embeds: ![[path|alt]]
  const wikiRegex = /!\[\[([^\]|]+)/g
  let match: RegExpExecArray | null
  while ((match = wikiRegex.exec(content)) !== null) {
    const file = app.metadataCache.getFirstLinkpathDest(match[1], sourcePath)
    if (file instanceof TFile && MEDIA_EXTENSIONS.includes(file.extension.toLowerCase())) {
      return file
    }
  }

  // Markdown embeds: ![alt](path)
  const mdRegex = /!\[[^\]]*\]\(([^)]+)\)/g
  while ((match = mdRegex.exec(content)) !== null) {
    const path = match[1]
    if (path.startsWith('http')) continue
    const file = app.metadataCache.getFirstLinkpathDest(path, sourcePath)
    if (file instanceof TFile && MEDIA_EXTENSIONS.includes(file.extension.toLowerCase())) {
      return file
    }
  }

  return null
}

/**
 * Generate a JPEG thumbnail from the first frame of a video.
 */
async function generateVideoThumbnail(videoBuffer: ArrayBuffer): Promise<ArrayBuffer | null> {
  try {
    const blob = new Blob([videoBuffer])
    const videoUrl = URL.createObjectURL(blob)

    const video = document.createElement('video')
    video.src = videoUrl
    video.crossOrigin = 'anonymous'

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve
      video.onerror = reject
      video.load()
    })

    video.currentTime = 0.5

    await new Promise((resolve) => {
      video.onseeked = resolve
    })

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      URL.revokeObjectURL(videoUrl)
      return null
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const thumbBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.8)
    })

    URL.revokeObjectURL(videoUrl)

    if (!thumbBlob) return null
    return await thumbBlob.arrayBuffer()
  } catch (error) {
    console.error('Failed to generate video thumbnail:', error)
    return null
  }
}

/**
 * Set a media file as the cover of a note.
 * For videos, generates a thumbnail first.
 */
export async function setCoverFromMedia(mediaFile: TFile, noteFile: TFile): Promise<void> {
  const { app } = GlobalStore.getInstance()

  let coverPath: string

  if (VIDEO_EXTENSIONS.includes(mediaFile.extension.toLowerCase())) {
    const videoBuffer = await app.vault.readBinary(mediaFile)
    const thumbBuffer = await generateVideoThumbnail(videoBuffer)
    if (!thumbBuffer) {
      new Notice('Failed to generate video thumbnail')
      return
    }

    const folder = await getAttachmentFolder()
    const baseName = mediaFile.basename + '-cover'
    const basePath = folder ? `${folder}/${baseName}.jpg` : `${baseName}.jpg`

    let targetPath = basePath
    let counter = 1
    while (app.vault.getAbstractFileByPath(targetPath)) {
      targetPath = folder ? `${folder}/${baseName} ${counter}.jpg` : `${baseName} ${counter}.jpg`
      counter++
    }

    await app.vault.createBinary(targetPath, thumbBuffer)
    coverPath = targetPath
  } else {
    coverPath = mediaFile.path
  }

  await app.fileManager.processFrontMatter(noteFile, (frontmatter) => {
    frontmatter.cover = coverPath
  })

  new Notice('Cover set')
}

/**
 * Command: set cover from the first image/video in the current note.
 */
export async function setCoverFromFirstMedia(): Promise<void> {
  const { app } = GlobalStore.getInstance()
  const noteFile = app.workspace.getActiveFile()
  if (!noteFile) {
    new Notice('No active file')
    return
  }

  const content = await app.vault.cachedRead(noteFile)
  const mediaFile = findFirstMedia(content, noteFile.path)

  if (!mediaFile) {
    new Notice('No image or video found in note')
    return
  }

  await setCoverFromMedia(mediaFile, noteFile)
}
