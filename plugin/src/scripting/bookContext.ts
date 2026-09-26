/**
 * What a script run from words selected in a book is told about them, as `book` in its scope.
 * Any other run finds `null` there.
 */
export interface BookScriptContext {
  /** The words selected, or the highlight's. */
  text: string
  /** A link to this place, the one "Copy link" makes: `[[Dune.epub#cfi=…|Chapter 3]]`. */
  link: string
  /** The book's path in the vault. */
  path: string
  /** The book's title, from the book itself; its file name when it has none. */
  title: string
  /** The chapter the words are in — for a PDF, "Page N". */
  chapter: string
  /** The whole sentence (or sentences) the words are in. */
  sentence: string
  /** The place itself, an EPUB CFI. */
  cfi: string
}
