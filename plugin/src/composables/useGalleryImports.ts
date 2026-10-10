import { ref, type Ref } from 'vue'
import { Notice } from 'obsidian'
import type { Gallery } from '@/entities/Gallery'
import { GlobalStore } from '@/stores/GlobalStore'
import { createImportedBinary } from '@/media/importImageFile'
import { ensureAttachmentFolder } from '@/media/attachmentFolder'
import { pickImageFile } from '@/helpers/suggesters/ImagePicker'
import { isMediaPath } from '@/helpers/galleryUtils'

export function useGalleryImports(
  props: { gallery: Gallery },
  fileInputRef: Ref<HTMLInputElement | null>
) {
  const draggingFiles = ref(false)
  let dragDepth = 0

  async function addFromVault() {
    const { app } = GlobalStore.getInstance()
    const file = await pickImageFile(app)
    if (file) {
      props.gallery.addImage(file.path)
    }
  }

  function addFromDisk() {
    fileInputRef.value?.click()
  }

  async function addFromClipboard() {
    try {
      const items = await navigator.clipboard.read()
      const { app } = GlobalStore.getInstance()
      const attachmentFolder = await ensureAttachmentFolder(app, props.gallery.filePath)

      const paths: string[] = []
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'))
        if (!imageType) continue

        const blob = await item.getType(imageType)
        const buffer = await blob.arrayBuffer()
        const ext = imageType.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg')
        const timestamp = Date.now()
        const baseName = `clipboard-${timestamp}`
        const basePath = attachmentFolder
          ? `${attachmentFolder}/${baseName}.${ext}`
          : `${baseName}.${ext}`

        let finalPath = basePath
        let counter = 1
        while (await app.vault.adapter.exists(finalPath)) {
          finalPath = attachmentFolder
            ? `${attachmentFolder}/${baseName} ${counter}.${ext}`
            : `${baseName} ${counter}.${ext}`
          counter++
        }

        const created = await createImportedBinary(
          app,
          finalPath,
          new Blob([buffer], { type: imageType })
        )
        paths.push(created.path)
      }

      if (paths.length > 0) {
        props.gallery.addImages(paths)
        new Notice(`Added ${paths.length} image${paths.length > 1 ? 's' : ''} from clipboard`)
      } else {
        new Notice('No images found in clipboard')
      }
    } catch {
      new Notice('Could not read clipboard')
    }
  }

  function carriesSystemFiles(event: DragEvent): boolean {
    const transfer = event.dataTransfer
    return !!transfer && (Array.from(transfer.types).includes('Files') || transfer.files.length > 0)
  }

  function onDragEnter(event: DragEvent) {
    if (props.gallery.readonly || !carriesSystemFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepth++
    draggingFiles.value = true
  }

  function onDragOver(event: DragEvent) {
    if (props.gallery.readonly || !carriesSystemFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  function onDragLeave(event: DragEvent) {
    if (props.gallery.readonly || !draggingFiles.value) return
    event.preventDefault()
    event.stopPropagation()
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) draggingFiles.value = false
  }

  async function onDrop(event: DragEvent) {
    if (props.gallery.readonly || !carriesSystemFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepth = 0
    draggingFiles.value = false
    await addExternalFiles(Array.from(event.dataTransfer?.files ?? []))
  }

  async function onFilesSelected(e: Event) {
    const input = e.target as HTMLInputElement
    const files = Array.from(input.files ?? [])
    if (files.length > 0) await addExternalFiles(files)
    input.value = ''
  }

  async function addExternalFiles(files: File[]) {
    const media = files.filter((file) => isMediaPath(file.name))
    const skipped = files.length - media.length
    if (media.length === 0) {
      if (skipped > 0) new Notice('Abele gallery accepts images and videos')
      return
    }

    const { app } = GlobalStore.getInstance()
    const attachmentFolder = await ensureAttachmentFolder(app, props.gallery.filePath)

    const paths: string[] = []
    for (const file of media) {
      const buffer = await file.arrayBuffer()
      const basePath = attachmentFolder ? `${attachmentFolder}/${file.name}` : file.name
      let finalPath = basePath
      let counter = 1
      while (await app.vault.adapter.exists(finalPath)) {
        const dot = file.name.lastIndexOf('.')
        const base = dot > 0 ? file.name.slice(0, dot) : file.name
        const ext = dot > 0 ? file.name.slice(dot) : ''
        finalPath = attachmentFolder
          ? `${attachmentFolder}/${base} ${counter}${ext}`
          : `${base} ${counter}${ext}`
        counter++
      }
      const created = await createImportedBinary(
        app,
        finalPath,
        new Blob([buffer], { type: file.type })
      )
      paths.push(created.path)
    }

    props.gallery.addImages(paths)
    const noun = paths.length === 1 ? 'file' : 'files'
    const skippedText = skipped > 0 ? `; skipped ${skipped} unsupported` : ''
    new Notice(`Added ${paths.length} ${noun} to gallery${skippedText}`)
  }

  return {
    draggingFiles,
    addFromVault,
    addFromDisk,
    addFromClipboard,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onFilesSelected,
  }
}
