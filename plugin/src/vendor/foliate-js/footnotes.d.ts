// ABELE addition: typings for the vendored module beside it.
import type { FoliateBook } from './view'

export class FootnoteHandler extends EventTarget {
  detectFootnotes: boolean
  handle(book: FoliateBook, e: Event): Promise<void> | undefined
}
