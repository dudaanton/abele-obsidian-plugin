/**
 * What the canvas's "more" menus do outside the canvas itself: a picture of the picked part saved
 * with the vault's attachments, an embed of it copied, the part attached to the chat or asked
 * about there, a card's words made into a note of their own, and a note taken to the trash.
 * Changes to the canvas stay with the editor; these only make, copy and ask.
 */
import { FuzzySuggestModal, Notice, type App, type TFile } from 'obsidian'
import { ChatService } from '@/ai/ChatService'
import { grantNote } from '@/commands/chatAboutNote'
import { attachDrawingToChat } from '@/drawing/askAgent'
import { confirmAction } from '@/modal/confirm'
import { canvasPicture } from './pictureAdapter'
import { canvasEmbed } from './embedFormat'
import type { CanvasGraph, Rect } from './core/model'

/** Room left round a picked part, so a picture or an embed of it does not cut its edges. */
export const PART_MARGIN = 24

export function partRegion(rect: Rect, margin = PART_MARGIN): Rect {
  return {
    x: Math.floor(rect.x - margin),
    y: Math.floor(rect.y - margin),
    width: Math.ceil(rect.width + margin * 2),
    height: Math.ceil(rect.height + margin * 2),
  }
}

/** What goes into the chat's input when a part of a canvas, or all of it, is asked about. */
export function canvasQuestion(
  link: string,
  region: Rect | null,
  ids: string[],
  kind: 'ask' | 'transcribe'
): string {
  const where = region
    ? `the part of ${link} at region ${[region.x, region.y, region.width, region.height].join(' ')}` +
      (ids.length ? ` (picked: ${ids.join(', ')})` : '')
    : link
  return kind === 'transcribe'
    ? `Transcribe the handwriting in ${where} as text, keeping its lines and lists.`
    : `Look at ${where}: `
}

/** A file name a card's words can be a note under: its first line, without what names forbid. */
export function noteName(text: string): string {
  const line =
    text
      .split('\n')
      .map((l) => l.replace(/^#+\s*/, '').trim())
      .find(Boolean) ?? ''
  const name = line
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim()
  return name || 'Untitled'
}

/** A PNG of a part of the canvas, or of all of it, ink and far cards included. */
async function partPng(
  app: App,
  file: TFile,
  graph: CanvasGraph,
  region: Rect | undefined
): Promise<Blob> {
  const picture = await canvasPicture(app, graph, file.path, { region, maxSide: 2048 }, () => true)
  return new Promise<Blob>((resolve, reject) =>
    picture.canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('PNG unavailable'))),
      'image/png'
    )
  )
}

export interface CanvasHostActions {
  /** A PNG of a part, saved with the canvas's attachments. */
  exportPart(region: Rect, name: string): Promise<TFile | null>
  /** The embed of a card or frame by its id, or of a part, on the clipboard. */
  copyEmbed(target: { node?: string; region?: Rect }): Promise<boolean>
  /** A PNG of a part, or of the whole canvas, attached to what is being written in the chat. */
  attach(region: Rect | null): Promise<TFile | null>
  /** A new chat that may see the canvas, with a question about a part, or all of it, begun. */
  ask(region: Rect | null, ids: string[], kind: 'ask' | 'transcribe'): Promise<boolean>
  /** A note made from a card's words, beside where new notes go; its path. */
  makeNote(text: string): Promise<string | null>
  /** Asks, then takes a note to the trash; whether it went. */
  trashNote(path: string): Promise<boolean>
  /** Asks for a line of words, as a connection's label. */
  askText(title: string, value: string): Promise<string | null>
  /**
   * Which part of a note a card shows: '' for all of it, `#Heading` or `#^block`; null when
   * nothing was chosen.
   */
  pickPart(path: string): Promise<string | null>
}

/** The parts of a note a card can show, by its headings and named blocks, all of it first. */
export function noteParts(
  headings: { heading: string; level: number }[],
  blocks: string[]
): { title: string; subpath: string }[] {
  return [
    { title: 'The whole note', subpath: '' },
    ...headings.map((h) => ({
      title: `${'  '.repeat(Math.max(0, h.level - 1))}${h.heading}`,
      subpath: `#${h.heading}`,
    })),
    ...blocks.map((id) => ({ title: `Block ^${id}`, subpath: `#^${id}` })),
  ]
}

