import { Notice, TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { vaultUrl } from '@/helpers/vaultUrl'
import { openComponentDialog, type ComponentDialog } from '@/modal/componentDialog'

const dialogs = {
  findAndReplace: () => import('@/components/FindAndReplaceModal.vue'),
  migrateFromDataview: () => import('@/components/MigrateFromDataviewModal.vue'),
  saveMedia: () => import('@/components/SaveMediaModal.vue'),
  importFiles: () => import('@/components/ImportFilesModal.vue'),
  unusedMedia: () => import('@/components/UnusedMediaModal.vue'),
  deduplicateMedia: () => import('@/components/DeduplicateMediaModal.vue'),
  migrateFromFirefly: () => import('@/components/MigrateFromFireflyModal.vue'),
  migrateDataviewFields: () => import('@/components/MigrateDataviewFieldsModal.vue'),
  migrateFromToggl: () => import('@/components/MigrateFromTogglModal.vue'),
}

/** Repeated commands still share one open dialog; closing releases all of its local state. */
export async function openUtilityDialog(name: keyof typeof dialogs): Promise<void> {
  try {
    await openComponentDialog(async () => (await dialogs[name]()).default, {}, { key: name }).ready
  } catch (error) {
    new Notice(`Could not open dialog: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
let preview: ComponentDialog | null = null

/** The file menu's preview keeps the same folder ordering and selected starting picture. */
export async function previewImage(path: string): Promise<void> {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) return
  const files = file.parent
    ? file.parent.children
        .filter(
          (child): child is TFile =>
            child instanceof TFile && IMAGE_EXTENSIONS.has(child.extension.toLowerCase())
        )
        .sort((a, b) => a.name.localeCompare(b.name))
    : [file]
  const images = files.map((image) => ({
    url: vaultUrl(app, image),
    alt: image.name,
    type: 'local' as const,
    path: image.path,
  }))
  preview?.close()
  const handle = openComponentDialog(
    async () => (await import('@/components/GalleryViewer.vue')).default,
    {
      images,
      startIndex: Math.max(
        0,
        images.findIndex((image) => image.path === path)
      ),
      galleryFilePath: path,
    },
    {
      onClosed: () => {
        if (preview === handle) preview = null
      },
    }
  )
  preview = handle
  try {
    await handle.ready
  } catch (error) {
    new Notice(`Could not open preview: ${error instanceof Error ? error.message : String(error)}`)
  }
}
