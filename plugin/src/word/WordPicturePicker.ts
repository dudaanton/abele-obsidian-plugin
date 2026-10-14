// Choosing a picture from the vault for the document, with Obsidian's own quick-switcher prompt:
// type to filter, arrows to move, Enter to put it in. Each row is the file's name with its folder
// under it, as the quick switcher shows a note.
import { App, SuggestModal } from 'obsidian'

export interface WordPictureFile {
  path: string
}

// The kinds a Word document can hold; a drawing or a bitmap would be refused when put in.
const IMAGE = /\.(png|jpe?g|gif|webp)$/i

export const isPicture = (path: string) => IMAGE.test(path)

export class WordPicturePicker extends SuggestModal<WordPictureFile> {
  constructor(
    app: App,
    private files: WordPictureFile[],
    /** What Enter does, in the hint at the foot: «to insert», «to replace». */
    purpose: string,
    private onChoose: (file: WordPictureFile) => void
  ) {
    super(app)
    this.setPlaceholder('Find a picture in the vault…')
    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose },
      { command: 'esc', purpose: 'to dismiss' },
    ])
    this.emptyStateText = files.length ? 'No picture matches' : 'There are no pictures in the vault'
  }

  getSuggestions(query: string): WordPictureFile[] {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return this.files.filter((f) => words.every((w) => f.path.toLowerCase().includes(w)))
  }

  renderSuggestion(file: WordPictureFile, el: HTMLElement): void {
    el.addClass('mod-complex')
    const content = el.createDiv({ cls: 'suggestion-content' })
    const slash = file.path.lastIndexOf('/')
    content.createDiv({ cls: 'suggestion-title', text: file.path.slice(slash + 1) })
    if (slash > 0) content.createDiv({ cls: 'suggestion-note', text: file.path.slice(0, slash) })
  }

  onChooseSuggestion(file: WordPictureFile): void {
    this.onChoose(file)
  }
}
