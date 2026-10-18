import { computed, ref } from 'vue'
import { Menu, Notice, TFile } from 'obsidian'
import type { ChatMessage } from '@/ai/types'
import { toolImage } from '@/ai/chatArtifacts'
import { isImagePath } from '@/ai/tools/ReadImageTool'
import { normalizeMapBlock, type MapConfig } from '@/helpers/mapConfig'
import { toolSummary as toolSummaryOf } from '@/ai/toolLine'
import { toolFilePaths } from '@/ai/toolFiles'
import { GlobalStore } from '@/stores/GlobalStore'
import { openVaultFile } from '@/ai/openChat'
import { ChatService } from '@/ai/ChatService'
import { openImageInk } from '@/drawing/files'
import { DRAWABLE_PICTURES } from '@/drawing/viewType'
import { vaultUrl } from '@/helpers/vaultUrl'
import type { ViewerImage } from '@/helpers/viewerImage'

interface ChatMessageMediaProps {
  message: ChatMessage
  resourceOpener?: (path: string) => void
}

export function useChatMessageMedia(props: ChatMessageMediaProps) {
  /**
   * The map a map tool drew, ready to render — or nothing, for every other tool.
   *
   * A chat is not as tall as a note, so the map is shorter here. It remains interactive: the
   * answer is often where a person first wants to zoom in or press a nearby building or place.
   */
  const mapConfig = computed<MapConfig | null>(() => {
    const block = props.message.toolMap
    if (!block) return null

    const parsed = normalizeMapBlock({ height: 220, interactive: true, ...block })
    return 'error' in parsed ? null : parsed
  })

  const toolSummary = computed(() => toolSummaryOf(props.message))

  /** Path to open when clicking the tool summary (result path for mv/cp, otherwise path param) */
  const toolFilePath = computed(() => toolFilePaths(props.message)[0] ?? '')

  const imagePath = computed(() =>
    props.resourceOpener ? '' : (toolImage(props.message)?.path ?? '')
  )

  const viewerOpen = ref(false)
  const contentPicture = ref<ViewerImage | null>(null)

  /** Replies may send an image by embed, not just by a tool's result or attachment. */
  function previewContentImage(event: MouseEvent) {
    const target = event.target as HTMLElement
    if (target.tagName !== 'IMG' || !target.closest('.abele-markdown')) return
    const { app } = GlobalStore.getInstance()
    const link = target.closest('.internal-embed')?.getAttribute('src')
    const file = link ? app.metadataCache.getFirstLinkpathDest(link, '') : null
    const url = (target as HTMLImageElement).src
    if (file instanceof TFile && isImagePath(file.path)) {
      contentPicture.value = {
        url: vaultUrl(app, file),
        alt: file.name,
        type: 'local',
        path: file.path,
      }
    } else if (/^https?:\/\//i.test(url)) {
      contentPicture.value = {
        url,
        alt: target.getAttribute('alt') || '',
        type: 'remote',
        path: url,
      }
    } else return
    event.preventDefault()
    event.stopPropagation()
  }

  const viewerImages = computed<ViewerImage[]>(() => {
    if (!imageUrl.value || !imagePath.value) return []
    return [
      {
        url: imageUrl.value,
        alt: imagePath.value.split('/').pop() || '',
        type: 'local' as const,
        path: imagePath.value,
      },
    ]
  })

  const openImagePreview = () => {
    if (viewerImages.value.length) {
      viewerOpen.value = true
    }
  }

  /** A picture of the chat that can be drawn on: a vault picture, not a drawing's SVG. */
  const drawable = (path: string) =>
    DRAWABLE_PICTURES.includes(path.slice(path.lastIndexOf('.') + 1).toLowerCase())

  /** Opens the picture to draw on; sending it back comes to this chat. */
  const drawOn = (path: string): void =>
    void openImageInk(
      GlobalStore.getInstance().app,
      path,
      ChatService.getInstance().activeTabId.value ?? ''
    )

  const onAttachmentContextMenu = (e: MouseEvent, path: string) => {
    if (!drawable(path)) return
    const menu = new Menu()
    menu.addItem((item) =>
      item
        .setTitle('Draw on it')
        .setIcon('pen-line')
        .onClick(() => drawOn(path))
    )
    menu.showAtPosition({ x: e.clientX, y: e.clientY })
  }

  const onImageContextMenu = (e: MouseEvent) => {
    const menu = new Menu()
    if (imagePath.value && drawable(imagePath.value)) {
      const path = imagePath.value
      menu.addItem((item) =>
        item
          .setTitle('Draw on it')
          .setIcon('pen-line')
          .onClick(() => drawOn(path))
      )
    }
    menu.addItem((item) => {
      item
        .setTitle('Preview')
        .setIcon('eye')
        .onClick(() => openImagePreview())
    })
    menu.addItem((item) => {
      item
        .setTitle('Open file')
        .setIcon('file')
        .onClick(() => {
          if (imagePath.value) void openVaultFile(imagePath.value)
        })
    })
    menu.addItem((item) => {
      item
        .setTitle('Copy path')
        .setIcon('link')
        .onClick(() => {
          if (imagePath.value) {
            navigator.clipboard.writeText(imagePath.value)
            new Notice('Path copied')
          }
        })
    })
    menu.showAtPosition({ x: e.clientX, y: e.clientY })
  }

  const imageUrl = computed(() => {
    const path = imagePath.value
    if (!path) return ''
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(path)
    return file instanceof TFile ? vaultUrl(app, file) : ''
  })

  // A chat attached here goes to the sidebar; opened in the editor it would close the note.
  const openAttachment = (path: string): void => void openVaultFile(path)

  return {
    mapConfig,
    toolSummary,
    toolFilePath,
    imagePath,
    imageUrl,
    viewerOpen,
    viewerImages,
    contentPicture,
    previewContentImage,
    openImagePreview,
    onAttachmentContextMenu,
    onImageContextMenu,
    openAttachment,
  }
}
