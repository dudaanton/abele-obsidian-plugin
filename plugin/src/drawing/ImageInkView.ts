/**
 * Drawing on a picture, in a tab of its own: the picture under the ink, the same bar and tools as
 * a drawing, and, in the bar's menu, what becomes of it — saved over the picture, saved beside it
 * as a new one, or sent back to the chat it came from as an attachment.
 *
 * The picture itself is not touched until one of those is chosen. The ink lives in the tab; a
 * tab closed without saving keeps nothing.
 */
import {
  type App,
  ItemView,
  Menu,
  Notice,
  Platform,
  Scope,
  TFile,
  type ViewStateResult,
  type WorkspaceLeaf,
} from 'obsidian'
import { reactive, watch } from 'vue'
import { confirmDialog } from '@/components/obsidian/dialogs'
import { ChatService } from '@/ai/ChatService'
import { DrawingSession } from './DrawingSession'
import { drawingKeys, shapeMenu, thicknessMenu, zoomMenu } from './drawingTab'
import { mountKit } from '@/components/obsidian/mount'
import PictureSession from '@/components/drawing/PictureSession.vue'
import { cropChanged, croppedSize, wholePicture } from './crop'
import { PictureHistory, type PictureSessionState } from './pictureSession'
import type { KitMount } from '@/components/obsidian/mount'
import { drawnPath, flatten, formatOf } from './imageInk'
import { emptyDrawingModel, type DrawingModel } from './model'
import { keptDrawingThickness } from './penThickness'
import { DRAWABLE_PICTURES, IMAGE_INK_VIEW_TYPE } from './viewType'
import { vaultUrl } from '@/helpers/vaultUrl'
import { relink, replaceEmbed, type EmbedAnchor } from './embedRelink'

export { IMAGE_INK_VIEW_TYPE }

export { DRAWABLE_PICTURES }

