/**
 * An open book's marks for the notes linking into it: the index of those notes (`linkedNotes.ts`)
 * kept on the page's marks, and a tap on marked words opening the note — at the line the link is
 * on, flashed — or, when several notes link there, a menu of them.
 */
import { MarkdownView, Menu, type App, type TFile } from 'obsidian'
import { flashLines } from '@/lineLinks/open'
import { LinkedNotes, type LinkedNote } from './linkedNotes'
import type { BookReading } from './BookReading'

/** Opens a note linking to the book, at the line the link is on. */
export async function openLinkedNote(app: App, note: LinkedNote): Promise<void> {
  const file = app.vault.getFileByPath(note.path)
  if (!file) return
  const leaf = app.workspace.getLeaf('tab')
  await leaf.openFile(file)
  // Line 0 is the note's properties: the note opens at its top.
  if (note.line > 0 && leaf.view instanceof MarkdownView)
    await flashLines(leaf.view, { from: note.line + 1, to: note.line + 1 })
}

/** The note linking to the words tapped, opened; several are offered in a menu. */
export function openLinkedNotes(app: App, notes: LinkedNote[], at: { x: number; y: number }): void {
  if (!notes.length) return
  if (notes.length === 1) {
    void openLinkedNote(app, notes[0])
    return
  }
  const menu = new Menu()
  for (const note of notes) {
    const name = note.path.split('/').pop()?.replace(/\.md$/, '') ?? note.path
    menu.addItem((item) =>
      item
        .setTitle(name)
        .setIcon('file-text')
        .onClick(() => void openLinkedNote(app, note))
    )
  }
  menu.showAtPosition(at)
}

/** Marks what notes link to in `book` and follows them; stop it when the book closes. */
export function linkedNotesFor(app: App, book: TFile, reading: BookReading): LinkedNotes {
  let isComment: (path: string) => boolean = () => false
  const index = new LinkedNotes(
    app,
    book,
    // The book's highlights notes and its discussions have marks of their own.
    (path) => reading.notes().some((n) => n.path === path) || isComment(path),
    () => reading.marks.setLinks(index.places())
  )
  reading.marks.onLink = (cfi, at) => openLinkedNotes(app, index.at(cfi), at)
  void import('@/ai/CommentService')
    .then(({ CommentService }) => {
      const comments = CommentService.getInstance()
      isComment = (path) => {
        const file = app.vault.getFileByPath(path)
        return !!file && comments.isCommentFile(file)
      }
    })
    .catch((e) => console.debug('[Abele] comments not known to the book marks', e))
    .finally(() => {
      index.start()
      reading.marks.setLinks(index.places())
    })
  return index
}
