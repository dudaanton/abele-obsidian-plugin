import { t } from '@/i18n'
// Choosing a picture from the vault for the document, with Obsidian's own quick-switcher prompt:
// type to filter, arrows to move, Enter to put it in. Each row is the file's name with its folder
// under it, as the quick switcher shows a note.
import { App, SuggestModal } from 'obsidian'
import { SuggestionRows } from '@/components/obsidian/suggestionRows'

export interface WordPictureFile {
  path: string
}

// The kinds a Word document can hold; a drawing or a bitmap would be refused when put in.
const IMAGE = /\.(png|jpe?g|gif|webp)$/i

export const isPicture = (path: string) => IMAGE.test(path)

export class WordPicturePicker extends SuggestModal<WordPictureFile> {
  private readonly rows = new SuggestionRows()
  constructor(
    app: App,
    private files: WordPictureFile[],
    /** What Enter does, in the hint at the foot: «to insert», «to replace». */
    purpose: string,
    private onChoose: (file: WordPictureFile) => void
  ) {
    super(app)
    this.setPlaceholder(t('streamC.ad6b7bbda1eec152'))
    this.setInstructions([
      { command: '↑↓', purpose: t('streamC.5a70bdb08330fafc') },
      { command: '↵', purpose },
      { command: 'esc', purpose: t('streamC.29e1c55a841060e9') },
    ])
    this.emptyStateText = files.length
      ? t('streamC.59baf6d673c8802f')
      : t('streamC.e842aa161d0ec1b4')
  }

  getSuggestions(query: string): WordPictureFile[] {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return this.files.filter((f) => words.every((w) => f.path.toLowerCase().includes(w)))
  }

  renderSuggestion(file: WordPictureFile, el: HTMLElement): void {
    const slash = file.path.lastIndexOf('/')
    this.rows.draw(el, {
      title: file.path.slice(slash + 1),
      note: slash > 0 ? file.path.slice(0, slash) : undefined,
    })
  }

  onClose(): void {
    this.rows.clear()
    super.onClose()
  }

  onChooseSuggestion(file: WordPictureFile): void {
    this.onChoose(file)
  }
}