class NotePartModal extends FuzzySuggestModal<{ title: string; subpath: string }> {
  chosen: string | null = null
  constructor(
    app: App,
    private readonly parts: { title: string; subpath: string }[],
    private readonly done: (subpath: string | null) => void
  ) {
    super(app)
    this.setPlaceholder('Which part of the note the card shows')
  }
  getItems() {
    return this.parts
  }
  getItemText(part: { title: string; subpath: string }): string {
    return part.title
  }
  onChooseItem(part: { title: string; subpath: string }): void {
    this.chosen = part.subpath
  }
  onClose(): void {
    super.onClose()
    // Choosing closes the list first; the choice is read once it has been made.
    window.setTimeout(() => this.done(this.chosen), 0)
  }
}

type Chats = Pick<ChatService, 'openBlankChat' | 'pendingInput' | 'revealSidebar'>

export function canvasHostActions(
  app: App,
  file: () => TFile | null,
  graph: () => CanvasGraph,
  ask: (title: string, value: string) => Promise<string | null>,
  chats: () => Chats = () => ChatService.getInstance(),
  confirm: typeof confirmAction = confirmAction
): CanvasHostActions {
  return {
    async exportPart(region, name) {
      const canvas = file()
      if (!canvas) return null
      try {
        const blob = await partPng(app, canvas, graph(), region)
        const path = await app.fileManager.getAvailablePathForAttachment(
          `${canvas.basename} ${name}.png`,
          canvas.path
        )
        const made = await app.vault.createBinary(path, await blob.arrayBuffer())
        new Notice(`Saved as ${made.path}`)
        return made
      } catch (error) {
        new Notice(`The picture could not be saved: ${String(error)}`)
        return null
      }
    },
    async copyEmbed(target) {
      const canvas = file()
      if (!canvas) return false
      try {
        await navigator.clipboard.writeText(canvasEmbed(canvas.path, target))
        new Notice('Embed copied; paste it into a note')
        return true
      } catch (error) {
        new Notice(`The embed could not be copied: ${String(error)}`)
        return false
      }
    },
    async attach(region) {
      const canvas = file()
      if (!canvas) return null
      const shown = graph()
      return attachDrawingToChat(
        app,
        canvas,
        !!region,
        () => partPng(app, canvas, shown, region ?? undefined),
        chats()
      )
    },
    async ask(region, ids, kind) {
      const canvas = file()
      if (!canvas) return false
      try {
        const chat = chats()
        const session = await chat.openBlankChat()
        if (!session) return false
        grantNote(session.scopeResolver, canvas.path)
        chat.pendingInput.value = {
          text: canvasQuestion(`[[${canvas.path}]]`, region, ids, kind),
          tabId: session.id,
          focus: true,
        }
        await chat.revealSidebar()
        return true
      } catch (error) {
        console.error('[Abele] Asking about a canvas failed:', error)
        new Notice(`Could not open a chat: ${String(error)}`)
        return false
      }
    },
    async makeNote(text) {
      const canvas = file()
      if (!canvas) return null
      try {
        const parent = app.fileManager.getNewFileParent(canvas.path)
        const folder = parent.path === '/' ? '' : `${parent.path}/`
        const name = noteName(text)
        let path = `${folder}${name}.md`
        for (let n = 2; app.vault.getAbstractFileByPath(path); n++)
          path = `${folder}${name} ${n}.md`
        const made = await app.vault.create(path, text.endsWith('\n') ? text : `${text}\n`)
        return made.path
      } catch (error) {
        new Notice(`The note could not be made: ${String(error)}`)
        return null
      }
    },
    async trashNote(path) {
      const note = app.vault.getFileByPath(path)
      if (!note) {
        new Notice(`${path} is no longer in the vault`)
        return false
      }
      const sure = await confirm(app, {
        title: 'Delete the note',
        message: `${note.basename} goes to the trash and leaves the canvas. Undo brings back the card on the canvas, not the note: restore it from the trash.`,
        confirmTooltip: 'Move the note to the trash',
      })
      if (!sure) return false
      await app.fileManager.trashFile(note)
      return true
    },
    askText: ask,
    pickPart(path) {
      const note = app.vault.getFileByPath(path)
      if (!note) return Promise.resolve(null)
      const cache = app.metadataCache.getFileCache(note)
      const parts = noteParts(cache?.headings ?? [], Object.keys(cache?.blocks ?? {}))
      return new Promise((resolve) => new NotePartModal(app, parts, resolve).open())
    },
  }
}
