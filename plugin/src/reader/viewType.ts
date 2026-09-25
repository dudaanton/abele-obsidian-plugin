/**
 * What names a book tab and the files it shows, on their own so code that only needs to
 * recognise one — the agent's tools, the chat's menu — does not load the reader to do it.
 */
export const BOOK_VIEW_TYPE = 'abele-book'

/** What opens in a book tab by itself. */
export const BOOK_EXTENSIONS = ['epub']
/** What a book tab can show: PDFs too, when asked to (a menu item, or the setting). */
export const READER_EXTENSIONS = ['epub', 'pdf']

/**
 * For the e2e tier only: a sandbox to use instead of the platform's, so the desktop app can be
 * made to draw pages the way the iPhone does and prove the policy holds without the sandbox.
 */
export const readerTestHooks: { sandbox: string | null } = { sandbox: null }

/** What a page frame reported, kept for the e2e tier and the diagnostics of a blanked page. */
export interface PageReport {
  index: number
  findings: string[]
  sandbox: string | null
}
