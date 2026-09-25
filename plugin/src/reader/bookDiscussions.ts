/**
 * Discussions in a book: a chat with the AI about words on its page, kept with those words, as a
 * comment chat is kept with its passage in a note.
 *
 * "Ask here" on selected words (or on a highlight) starts one — a comment, in the comments folder,
 * anchored to the book and the words' place (`anchor.cfi`) — and lists it in the book's highlights
 * note, the words marked in the book with a speech bubble. A tap on the marked words opens that
 * chat again, after a restart or on another device too; asking again about the same words reuses
 * it. Nothing is ever written into the book.
 */
import { App, Modal, Notice, type TFile } from 'obsidian'
import { CommentService } from '@/ai/CommentService'
import type { CommentAnchor } from '@/ai/types'
import { GlobalStore } from '@/stores/GlobalStore'
import { linkToPlace } from './bookLinks'
import { loadBookText, offsetOf, sectionText } from './bookText'
import type { Highlight } from './highlights'

/** How much of the book around the words the agent is shown, either side, in characters. */
const AROUND = 1500

/** Opens the discussion `id`; false when its chat is gone. */
export async function openDiscussion(id: string): Promise<boolean> {
  try {
    return await CommentService.getInstance().reveal(id)
  } catch (e) {
    console.warn('[Abele] a discussion could not be opened', id, e)
    return false
  }
}

/** Starts a discussion on words of `book`; the id of its chat, or null. */
export async function startDiscussion(
  book: TFile,
  cfi: string,
  quote: string
): Promise<string | null> {
  try {
    return await CommentService.getInstance().createOnBook(book, cfi, quote)
  } catch (e) {
    console.error('[Abele] a discussion could not be started', e)
    new Notice(`Could not start a discussion: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/** Where a discussion's chat file is. */
export const discussionPath = (id: string): string => CommentService.getInstance().commentPath(id)

/**
 * What a discussion's agent is told of where it is, every turn: the book, the place (a link it
 * can pass to `book_read`), the words, and the text around them, read out of the book as it is.
 */
export async function bookDiscussionContext(anchor: CommentAnchor): Promise<string> {
  const { app } = GlobalStore.getInstance()
  const lines = ['## Where you are', `Book: ${anchor.note}`]
  const file = app.vault.getFileByPath(anchor.note)
  if (!file || !anchor.cfi) {
    lines.push('The book is no longer in the vault.')
    if (anchor.quote) lines.push('Selected text:', anchor.quote)
    return lines.join('\n')
  }
  lines.push(`Place: ${linkToPlace(app, file, { cfi: anchor.cfi }, file.basename)}`)
  if (anchor.quote) lines.push('Selected text:', anchor.quote)
  try {
    const around = await textAround(app, file, anchor.cfi)
    if (around) lines.push(`Around it (${around.label || 'this part'}):`, around.text)
  } catch (e) {
    console.debug('[Abele] no text around a discussion', e)
  }
  lines.push(
    'The person selected these words in the book and is asking about them. Read further with book_read on the link above if you can.'
  )
  return lines.join('\n')
}

async function textAround(
  app: App,
  file: TFile,
  cfi: string
): Promise<{ text: string; label: string } | null> {
  const loaded = await loadBookText(app, file)
  const resolve = (loaded.book as { resolveCFI?: (c: string) => unknown }).resolveCFI
  const resolved = resolve?.call(loaded.book, cfi) as
    | { index: number; anchor?: (doc: Document) => Range | Element | null }
    | undefined
  if (!resolved || resolved.index < 0) return null
  const part = await sectionText(loaded, resolved.index)
  const label = loaded.sections[resolved.index]?.label ?? ''
  let at = 0
  const anchor = part.doc ? resolved.anchor?.(part.doc) : null
  if (anchor && part.doc) {
    const range = anchor instanceof Range ? anchor : part.doc.createRange()
    if (!(anchor instanceof Range)) range.selectNode(anchor)
    at = offsetOf(part, range)
  }
  const from = Math.max(0, at - AROUND)
  const to = Math.min(part.text.length, at + AROUND)
  const text = `${from > 0 ? '…' : ''}${part.text.slice(from, to).trim()}${to < part.text.length ? '…' : ''}`
  return { text, label }
}

export type RemoveChoice = 'keep' | 'delete' | null

/**
 * What to do with the chat of a discussion whose mark is being removed: keep it — as an ordinary
 * chat in the history, no longer on the words — or delete it with the mark.
 */
export function askWhatToRemove(h: Highlight): Promise<RemoveChoice> {
  const { app } = GlobalStore.getInstance()
  return new Promise((resolve) => {
    let chosen: RemoveChoice = null
    const modal = new (class extends Modal {
      onOpen(): void {
        this.setTitle('Remove this discussion from the book?')
        this.contentEl.createEl('p', {
          text: `“${h.text.length > 120 ? `${h.text.slice(0, 120)}…` : h.text}”`,
          cls: 'abele-book-discussion-remove__quote',
        })
        this.contentEl.createEl('p', {
          text: 'The words stop being marked. Their chat can stay as an ordinary chat in the history, or go with the mark.',
        })
        const row = this.contentEl.createDiv({ cls: 'modal-button-container' })
        const button = (text: string, choice: RemoveChoice, cls?: string) => {
          const b = row.createEl('button', { text, cls })
          b.addEventListener('click', () => {
            chosen = choice
            this.close()
          })
        }
        button('Keep the chat', 'keep', 'mod-cta')
        button('Delete the chat too', 'delete', 'mod-warning')
        button('Cancel', null)
      }
      onClose(): void {
        resolve(chosen)
      }
    })(app)
    modal.open()
  })
}

/**
 * The chat of a discussion whose mark goes: kept as an ordinary chat — the one "open as chat"
 * makes, in the history, where it can still be found — or deleted.
 */
export async function releaseDiscussion(id: string, choice: 'keep' | 'delete'): Promise<void> {
  const comments = CommentService.getInstance()
  if (choice === 'delete') {
    await comments.remove(id)
    return
  }
  const session = await comments.load(id)
  if (session?.kind === 'comment') {
    const moved = await comments.expand(id)
    if (moved !== 'moved') new Notice('The chat was kept; open it from the history.')
  }
}
