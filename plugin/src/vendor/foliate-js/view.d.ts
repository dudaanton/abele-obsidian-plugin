// ABELE addition: typings for the parts of the vendored module Abele calls.
export interface FoliateTocItem {
  label: string
  href: string
  subitems?: FoliateTocItem[]
}

export interface FoliateSection {
  id: unknown
  load(): string | Promise<string>
  unload?(): void
  createDocument?(): Document | Promise<Document>
  size: number
  linear?: string
  cfi?: string
}

export interface FoliateBook {
  sections: FoliateSection[]
  toc?: FoliateTocItem[]
  metadata?: Record<string, unknown> & { title?: unknown; author?: unknown; language?: unknown }
  rendition?: { layout?: string; [key: string]: unknown }
  dir?: string
  transformTarget?: EventTarget
  [key: string]: unknown
}

export interface FoliateLocation {
  /** Renderer relocation cause; `anchor` is reflow, not a new reading position. */
  reason?: string
  fraction?: number
  cfi?: string
  tocItem?: { label?: string; href?: string } | null
  location?: { current: number; next: number; total: number }
  section?: { current: number; total: number }
  range?: Range
}

export interface FoliateRenderer extends HTMLElement {
  getContents(): { doc: Document; index: number; overlayer?: unknown }[]
  destroy?(): void
  next(): Promise<void>
  prev(): Promise<void>
}

export interface FoliateHistory extends EventTarget {
  back(): void
  forward(): void
  readonly canGoBack: boolean
  readonly canGoForward: boolean
}

export class View extends HTMLElement {
  book: FoliateBook
  history: FoliateHistory
  renderer: FoliateRenderer
  lastLocation: FoliateLocation | null
  isFixedLayout: boolean
  open(book: FoliateBook): Promise<void>
  close(): void
  init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>
  getCFI(index: number, range?: Range): string
  getProgressOf(index: number, range: Range): { tocItem?: { label?: string } | null }
  resolveNavigation(target: string | number): {
    index: number
    anchor?: (doc: Document) => Range | Element | null
  } | null
  search(opts: {
    query: string
    draw?: unknown
    drawOptions?: unknown
    matcher?: unknown
  }): AsyncGenerator<unknown>
  clearSearch(): void
  addAnnotation(annotation: { value: string; cfi?: string }, remove?: boolean): Promise<unknown>
  deleteAnnotation(annotation: { value: string; cfi?: string }): Promise<unknown>
  goTo(target: string | number | { fraction: number }): Promise<unknown>
  select(target: string): Promise<void>
  deselect(): void
  goToFraction(fraction: number): Promise<void>
  next(distance?: number): Promise<void>
  prev(distance?: number): Promise<void>
  goLeft(): Promise<void>
  goRight(): Promise<void>
}

export class UnsupportedTypeError extends Error {}
export class NotFoundError extends Error {}
export function makeBook(file: Blob): Promise<FoliateBook>

declare global {
  interface HTMLElementTagNameMap {
    'foliate-view': View
  }
}