export class ImageInkView extends ItemView {
  readonly model: DrawingModel = reactive({
    ...emptyDrawingModel(),
    thickness: keptDrawingThickness(),
  })
  session: DrawingSession | null = null
  private vue: KitMount | null = null
  private path = ''
  /** The chat the picture came from, to send it back to; empty when it came from the vault. */
  private chat = ''
  private chatVersion: number | null = null
  private replaceAttachment = ''
  /** The embed in a note the picture was opened from; null when it came from anywhere else. */
  private embed: EmbedAnchor | null = null
  private image: HTMLImageElement | ImageBitmap | null = null
  private preview: ImageBitmap | null = null
  private loadVersion = 0
  private readonly history = new PictureHistory()
  readonly editor: PictureSessionState = reactive({
    crop: wholePicture(),
    cropping: false,
    dirty: false,
    status: null,
    width: 0,
    height: 0,
    camera: { x: 0, y: 0, zoom: 1 },
  })

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.scope = new Scope(this.app.scope)
    drawingKeys(this.scope, this.model, () => this.session, {
      undo: () => this.restoreEdit(false),
      redo: () => this.restoreEdit(true),
    })
  }

  getViewType(): string {
    return IMAGE_INK_VIEW_TYPE
  }

  getIcon(): string {
    return 'pen-line'
  }

  getDisplayText(): string {
    const name = this.path.slice(this.path.lastIndexOf('/') + 1)
    return name ? `Editing ${name}` : 'Editing a picture'
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty()
    this.contentEl.addClass('abele-drawing-view')
    this.vue = mountKit(
      this.contentEl,
      PictureSession,
      {
        model: this.model,
        state: this.editor,
        actions: {
          ready: (stage: HTMLElement, textParent: HTMLElement) =>
            this.makeSession(stage, textParent),
          cancel: (): void => {
            void this.cancel()
          },
          save: (e: MouseEvent) => this.moreMenu(e),
          shape: (e: MouseEvent) => shapeMenu(e, this.model, this.session),
          thickness: (e: MouseEvent) => thicknessMenu(e, this.model, this.session),
          zoom: (e: MouseEvent) => {
            if (Platform.isPhone) this.fitPicture()
            else zoomMenu(e, this.session, () => this.fitPicture())
          },
          fit: () => this.fitPicture(),
          commit: () => this.checkpoint(),
          undo: () => this.restoreEdit(false),
          redo: () => this.restoreEdit(true),
        },
      },
      { owner: this }
    )
    this.register(
      watch(
        () => this.editor.crop,
        () => {
          this.editor.dirty = cropChanged(this.editor.crop) || !!this.session?.items.items.length
        },
        { deep: true }
      )
    )
  }

  private makeSession(stage: HTMLElement, textParent: HTMLElement): DrawingSession {
    this.session = new DrawingSession(stage, this.model, {
      textParent,
      app: this.app,
      path: () => this.path,
      openNote: () => {},
      changed: () => {
        this.editor.dirty = true
        this.checkpoint()
      },
      stopped: () => {},
      cameraChanged: (camera) => {
        this.editor.camera = { ...camera }
      },
    })
    this.session.setFinger(true)
    return this.session
  }

  private checkpoint(): void {
    this.history.record(this.editor.crop, this.session?.items.items ?? [])
    this.model.canUndo = this.history.canUndo
    this.model.canRedo = this.history.canRedo
  }

  private fitPicture(): void {
    const session = this.session
    if (!session || !this.editor.width) return
    const { width, height, crop } = this.editor
    const sw = crop.turns % 2 ? height : width
    const sh = crop.turns % 2 ? width : height
    const w = session.surface.width
    const h = session.surface.height
    const zoom = Math.max(0.001, Math.min(20, Math.max(1, w - 64) / sw, Math.max(1, h - 64) / sh))
    session.setCamera({ x: width / 2 - w / 2 / zoom, y: height / 2 - h / 2 / zoom, zoom })
  }

  private restoreEdit(redo: boolean): void {
    const state = redo ? this.history.redo() : this.history.undo()
    if (!state || !this.session) return
    this.editor.crop = state.crop
    this.session.load([...state.items])
    this.editor.dirty = true
    this.model.canUndo = this.history.canUndo
    this.model.canRedo = this.history.canRedo
  }

  async cancel(): Promise<boolean> {
    if (this.editor.status?.kind === 'saving') return false
    if (
      this.editor.dirty &&
      !(await confirmDialog({
        title: 'Discard picture edits?',
        message: 'The unsaved edits will be lost. The picture stays as it was.',
        confirmText: 'Discard edits',
        confirmTooltip: 'Close without saving',
      }))
    )
      return false
    this.leaf.detach()
    return true
  }

  async onClose(): Promise<void> {
    this.loadVersion++
    this.vue?.unmount()
    this.vue = null
    this.session?.destroy()
    this.session = null
    if (this.image && 'close' in this.image) this.image.close()
    this.image = null
    this.preview?.close()
    this.preview = null
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = (state ?? {}) as {
      path?: unknown
      chat?: unknown
      embed?: unknown
      replaceAttachment?: unknown
      chatVersion?: unknown
      crop?: unknown
    }
    const path = typeof s.path === 'string' ? s.path : ''
    this.chat = typeof s.chat === 'string' ? s.chat : ''
    this.chatVersion = typeof s.chatVersion === 'number' ? s.chatVersion : null
    this.replaceAttachment = typeof s.replaceAttachment === 'string' ? s.replaceAttachment : ''
    this.embed = anchorOf(s.embed)
    this.editor.cropping = s.crop === true
    if (path && path !== this.path) {
      this.path = path
      await this.loadPicture()
    }
    await super.setState(state, result)
  }

  getState(): Record<string, unknown> {
    return {
      path: this.path,
      chat: this.chat,
      chatVersion: this.chatVersion,
      embed: this.embed,
      replaceAttachment: this.replaceAttachment,
      crop: this.editor.cropping,
    }
  }

  /** The picture, under an empty sheet of ink, ready to draw on. */
  private async loadPicture(): Promise<void> {
    const version = ++this.loadVersion
    const file = this.app.vault.getAbstractFileByPath(this.path)
    const session = this.session
    if (!(file instanceof TFile) || !session) return
    let image: HTMLImageElement | ImageBitmap
    try {
      if (typeof createImageBitmap === 'function') {
        try {
          image = await createImageBitmap(new Blob([await this.app.vault.readBinary(file)]))
        } catch {
          image = new Image()
          image.src = vaultUrl(this.app, file)
          await image.decode()
        }
      } else {
        image = new Image()
        image.src = vaultUrl(this.app, file)
        await image.decode()
      }
    } catch {
      if (version !== this.loadVersion) return
      new Notice(`The picture could not be read: ${file.path}`)
      this.editor.status = {
        kind: 'error',
        text: 'The picture could not be decoded on this device. The file is unchanged.',
      }
      return
    }
    const width = 'naturalWidth' in image ? image.naturalWidth : image.width
    const height = 'naturalHeight' in image ? image.naturalHeight : image.height
    let preview: ImageBitmap | null = null
    if (typeof createImageBitmap === 'function' && Math.max(width, height) > 2048) {
      const scale = 2048 / Math.max(width, height)
      try {
        preview = await createImageBitmap(image, {
          resizeWidth: Math.max(1, Math.round(width * scale)),
          resizeHeight: Math.max(1, Math.round(height * scale)),
          resizeQuality: 'high',
        })
      } catch (error) {
        console.debug('[Abele] picture preview uses the source image', error)
      }
    }
    if (version !== this.loadVersion || this.session !== session) {
      if ('close' in image) image.close()
      preview?.close()
      return
    }
    if (this.image && 'close' in this.image) this.image.close()
    this.preview?.close()
    this.image = image
    this.preview = preview
    this.editor.width = width
    this.editor.height = height
    this.editor.status = null
    this.editor.crop = wholePicture()
    this.editor.dirty = false
    session.load([])
    this.history.reset(this.editor.crop, [])
    // A tab just made has no size yet: the picture is fitted once it has one.
    session.whenSized(() => {
      if (version !== this.loadVersion || this.session !== session) return
      session.setBackdrop({
        image: this.preview ?? image,
        rect: { x: 0, y: 0, w: width, h: height },
      })
      this.fitPicture()
      if (this.editor.cropping) session.stop()
      else session.start()
    })
    ;(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.()
  }

  // ————— What becomes of it —————

  private moreMenu(e: MouseEvent): void {
    const menu = new Menu()
    const file = this.app.vault.getAbstractFileByPath(this.path)
    if (file instanceof TFile) {
      const format = formatOf(file.extension)
      const kind = format.mime === 'image/jpeg' ? 'JPEG' : 'PNG'
      menu.addItem((item) =>
        item
          .setTitle(
            format.sameKind
              ? 'Save over the picture'
              : `Save over the picture (${file.extension.toUpperCase()} needs a ${kind} copy)`
          )
          .setDisabled(!formatOf(file.extension).sameKind)
          .setIcon('save')
          .onClick(() => void this.saving(() => this.saveOver(file)))
      )
      menu.addItem((item) =>
        item
          .setTitle(format.sameKind ? 'Save as a new picture' : `Save as a new ${kind} picture`)
          .setIcon('image-plus')
          .onClick(() => void this.saving(() => this.saveNew(file)))
      )
      if (this.embed)
        menu.addItem((item) =>
          item
            .setTitle('Save as a new picture and replace it in the note')
            .setIcon('replace')
            .onClick(() => void this.saving(() => this.saveInNote(file)))
        )
      menu.addItem((item) =>
        item
          .setTitle(
            `${this.chat ? 'Send back to the chat' : 'Send to the chat'} (${this.outputSize()})`
          )
          .setIcon('send')
          .onClick(() => void this.saving(() => this.sendToChat(file)))
      )
    }
    menu.showAtMouseEvent(e)
  }

  private outputSize(): string {
    const size = croppedSize(this.editor.crop, this.editor.width, this.editor.height)
    return `${size.width} × ${size.height}`
  }

  private async saving(action: () => Promise<unknown>): Promise<void> {
    if (!this.editor.width || !this.editor.height) return
    if (this.editor.status?.kind === 'saving') return
    const mp = Math.round((this.editor.width * this.editor.height) / 1e6)
    const crop = JSON.stringify(this.editor.crop)
    const ink = [...(this.session?.items.items ?? [])]
    this.editor.status = { kind: 'saving', text: `Saving ${mp || '<1'} MP…` }
    try {
      await new Promise<void>((resolve) => this.contentEl.win.setTimeout(resolve, 32))
      const saved = await action()
      if (saved) {
        const current = this.session?.items.items ?? []
        this.editor.dirty =
          JSON.stringify(this.editor.crop) !== crop ||
          current.length !== ink.length ||
          current.some((item, i) => item !== ink[i])
      }
      this.editor.status = null
    } catch (error) {
      console.warn('[Abele] picture save failed', error)
      this.editor.status = { kind: 'error', text: `Could not save the picture: ${String(error)}` }
    }
  }

  private async picture(file: TFile): Promise<Blob | null> {
    const session = this.session
    const image = this.image
    if (!session || !image) return null
    session.pick.closeText()
    return flatten(
      this.contentEl.ownerDocument,
      image,
      this.editor.width,
      this.editor.height,
      session.items.items,
      formatOf(file.extension),
      this.editor.crop
    )
  }

  /** The picture, drawn on, in the original's place — asked about first. */
  async saveOver(file: TFile, asked = false): Promise<boolean> {
    if (!formatOf(file.extension).sameKind) return false
    if (!asked && !(await confirmOver(this.app, file.name))) return false
    const blob = await this.picture(file)
    if (!blob) return false
    await this.app.vault.modifyBinary(file, await blob.arrayBuffer())
    new Notice(`Saved over ${file.name}`)
    return true
  }

  /** The picture, drawn on, beside the original as a new one; says which. */
  async saveNew(file: TFile, notice = true): Promise<TFile | null> {
    const blob = await this.picture(file)
    if (!blob) return null
    const format = formatOf(file.extension)
    const dir = file.parent && file.parent.path !== '/' ? `${file.parent.path}/` : ''
    const path = drawnPath(
      dir,
      file.basename,
      format.ext,
      (p) => !!this.app.vault.getAbstractFileByPath(p)
    )
    const made = await this.app.vault.createBinary(path, await blob.arrayBuffer())
    if (notice) new Notice(`Saved as ${made.path}`)
    return made
  }

  /**
   * A new picture beside the original, put in the original's place in the note the picture was
   * opened from — that one embed, written as it was. The original stays. A note changed so that
   * the embed cannot be found for certain keeps it, and says so.
   */
  async saveInNote(file: TFile): Promise<boolean> {
    const embed = this.embed
    const note = embed && this.app.vault.getAbstractFileByPath(embed.note)
    if (!embed || !(note instanceof TFile)) return false
    const made = await this.saveNew(file, false)
    if (!made) return false
    const link = relink(embed.original, this.app.fileManager.generateMarkdownLink(made, note.path))
    let start = -1
    await this.app.vault.process(note, (text) => {
      const r = replaceEmbed(text, embed, link)
      start = r.at
      return r.text
    })
    if (start < 0) {
      new Notice(
        `Saved as ${made.path}. The picture in ${note.basename} was not replaced: the note has changed`
      )
      return false
    }
    // Saved again, the embed now showing the new picture is the one replaced.
    this.embed = { note: embed.note, start, original: link }
    new Notice(`Saved as ${made.path} and put in its place in ${note.basename}`)
    return true
  }

  /** A new picture, attached to what is being written in the chat it came from. */
  async sendToChat(file: TFile): Promise<boolean> {
    const chats = ChatService.getInstance()
    const tabId = this.chat || chats.activeTabId.value || undefined
    const origin = tabId ? chats.getSession(tabId) : undefined
    const version = this.chat ? this.chatVersion : origin?.conversationVersion.value
    const owns = () =>
      !tabId ||
      (!!origin &&
        !origin.isDestroyed &&
        chats.getSession(tabId) === origin &&
        origin.conversationVersion.value === version)
    if (!owns()) {
      new Notice(
        'The original conversation changed. Save the picture and attach it to the intended chat.'
      )
      return false
    }
    const made = await this.saveNew(file, false)
    if (!made) return false
    if (!owns()) {
      new Notice(
        `Saved as ${made.path}. The conversation changed; attach the picture to the intended chat.`
      )
      return false
    }
    if (tabId) chats.switchTab(tabId)
    chats.pendingInput.value = {
      text: '',
      tabId,
      attachments: [made.path],
      focus: true,
      replaceAttachment: this.replaceAttachment || undefined,
      conversationVersion: typeof version === 'number' ? version : undefined,
    }
    this.replaceAttachment = made.path
    await chats.revealSidebar()
    return true
  }
}

/** An embed anchor from a tab's saved state, when it is one. */
function anchorOf(value: unknown): EmbedAnchor | null {
  const v = value as Partial<EmbedAnchor> | null | undefined
  return v &&
    typeof v.note === 'string' &&
    typeof v.start === 'number' &&
    typeof v.original === 'string'
    ? { note: v.note, start: v.start, original: v.original }
    : null
}

/** Asks before a picture is written over. */
function confirmOver(app: App, name: string): Promise<boolean> {
  return confirmDialog({
    title: 'Save over the picture?',
    message: `${name} is replaced by the picture with the drawing on it. The picture as it is now is lost.`,
    confirmText: 'Save over it',
    confirmTooltip: 'Replace the picture with the one drawn on',
  })
}
