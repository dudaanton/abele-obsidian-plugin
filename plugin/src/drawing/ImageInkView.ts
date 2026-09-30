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
  Scope,
  TFile,
  type ViewStateResult,
  type WorkspaceLeaf,
} from 'obsidian'
import { createApp, reactive, type App as VueApp } from 'vue'
import { confirmAction } from '@/modal/confirm'
import { ChatService } from '@/ai/ChatService'
import { DrawingSession } from './DrawingSession'
import { drawingKeys, mountDrawingBar } from './drawingTab'
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
  private vue: VueApp | null = null
  private path = ''
  /** The chat the picture came from, to send it back to; empty when it came from the vault. */
  private chat = ''
  private replaceAttachment = ''
  /** The embed in a note the picture was opened from; null when it came from anywhere else. */
  private embed: EmbedAnchor | null = null
  private image: HTMLImageElement | null = null

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.scope = new Scope(this.app.scope)
    drawingKeys(this.scope, this.model, () => this.session)
  }

  getViewType(): string {
    return IMAGE_INK_VIEW_TYPE
  }

  getIcon(): string {
    return 'pen-line'
  }

  getDisplayText(): string {
    const name = this.path.slice(this.path.lastIndexOf('/') + 1)
    return name ? `Drawing on ${name}` : 'Drawing on a picture'
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty()
    this.contentEl.addClass('abele-drawing-view')
    const bar = this.contentEl.createDiv({ cls: 'abele-drawing-view__bar' })
    const stage = this.contentEl.createDiv({ cls: 'abele-drawing-view__stage' })
    this.session = new DrawingSession(stage, this.model, {
      app: this.app,
      path: () => this.path,
      openNote: () => {},
      changed: () => {},
      stopped: () => {},
    })
    this.vue = mountDrawingBar(
      bar,
      this.model,
      () => this.session,
      (e) => this.moreMenu(e)
    )
  }

  async onClose(): Promise<void> {
    this.vue?.unmount()
    this.vue = null
    this.session?.destroy()
    this.session = null
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = (state ?? {}) as { path?: unknown; chat?: unknown; embed?: unknown; replaceAttachment?: unknown }
    const path = typeof s.path === 'string' ? s.path : ''
    this.chat = typeof s.chat === 'string' ? s.chat : ''
    this.replaceAttachment = typeof s.replaceAttachment === 'string' ? s.replaceAttachment : ''
    this.embed = anchorOf(s.embed)
    if (path && path !== this.path) {
      this.path = path
      await this.loadPicture()
    }
    await super.setState(state, result)
  }

  getState(): Record<string, unknown> {
    return { path: this.path, chat: this.chat, embed: this.embed, replaceAttachment: this.replaceAttachment }
  }

  /** The picture, under an empty sheet of ink, ready to draw on. */
  private async loadPicture(): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.path)
    const session = this.session
    if (!(file instanceof TFile) || !session) return
    const image = new Image()
    image.src = vaultUrl(this.app, file)
    try {
      await image.decode()
    } catch {
      new Notice(`The picture could not be read: ${file.path}`)
      return
    }
    this.image = image
    session.load([])
    // A tab just made has no size yet: the picture is fitted once it has one.
    session.whenSized(() => {
      session.setBackdrop({
        image,
        rect: { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight },
      })
      session.start()
    })
    ;(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.()
  }

  // ————— What becomes of it —————

  private moreMenu(e: MouseEvent): void {
    const menu = new Menu()
    const file = this.app.vault.getAbstractFileByPath(this.path)
    if (file instanceof TFile) {
      if (formatOf(file.extension).sameKind)
        menu.addItem((item) =>
          item
            .setTitle('Save over the picture')
            .setIcon('save')
            .onClick(() => void this.saveOver(file))
        )
      menu.addItem((item) =>
        item
          .setTitle('Save as a new picture')
          .setIcon('image-plus')
          .onClick(() => void this.saveNew(file))
      )
      if (this.embed)
        menu.addItem((item) =>
          item
            .setTitle('Save as a new picture and replace it in the note')
            .setIcon('replace')
            .onClick(() => void this.saveInNote(file))
        )
      menu.addItem((item) =>
        item
          .setTitle(this.chat ? 'Send back to the chat' : 'Send to the chat')
          .setIcon('send')
          .onClick(() => void this.sendToChat(file))
      )
    }
    menu.showAtMouseEvent(e)
  }

  private async picture(file: TFile): Promise<Blob | null> {
    const session = this.session
    const image = this.image
    if (!session || !image) return null
    session.pick.closeText()
    return flatten(
      this.contentEl.ownerDocument,
      image,
      image.naturalWidth,
      image.naturalHeight,
      session.items.items,
      formatOf(file.extension)
    )
  }

  /** The picture, drawn on, in the original's place — asked about first. */
  async saveOver(file: TFile, asked = false): Promise<boolean> {
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
    const made = await this.saveNew(file, false)
    if (!made) return false
    const chats = ChatService.getInstance()
    const tabId = this.chat && chats.getSession(this.chat) ? this.chat : undefined
    if (tabId) chats.switchTab(tabId)
    chats.pendingInput.value = {
      text: '', tabId, attachments: [made.path], focus: true,
      replaceAttachment: this.replaceAttachment || undefined,
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
  return confirmAction(app, {
    title: 'Save over the picture?',
    message: `${name} is replaced by the picture with the drawing on it. The picture as it is now is lost.`,
    confirmText: 'Save over it',
    confirmTooltip: 'Replace the picture with the one drawn on',
  })
}
