/** Script-facing reader library: navigation and lifetime-aware invalidation live outside the core. */
import { BOOK_VIEW_TYPE } from '@/reader/viewType'
import { ReaderLibrary, type ReaderFile } from '@/reader/library'
import type { BookPlaces } from '@/reader/positions'

interface FileRef {
  path: string
  extension: string
}
interface LeafRef {
  view: object
  setViewState(state: { type: string; state: { file: string }; active: boolean }): Promise<unknown>
}

export interface BooksHost {
  files(): readonly FileRef[]
  places: BookPlaces | null
  highlightCount?(path: string): number | null
  getFile(path: string): FileRef | null
  leaves(): readonly LeafRef[]
  newLeaf(): LeafRef
  reveal(leaf: LeafRef): Promise<unknown>
  /** File inventory changed; returns an unsubscribe. */
  onFilesChanged?(listener: () => void): () => void
  /** Reader tabs changed; cached highlight availability depends on the open tabs. */
  onReadersChanged?(listener: () => void): () => void
  /** Plugin unload; returns what removes the callback when its view closes first. */
  onDispose?(stop: () => void): () => void
}

export function createBooksApi(host: BooksHost) {
  const library = new ReaderLibrary({
    files: (): ReaderFile[] => host.files().map((f) => ({ path: f.path, format: f.extension })),
    places: { snapshot: () => host.places?.snapshot() ?? Promise.resolve(new Map()) },
    // An unopened reader does not index highlights. Unknown is different from zero.
    highlightCount: (path) => host.highlightCount?.(path) ?? null,
  })
  return {
    list: () => library.list(),
    get: (path: string) => library.get(path),
    async open(path: string): Promise<void> {
      const file = host.getFile(path)
      if (!file || !(await library.get(path))) throw new Error(`Reader file not found: ${path}`)
      const leaf =
        host.leaves().find((l) => (l.view as { file?: FileRef }).file?.path === path) ??
        host.newLeaf()
      if ((leaf.view as { file?: FileRef }).file?.path !== path)
        await leaf.setViewState({ type: BOOK_VIEW_TYPE, state: { file: path }, active: true })
      await host.reveal(leaf)
      // The reader itself restores its current CFI, including one newer than this query.
    },
    onChange(listener: () => void | Promise<void>, options: { signal: AbortSignal }): () => void {
      if (!options?.signal) throw new Error('books.onChange requires a lifetime signal')
      if (options.signal.aborted) return () => {}
      const notify = () => {
        try {
          void Promise.resolve(listener()).catch((e) =>
            console.warn('[Abele] books listener failed', e)
          )
        } catch (e) {
          console.warn('[Abele] books listener failed', e)
        }
      }
      const stopPlace = host.places?.onChange(notify)
      const stopFiles = host.onFilesChanged?.(notify)
      const stopReaders = host.onReadersChanged?.(notify)
      let active = true
      let stopDispose: (() => void) | undefined
      const stop = () => {
        if (!active) return
        active = false
        stopPlace?.()
        stopFiles?.()
        stopReaders?.()
        stopDispose?.()
        stopDispose = undefined
        options.signal.removeEventListener('abort', stop)
      }
      options.signal.addEventListener('abort', stop, { once: true })
      stopDispose = host.onDispose?.(stop)
      // An already-unloaded host can stop synchronously while registering.
      if (!active) {
        stopDispose?.()
        stopDispose = undefined
      }
      return stop
    },
  }
}
