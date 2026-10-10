import type {
  BookSelectionSnapshot,
  ChatSelectionSnapshot,
  SelectionSnapshot,
} from '@/selection/types'
import type { BookScriptContext } from './bookContext'

/** Persistable capture. The execution context adds its live binding capability separately. */
export type SelectionScriptContext =
  | (BookSelectionSnapshot & { readonly backlink: string })
  | (ChatSelectionSnapshot & { readonly backlink: string; readonly anchorId: string })

/** Copy every nested value before the first await; callers may release or replace selection. */
export function captureSelection<T extends SelectionSnapshot>(snapshot: T): T {
  const source = snapshot.source
  const captured = {
    ...snapshot,
    source: Object.freeze(
      source.kind === 'chat'
        ? {
            ...source,
            range: Object.freeze({ ...source.range }),
            context: Object.freeze({ ...source.context }),
          }
        : { ...source }
    ),
  }
  Object.freeze(captured)
  return captured
}

/** Compatible reader adapter: `book` stays available alongside the new neutral API. */
export function bookSelection(book: BookScriptContext): SelectionScriptContext {
  return captureSelection({
    text: book.text,
    sentence: book.sentence,
    title: book.title,
    pathHint: book.path,
    backlink: book.link,
    source: {
      kind: 'book',
      place: book.cfi,
      chapter: book.chapter,
      language: book.language,
    },
  })
}
