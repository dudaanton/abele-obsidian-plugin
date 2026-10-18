import { t } from '@/i18n'
/** Legacy drawing identification and read-only opening; picture-editor entry points. */
import { Notice, TFile, type App, type PaneType } from 'obsidian'
import { isDrawingSvg } from './drawingFile'
import { drawingEmbed } from './embedFormat'
import { DRAWING_VIEW_TYPE, IMAGE_INK_VIEW_TYPE } from './viewType'
import type { DrawingView } from './DrawingView'
import type { Rect } from './items'
import type { EmbedAnchor } from './embedRelink'
import { ChatService } from '@/ai/ChatService'

/** What was found in each SVG, by path, while it has the size and time it had. */
export const known = new Map<string, { mtime: number; size: number; drawing: boolean }>()

/** Whether a vault file is a drawing the plugin made. */
export async function isDrawingFile(app: App, file: TFile): Promise<boolean> {
  if (file.extension !== 'svg') return false
  const seen = known.get(file.path)
  if (seen && seen.mtime === file.stat.mtime && seen.size === file.stat.size) return seen.drawing
  let drawing = false
  try {
    drawing = isDrawingSvg((await app.vault.cachedRead(file)).slice(0, 2000))
  } catch {
    drawing = false
  }
  known.set(file.path, { mtime: file.stat.mtime, size: file.stat.size, drawing })
  return drawing
}

/** Opens a drawing in a tab of its own, or in the one already showing it. */
export async function openDrawing(
  app: App,
  file: TFile,
  state: Record<string, unknown> = {},
  where: PaneType | false = 'tab'
): Promise<void> {
  const open = app.workspace
    .getLeavesOfType(DRAWING_VIEW_TYPE)
    .find((l) => (l.view as DrawingView).file?.path === file.path)
  const leaf = open ?? app.workspace.getLeaf(where)
  await leaf.setViewState({
    type: DRAWING_VIEW_TYPE,
    state: { file: file.path, ...state },
    active: true,
  })
  await app.workspace.revealLeaf(leaf)
}

/** A drawing's embed on the clipboard, the part shown named in it, to paste into a note. */
export async function copyEmbed(embed: string, view?: Rect | null): Promise<void> {
  await navigator.clipboard.writeText(drawingEmbed(embed, view))
  new Notice(t('streamC.8085aa6bd8a9bcdf'))
}

/**
 * Opens a picture to draw on, in a tab of its own; `chat` is the chat it came from, `embed` the
 * embed in a note it was opened from, so the drawing can take the picture's place there.
 */
export async function openImageInk(
  app: App,
  path: string,
  chat = '',
  embed: EmbedAnchor | null = null,
  replaceAttachment = '',
  /** Opened to crop: the frame is in hand from the start rather than the pen. */
  crop = false
): Promise<void> {
  const leaf = app.workspace.getLeaf('tab')
  await leaf.setViewState({
    type: IMAGE_INK_VIEW_TYPE,
    state: {
      path,
      chat,
      embed,
      replaceAttachment,
      crop,
      chatVersion: chat
        ? ChatService.getInstance().getSession(chat)?.conversationVersion.value
        : undefined,
    },
    active: true,
  })
  await app.workspace.revealLeaf(leaf)
}
