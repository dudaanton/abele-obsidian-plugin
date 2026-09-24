/**
 * What names a book tab and the files it shows, on their own so code that only needs to
 * recognise one — the agent's tools, the chat's menu — does not load the reader to do it.
 */
export const BOOK_VIEW_TYPE = 'abele-book'

/** What opens in a book tab by itself. */
export const BOOK_EXTENSIONS = ['epub']
/** What a book tab can show: PDFs too, when asked to (a menu item, or the setting). */
export const READER_EXTENSIONS = ['epub', 'pdf']
